import {modelStore, chatSessionStore} from '../../store';
import {chatSessionRepository} from '../../repositories/ChatSessionRepository';
import memoryRepository from '../../repositories/MemoryRepository';
import memorySettingsRepository from '../../repositories/MemorySettingsRepository';
import {convertToChatMessages} from '../../utils/chat';
import {
  extractMemoryCandidates,
  type ConversationTurn,
} from './MemoryExtractionPipeline';

// Bounds the prompt size for the extraction pass itself — this is separate
// from, and much smaller than, the digest's own retrieval budget.
const EXTRACTION_WINDOW_SIZE = 20;

const MEMORY_CANDIDATE_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      content: {type: 'string'},
      kind: {
        type: 'string',
        enum: [
          'fact',
          'preference',
          'episodic',
          'procedural',
          'relationship',
          'open_thread',
        ],
      },
      tags: {type: 'array', items: {type: 'string'}},
      provenance: {type: 'string', enum: ['user_stated', 'model_inferred']},
      confidence: {type: 'number'},
    },
    required: ['content'],
  },
};

/**
 * Wraps whichever completion engine is currently active (local or remote —
 * same modelStore.engine used by useStructuredOutput) into the plain
 * text-in/text-out shape MemoryExtractionPipeline expects. Schema-
 * constrained, so the model is far less likely to return anything
 * malformed than the passive "please respond with JSON only" instruction
 * alone — extractMemoryCandidates still defends against it regardless.
 *
 * Uses the active model rather than a standalone draft-model completion
 * path: loading the draft model independently of its speculative-decoding
 * role would be new engine-lifecycle work of its own, out of scope here.
 */
async function createModelCompletionFn(): Promise<
  (prompt: string) => Promise<string>
> {
  const engine = modelStore.engine;
  if (!engine) {
    throw new Error('runMemoryExtraction: no active model engine');
  }
  return async (prompt: string) => {
    const result = await engine.completion({
      messages: [{role: 'user', content: prompt}],
      response_format: {
        type: 'json_schema',
        json_schema: {strict: true, schema: MEMORY_CANDIDATE_SCHEMA},
      },
      temperature: 0.2,
      n_predict: 1000,
      enable_thinking: false,
    });
    return result.text;
  };
}

/**
 * Runs the post-turn extraction pass for a session and persists whatever
 * candidates it finds. Fire-and-forget from the caller's perspective:
 * every failure mode here is swallowed and logged, since memory retrieval/
 * extraction must never be able to disrupt the visible chat.
 *
 * Guarded on chatSessionStore.isGenerating so this never issues a second,
 * concurrent completion() call against the same engine while the visible
 * turn is still streaming — that concurrency has not been verified safe
 * against a real device/context and is not something to find out the hard
 * way in production.
 *
 * Also a no-op today: gated by isMemoryEnabled(), same as every other
 * memory entry point, so this function existing changes nothing until
 * memory is turned on in settings.
 */
export async function maybeRunMemoryExtraction(
  sessionId: string,
): Promise<void> {
  try {
    const memoryEnabled = await memorySettingsRepository.isMemoryEnabled();
    if (!memoryEnabled) {
      return;
    }
    if (chatSessionStore.isGenerating) {
      return;
    }

    const sessionData = await chatSessionRepository.getSessionById(sessionId);
    if (!sessionData || sessionData.messages.length === 0) {
      return;
    }

    // sessionData.messages is sorted most-recent-first (see
    // ChatSessionRepository.getSessionById); extraction needs chronological
    // order, oldest of the window first.
    const chronological = [...sessionData.messages].reverse();
    const recentUiMessages = chronological
      .slice(-EXTRACTION_WINDOW_SIZE)
      .map(msg => msg.toMessageObject());
    const apiMessages = convertToChatMessages(recentUiMessages, false);

    const turns: ConversationTurn[] = apiMessages
      .filter(
        (m): m is typeof m & {role: 'user' | 'assistant' | 'tool'} =>
          m.role === 'user' || m.role === 'assistant' || m.role === 'tool',
      )
      .map(m => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        text:
          typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
        source: m.role === 'tool' ? 'external_content' : undefined,
      }));

    if (turns.length === 0) {
      return;
    }

    const complete = await createModelCompletionFn();
    const candidates = await extractMemoryCandidates(turns, complete);
    if (candidates.length === 0) {
      return;
    }

    const embeddingModelPath =
      await memorySettingsRepository.getEmbeddingModelPath();
    for (const candidate of candidates) {
      const input = {...candidate, sourceConversationId: sessionId};
      if (embeddingModelPath) {
        await memoryRepository.createMemoryWithEmbedding(
          embeddingModelPath,
          input,
        );
      } else {
        await memoryRepository.createMemory(input);
      }
    }
  } catch (error) {
    console.error('runMemoryExtraction: extraction pass failed:', error);
  }
}
