import memoryGraphRepository from '../../repositories/MemoryGraphRepository';
import {createExtractionCompletionFn} from './extractionModel';
import {extractJsonObject} from './extractJson';
import {screenNode} from './MemoryWriteGatekeeper';
import {maybeConsolidateLabel} from './MemoryConsolidationPipeline';
import type {MemoryNodeKind} from '../../types/memoryGraph';

/**
 * The idle sweep: maintenance passes over the whole graph rather than the
 * narrow, per-turn slice runMemoryExtraction touches. Each step swallows
 * its own errors and runs regardless of whether earlier steps found
 * anything, so one bad step can't block the rest of the sweep. Steps run
 * sequentially (never concurrently) since more than one calls the same
 * completion engine, and this system never issues overlapping completion()
 * calls against it.
 */

// A reserved node identity, not something extraction or consolidation ever
// produces on their own (their labels come from what's actually in the
// conversation) — the one node this whole system rewrites wholesale each
// sweep rather than incrementally merging new evidence into.
export const WORLDVIEW_NODE_LABEL = 'ai worldview summary';
const WORLDVIEW_NODE_KIND: MemoryNodeKind = 'concept';

// Nothing "quality-reviews" a quarantined node back to trust — it either
// gets superseded by a fresh, non-quarantined mention (handled by ordinary
// dedup) or it sits unused. Past this age it's just taking up space.
const QUARANTINE_RETENTION_DAYS = 30;

// Below this many active semantic nodes, there isn't enough material for a
// worldview summary to say anything a single fact doesn't already say.
const WORLDVIEW_MIN_SOURCE_NODES = 3;
const WORLDVIEW_MAX_SOURCE_NODES = 40;

const WORLDVIEW_SCHEMA = {
  type: 'object',
  properties: {content: {type: 'string'}},
  required: ['content'],
};

/** Continuity: the full-graph counterpart of the per-turn consolidation
 * check — groups every active episodic node by (label, kind, compartment)
 * and consolidates any group that has reached the threshold, including
 * ones that grew across turns that never happened to touch that exact
 * group again afterward. */
async function runConsolidationSweep(embeddingModelPath?: string) {
  try {
    const episodicNodes = await memoryGraphRepository.listNodes({
      memoryType: 'episodic',
      status: 'active',
    });
    const groups = new Map<
      string,
      {label: string; kind: MemoryNodeKind; compartmentId?: string}
    >();
    for (const node of episodicNodes) {
      const key = `${node.label.trim().toLowerCase()}::${node.kind}::${
        node.compartmentId ?? ''
      }`;
      if (!groups.has(key)) {
        groups.set(key, {
          label: node.label,
          kind: node.kind,
          compartmentId: node.compartmentId,
        });
      }
    }
    for (const target of groups.values()) {
      await maybeConsolidateLabel(target, embeddingModelPath);
    }
  } catch (error) {
    console.error('MemorySweepPipeline: consolidation sweep failed:', error);
  }
}

/** Quality: purges quarantined nodes old enough that nothing is ever going
 * to promote them — pure housekeeping, no model involved. */
async function runQuarantineCleanup() {
  try {
    const quarantined = await memoryGraphRepository.listNodes({
      status: 'quarantined',
    });
    const cutoff = Date.now() - QUARANTINE_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    for (const node of quarantined) {
      if (new Date(node.createdAt).getTime() < cutoff) {
        await memoryGraphRepository.hardDeleteNode(node.id);
      }
    }
  } catch (error) {
    console.error('MemorySweepPipeline: quarantine cleanup failed:', error);
  }
}

/** Consistency: resolves any CONTRADICTS edge left unresolved — either it
 * never cleared runMemoryExtraction's confidence threshold at the time, or
 * it predates that mechanism entirely. Skips a pair where either side is
 * already retired, since there's nothing left to resolve. */
async function runConsistencySweep() {
  try {
    const contradictions = await memoryGraphRepository.listEdges({
      relation: 'CONTRADICTS',
      status: 'active',
    });
    for (const edge of contradictions) {
      const [source, target] = await Promise.all([
        memoryGraphRepository.getNodeById(edge.sourceNodeId),
        memoryGraphRepository.getNodeById(edge.targetNodeId),
      ]);
      if (
        !source ||
        !target ||
        source.status !== 'active' ||
        target.status !== 'active'
      ) {
        continue;
      }
      await memoryGraphRepository.resolveContradiction(
        edge.sourceNodeId,
        edge.targetNodeId,
      );
    }
  } catch (error) {
    console.error('MemorySweepPipeline: consistency sweep failed:', error);
  }
}

