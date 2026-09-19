import type {
  MemoryNodeKind,
  MemoryNodeMemoryType,
  MemoryEdgeRelation,
} from '../../types/memoryGraph';
import type {MemoryProvenance} from '../../types/memory';
import {VALID_PROVENANCE, clamp} from './validateMemoryInput';

export const VALID_NODE_KINDS: MemoryNodeKind[] = [
  'person',
  'entity',
  'topic',
  'preference',
  'event',
  'place',
  'concept',
  'open_thread',
];

export const VALID_MEMORY_TYPES: MemoryNodeMemoryType[] = [
  'episodic',
  'semantic',
];

export const VALID_RELATIONS: MemoryEdgeRelation[] = [
  'SUPPORTS',
  'CONTRADICTS',
  'MENTIONS',
  'RELATES_TO',
  'CAUSES',
  'PART_OF',
  'PRECEDES',
];

/** A node candidate straight out of Gemma's extraction output — untrusted. */
export interface GraphNodeCandidate {
  label: string;
  content: string;
  kind: MemoryNodeKind;
  memoryType: MemoryNodeMemoryType;
  confidence: number;
  valence?: number;
  salience?: number;
  provenance: MemoryProvenance;
}

/** An edge candidate, referencing nodes by label rather than id — the
 * extraction pass doesn't know ids, only what it just named. */
export interface GraphEdgeCandidate {
  sourceLabel: string;
  targetLabel: string;
  relation: MemoryEdgeRelation;
  weight: number;
  confidence: number;
}

export interface ToGraphCandidateOptions {
  /** Same trust-boundary rule as flat memory extraction: content sourced
   * from outside the conversation can never be laundered into user_stated. */
  disallowUserStated?: boolean;
}

/**
 * Turns a raw, untrusted node object into a well-formed GraphNodeCandidate.
 * Every field is validated, defaulted, or clamped, since this always
 * originates from model output. Returns null when there's no usable label
 * or content.
 */
export function toGraphNodeCandidate(
  raw: Record<string, any>,
  options: ToGraphCandidateOptions = {},
): GraphNodeCandidate | null {
  const label = typeof raw.label === 'string' ? raw.label.trim() : '';
  const content = typeof raw.content === 'string' ? raw.content.trim() : '';
  if (!label || !content) {
    return null;
  }

  const kind: MemoryNodeKind = VALID_NODE_KINDS.includes(raw.kind)
    ? raw.kind
    : 'concept';
  const memoryType: MemoryNodeMemoryType = VALID_MEMORY_TYPES.includes(
    raw.memory_type,
  )
    ? raw.memory_type
    : 'semantic';

  let provenance: MemoryProvenance = VALID_PROVENANCE.includes(raw.provenance)
    ? raw.provenance
    : 'model_inferred';
  if (options.disallowUserStated && provenance === 'user_stated') {
    provenance = 'model_inferred';
  }

  const candidate: GraphNodeCandidate = {
    label,
    content,
    kind,
    memoryType,
    confidence:
      typeof raw.confidence === 'number' ? clamp(raw.confidence, 0, 1) : 0.5,
    provenance,
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
 * Turns a raw, untrusted edge object into a well-formed GraphEdgeCandidate.
 * Rejects self-loops and anything missing a recognized relation type.
 */
export function toGraphEdgeCandidate(
  raw: Record<string, any>,
): GraphEdgeCandidate | null {
  const sourceLabel =
    typeof raw.source_label === 'string' ? raw.source_label.trim() : '';
  const targetLabel =
    typeof raw.target_label === 'string' ? raw.target_label.trim() : '';
  const relation: MemoryEdgeRelation | undefined = VALID_RELATIONS.includes(
    raw.relation_type,
  )
    ? raw.relation_type
    : undefined;

  if (
    !sourceLabel ||
    !targetLabel ||
    !relation ||
    sourceLabel.toLowerCase() === targetLabel.toLowerCase()
  ) {
    return null;
  }

  return {
    sourceLabel,
    targetLabel,
    relation,
    weight: typeof raw.weight === 'number' ? clamp(raw.weight, 0, 1) : 0.5,
    confidence:
      typeof raw.confidence === 'number' ? clamp(raw.confidence, 0, 1) : 0.5,
  };
}
