import memoryGraphRepository from '../../repositories/MemoryGraphRepository';
import {createExtractionCompletionFn} from './extractionModel';
import {extractJsonObject} from './extractJson';
import {screenNode} from './MemoryWriteGatekeeper';
import {clamp} from './validateMemoryInput';
import type {MemoryNodeKind} from '../../types/memoryGraph';

/**
 * Tulving consolidation: once the same idea has been mentioned as a
 * separate episodic node often enough, collapse those raw, time-stamped
 * mentions into one abstracted semantic node — the "50 episodic nodes
 * become 1 clean semantic node" mechanism the graph schema's memoryType
 * split was built to support from the start. Each consolidated episodic
 * node is linked to the resulting semantic node via a PART_OF edge (never
 * destroyed outright — retired, same as everything else in this system)
 * so the evidence trail behind the summary stays inspectable.
 */

// Below this many active episodic mentions of the same (label, kind,
// compartment), consolidation doesn't trigger — a handful of one-off
// mentions isn't yet a pattern worth collapsing.
export const CONSOLIDATION_EPISODIC_THRESHOLD = 5;

const CONSOLIDATION_SCHEMA = {
  type: 'object',
  properties: {
    content: {type: 'string'},
    confidence: {type: 'number'},
    valence: {type: 'number'},
    salience: {type: 'number'},
  },
  required: ['content'],
};

export interface ConsolidationTarget {
  label: string;
  kind: MemoryNodeKind;
  compartmentId?: string;
}

function buildConsolidationPrompt(label: string, mentions: string[]): string {
  const list = mentions.map((text, i) => `${i + 1}. ${text}`).join('\n');
  return `You are consolidating repeated mentions of the same idea into one durable, generalized memory. Below are ${mentions.length} separate mentions of "${label}" from different conversations. Write ONE concise, generalized summary capturing what they collectively establish — drop one-off details that don't generalize across mentions.

Mentions:
${list}

Respond with a JSON object only, no other text and no markdown code fence, in this exact shape:
{"content": string, "confidence": number, "valence": number, "salience": number}
"confidence" (0-1) should reflect how consistently the mentions agree with each other. "valence" (-1 to 1) is the overall emotional charge. "salience" (0-1) should generally run higher than any single mention's, since repetition itself is evidence of centrality.`;
}

interface ConsolidationCandidate {
  content: string;
  confidence: number;
  valence?: number;
  salience?: number;
}

function toConsolidationCandidate(
  raw: Record<string, any>,
): ConsolidationCandidate | null {
  const content = typeof raw.content === 'string' ? raw.content.trim() : '';
  if (!content) {
    return null;
  }
  const candidate: ConsolidationCandidate = {
    content,
    confidence:
      typeof raw.confidence === 'number' ? clamp(raw.confidence, 0, 1) : 0.7,
  };
  if (typeof raw.valence === 'number') {
    candidate.valence = clamp(raw.valence, -1, 1);
  }
  if (typeof raw.salience === 'number') {
    candidate.salience = clamp(raw.salience, 0, 1);
  }
  return candidate;
}

/**
 * Checks whether the given (label, kind, compartment) now has enough
 * active episodic nodes to warrant consolidation, and if so, synthesizes
 * one semantic node from them via the same three-model completion path
 * extraction uses, links each consolidated episodic node to it with a
 * PART_OF edge, and retires the episodic nodes. Every failure mode here is
 * swallowed and logged — consolidation is a background hygiene pass, not
 * something that should ever disrupt the extraction pass that triggered
 * the check.
 */
export async function maybeConsolidateLabel(
  target: ConsolidationTarget,
  embeddingModelPath?: string,
): Promise<void> {
  try {
    const episodicNodes = await memoryGraphRepository.listNodes({
      kind: target.kind,
      memoryType: 'episodic',
      status: 'active',
      compartmentId: target.compartmentId,
    });
    const normalizedLabel = target.label.trim().toLowerCase();
    const matching = episodicNodes.filter(
      node => node.label.trim().toLowerCase() === normalizedLabel,
    );
    if (matching.length < CONSOLIDATION_EPISODIC_THRESHOLD) {
      return;
    }

    const {complete, extractedBy} = await createExtractionCompletionFn(
      CONSOLIDATION_SCHEMA,
      {nPredict: 600},
    );

    let raw: string;
    try {
      raw = await complete(
        buildConsolidationPrompt(
          target.label,
          matching.map(node => node.description || node.label),
        ),
      );
    } catch (error) {
      console.error('MemoryConsolidationPipeline: completion failed:', error);
      return;
    }

    const parsed = extractJsonObject(raw);
    const candidate = parsed ? toConsolidationCandidate(parsed) : null;
    if (!candidate) {
      return;
    }

    // Same deterministic screen as regular extraction — a synthesized
    // summary drawing on multiple episodic mentions is still model output,
    // and one of those mentions could itself have carried an injection
    // payload that survived into this summary.
    const screened = screenNode({
      label: target.label,
      content: candidate.content,
      kind: target.kind,
      memoryType: 'semantic',
      confidence: candidate.confidence,
      valence: candidate.valence,
      salience: candidate.salience,
      provenance: 'model_inferred',
    });
    if (!screened) {
      console.warn(
        'MemoryConsolidationPipeline: dropped a consolidated summary matching an injection pattern:',
        target.label,
      );
      return;
    }
    if (screened.quarantined) {
      // A low-confidence consolidation isn't worth acting on yet — leave
      // the episodic nodes as they are for a future pass to try again.
      return;
    }

    const semanticNode = await memoryGraphRepository.upsertSemanticNode(
      {
        label: target.label,
        kind: target.kind,
        memoryType: 'semantic',
        description: screened.node.content,
        confidence: screened.node.confidence,
        valence: screened.node.valence,
        salience: screened.node.salience,
        compartmentId: target.compartmentId,
        provenance: 'model_inferred',
        extractedBy,
      },
      embeddingModelPath,
    );

    for (const episodic of matching) {
      try {
        await memoryGraphRepository.upsertEdge({
          sourceNodeId: episodic.id,
          targetNodeId: semanticNode.id,
          relation: 'PART_OF',
          weight: 1,
          confidence: episodic.confidence,
          provenance: 'model_inferred',
          extractedBy,
        });
        await memoryGraphRepository.softDeleteNode(episodic.id);
      } catch (error) {
        console.warn(
          'MemoryConsolidationPipeline: failed to link/retire an episodic node:',
          error,
        );
      }
    }
  } catch (error) {
    console.error(
      'MemoryConsolidationPipeline: consolidation pass failed:',
      error,
    );
  }
}