function buildWorldviewPrompt(facts: string[]): string {
  const list = facts.map((fact, i) => `${i + 1}. ${fact}`).join('\n');
  return `You maintain a running internal summary of what you understand about the user, built from everything durable currently held in memory about them.

Facts:
${list}

Write a concise 2-4 sentence summary of your current internalized understanding of this person: who they are, their preferences, ongoing context, and anything notably unresolved. Third person ("The user..."), plain, no embellishment or speculation beyond what the facts actually support.

Respond with a JSON object only, no other text and no markdown code fence, in this exact shape:
{"content": string}`;
}

/** The "current world view" summary: a single semantic node, fully
 * regenerated each sweep from the current top active semantic nodes
 * (pinned first, then by salience*confidence), rather than incrementally
 * patched — it's meant to reflect the graph's present shape, not
 * accumulate its own history. */
async function runWorldviewSynthesis(embeddingModelPath?: string) {
  try {
    const semanticNodes = await memoryGraphRepository.listNodes({
      memoryType: 'semantic',
      status: 'active',
    });
    const normalizedWorldviewLabel = WORLDVIEW_NODE_LABEL.toLowerCase();
    const sourceNodes = semanticNodes
      .filter(
        node => node.label.trim().toLowerCase() !== normalizedWorldviewLabel,
      )
      .sort((a, b) => {
        if (a.pinned !== b.pinned) {
          return a.pinned ? -1 : 1;
        }
        return (
          (b.salience ?? 0.5) * b.confidence -
          (a.salience ?? 0.5) * a.confidence
        );
      })
      .slice(0, WORLDVIEW_MAX_SOURCE_NODES);

    if (sourceNodes.length < WORLDVIEW_MIN_SOURCE_NODES) {
      return;
    }

    const {complete, extractedBy} = await createExtractionCompletionFn(
      WORLDVIEW_SCHEMA,
      {nPredict: 400},
    );

    let raw: string;
    try {
      raw = await complete(
        buildWorldviewPrompt(
          sourceNodes.map(node => node.description || node.label),
        ),
      );
    } catch (error) {
      console.error('MemorySweepPipeline: worldview completion failed:', error);
      return;
    }

    const parsed = extractJsonObject(raw);
    const content =
      parsed && typeof parsed.content === 'string' ? parsed.content.trim() : '';
    if (!content) {
      return;
    }

    // Same deterministic screen as extraction/consolidation — this is
    // still model output, synthesized from other model-derived content.
    const screened = screenNode({
      label: WORLDVIEW_NODE_LABEL,
      content,
      kind: WORLDVIEW_NODE_KIND,
      memoryType: 'semantic',
      confidence: 1,
      salience: 1,
      provenance: 'model_inferred',
    });
    if (!screened || screened.quarantined) {
      return;
    }

    await memoryGraphRepository.upsertSemanticNode(
      {
        label: WORLDVIEW_NODE_LABEL,
        kind: WORLDVIEW_NODE_KIND,
        memoryType: 'semantic',
        description: screened.node.content,
        confidence: screened.node.confidence,
        salience: screened.node.salience,
        provenance: 'model_inferred',
        extractedBy,
      },
      embeddingModelPath,
    );
  } catch (error) {
    console.error('MemorySweepPipeline: worldview synthesis failed:', error);
  }
}

/** Reads back the current worldview summary text, if one has ever been
 * synthesized — used by the settings screen's preview, not by extraction. */
export async function getWorldviewSummary(): Promise<string | undefined> {
  try {
    const nodes = await memoryGraphRepository.listNodes({
      memoryType: 'semantic',
      status: 'active',
    });
    const normalizedWorldviewLabel = WORLDVIEW_NODE_LABEL.toLowerCase();
    return nodes.find(
      node => node.label.trim().toLowerCase() === normalizedWorldviewLabel,
    )?.description;
  } catch (error) {
    console.error(
      'MemorySweepPipeline: error reading worldview summary:',
      error,
    );
    return undefined;
  }
}

/**
 * Runs every sweep step once, in order. The caller (MemorySweepScheduler)
 * owns deciding *when* this should run; this function assumes that
 * decision has already been made.
 */
export async function runMemorySweep(
  embeddingModelPath?: string,
): Promise<void> {
  await runConsolidationSweep(embeddingModelPath);
  await runQuarantineCleanup();
  await runConsistencySweep();
  await runWorldviewSynthesis(embeddingModelPath);
}
