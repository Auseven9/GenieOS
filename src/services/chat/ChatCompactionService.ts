import {chatSessionStore, modelStore} from '../../store';
import {chatSessionRepository} from '../../repositories/ChatSessionRepository';
import chatCompactionRepository from '../../repositories/ChatCompactionRepository';
import {createExtractionCompletionFn} from '../memory/extractionModel';
import {extractJsonObject} from '../memory/extractJson';
import {derivedText, assistant} from '../../utils/chat';
import {randId} from '../../utils';
import type {MessageType} from '../../utils/types';

/**
 * Auto-compaction: when a long conversation is getting close to its model's
 * context window, folds everything but the most recent messages into an
 * updated running summary, so the conversation can keep going instead of
 * hitting a hard context-full wall (see bannerVariantResolver.ts). Reuses
 * the same three-model-architecture completion path memory extraction
 * uses (createExtractionCompletionFn: prefers the small draft model in its
 * own independent context, falling back to the active chat engine only
 * when no draft model is configured).
 */

// used/effectiveNCtx ratio at which compaction fires — comfortably below
// bannerVariantResolver's WARNING_THRESHOLD (0.8), so a session with
// compaction enabled ideally never shows the "getting full" banner at all.
export const COMPACTION_TRIGGER_RATIO = 0.65;

// The most recent messages are never touched — the model's immediate
// working context for follow-up turns stays fully detailed regardless of
// how much earlier history gets folded into a summary.
export const KEEP_TAIL_MESSAGES = 6;

// Below this many not-yet-compacted messages ahead of the kept tail,
// compaction is skipped — not worth a completion call over a handful of
// messages, and it keeps a session from re-triggering almost every turn
// once the ratio has first crossed the threshold.
export const MIN_MESSAGES_TO_COMPACT = 6;

const SUMMARY_SCHEMA = {
  type: 'object',
  properties: {summary: {type: 'string'}},
  required: ['summary'],
};

function buildCompactionPrompt(
  previousSummary: string | undefined,
  rangeText: string,
): string {
  const priorSection = previousSummary
    ? `Existing summary of everything before this excerpt:\n${previousSummary}\n\n`
    : '';
  return `You are compacting an ongoing conversation to keep it within its context window. ${priorSection}Below is the next stretch of the conversation, in order. Write ONE updated, concise summary that preserves every fact, decision, preference, and open thread a continuation of this conversation would need — merging in the existing summary above where one is given. Drop pleasantries and filler; keep specifics.

Conversation excerpt:
${rangeText}

Respond with a JSON object only, no other text and no markdown code fence, in this exact shape:
{"summary": string}`;
}

function speakerLine(message: MessageType.Any): string | undefined {
  const text = derivedText(message).trim();
  if (!text) {
    return undefined;
  }
  const speaker = message.author.id === assistant.id ? 'Assistant' : 'User';
  return `${speaker}: ${text}`;
}

/**
 * Runs the auto-compaction pass for a session. A no-op unless compaction is
 * turned on in settings, the conversation is actually idle (never issues a
 * second, concurrent completion() call while the triggering turn is still
 * streaming — same concurrency concern runMemoryExtraction guards against,
 * since the fallback path below can share the active chat engine), the
 * runtime context size is known, and the session's last turn crossed
 * COMPACTION_TRIGGER_RATIO. Every failure mode is swallowed and logged —
 * like memory extraction, this is a background hygiene pass that must
 * never disrupt the visible chat.
 */
export async function maybeCompactSession(sessionId: string): Promise<void> {
  try {
    const enabled = await chatCompactionRepository.isCompactionEnabled();
    if (!enabled) {
      return;
    }
    if (chatSessionStore.isGenerating) {
      return;
    }

    const effectiveNCtx = modelStore.activeModelCaps.effectiveContextLength;
    if (!effectiveNCtx) {
      return;
    }
    const snapshot = chatSessionStore.lastCompletionResult;
    if (!snapshot || snapshot.used === undefined) {
      return;
    }
    if (snapshot.used / effectiveNCtx < COMPACTION_TRIGGER_RATIO) {
      return;
    }

    const sessionData = await chatSessionRepository.getSessionById(sessionId);
    if (!sessionData || sessionData.messages.length === 0) {
      return;
    }

    // sessionData.messages is sorted most-recent-first (see
    // ChatSessionRepository.getSessionById); compaction reasons
    // chronologically, oldest first.
    const chronological = [...sessionData.messages]
      .reverse()
      .map(m => m.toMessageObject());

    const eligible = chronological.slice(
      0,
      Math.max(0, chronological.length - KEEP_TAIL_MESSAGES),
    );
    const toCompact = eligible.filter(
      m => !m.metadata?.compacted && !m.metadata?.compactionSummary,
    );
    if (toCompact.length < MIN_MESSAGES_TO_COMPACT) {
      return;
    }

    // The most recent live (not already compacted) summary, if any,
    // becomes part of the prompt and gets folded into — and superseded
    // by — the new one, so summaries never pile up across repeated
    // compaction passes.
    const previousSummaryMessage = chronological.find(
      m => m.metadata?.compactionSummary && !m.metadata?.compacted,
    );
    const previousSummaryText = previousSummaryMessage
      ? derivedText(previousSummaryMessage)
      : undefined;

    const rangeText = toCompact
      .map(speakerLine)
      .filter((line): line is string => !!line)
      .join('\n');
    if (!rangeText.trim()) {
      return;
    }

    const {complete} = await createExtractionCompletionFn(SUMMARY_SCHEMA, {
      nPredict: 800,
    });

    let raw: string;
    try {
      raw = await complete(
        buildCompactionPrompt(previousSummaryText, rangeText),
      );
    } catch (error) {
      console.error('ChatCompactionService: completion failed:', error);
      return;
    }

    const parsed = extractJsonObject(raw);
    const summary =
      parsed && typeof parsed.summary === 'string' ? parsed.summary.trim() : '';
    if (!summary) {
      return;
    }

    // Mark the compacted range — and the previous summary it supersedes,
    // if any — so neither is resent as raw history again (see the
    // metadata.compacted / metadata.compactionSummary filter in
    // convertToChatMessages).
    for (const message of toCompact) {
      await chatSessionStore.updateMessage(message.id, sessionId, {
        metadata: {compacted: true},
      });
    }
    if (previousSummaryMessage) {
      await chatSessionStore.updateMessage(
        previousSummaryMessage.id,
        sessionId,
        {metadata: {compacted: true}},
      );
    }

    // Appended as a normal visible message — lands exactly where
    // compaction ran in the timeline, transparent to the user about what
    // happened, and flows into the next turn's prompt via the ordinary
    // convertToChatMessages path in its correct chronological position.
    const summaryMessage: MessageType.Text = {
      id: randId(),
      type: 'text',
      author: assistant,
      // metadata.system carries no dedicated bubble styling anywhere in
      // the app today, so this needs to read as an aside on its own —
      // unprefixed, it would look like an ordinary assistant reply.
      text: `Conversation compacted to keep it within context. Summary of everything before this point:\n\n${summary}`,
      createdAt: Date.now(),
      metadata: {system: true, compactionSummary: true},
    };
    if (sessionId === chatSessionStore.activeSessionId) {
      await chatSessionStore.addMessageToCurrentSession(summaryMessage);
    } else {
      await chatSessionRepository.addMessageToSession(
        sessionId,
        summaryMessage,
      );
    }
  } catch (error) {
    console.error('ChatCompactionService: compaction pass failed:', error);
  }
}
