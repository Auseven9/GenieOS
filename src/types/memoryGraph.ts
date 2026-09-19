/**
 * The associative layer on top of the flat `memories` store: canonical
 * nodes (entities/topics/preferences the model has recognized) connected by
 * typed, directed edges. `memories` rows remain the raw extracted
 * statements; a node is the deduped concept those statements refer to, and
 * an edge is a relationship Gemma's extraction pass draws between two such
 * concepts (e.g. "user likes dark mode" SUPPORTS "user is a night owl").
 */

import type {MemoryProvenance, MemoryStatus} from './memory';

export type MemoryNodeKind =
  | 'person'
  | 'entity'
  | 'topic'
  | 'preference'
  | 'event'
  | 'place'
  | 'concept'
  | 'open_thread';

/**
 * SUPERSEDES and BRIDGES_TO are system-only relations, never something the
 * extraction model is allowed to emit directly (see
 * validateMemoryGraphInput's VALID_RELATIONS, which deliberately excludes
 * both). SUPERSEDES is written only by MemoryGraphRepository's own
 * contradiction-resolution step; BRIDGES_TO is reserved for a future
 * explicit, user-driven action — letting extraction author its own bridges
 * would let a compartment firewall bypass itself.
 */
export type MemoryEdgeRelation =
  | 'SUPPORTS'
  | 'CONTRADICTS'
  | 'MENTIONS'
  | 'RELATES_TO'
  | 'CAUSES'
  | 'PART_OF'
  | 'PRECEDES'
  | 'SUPERSEDES'
  | 'BRIDGES_TO';

/**
 * Tulving's episodic/semantic distinction: a raw, time-stamped mention vs
 * an abstracted, generalized axiom. Orthogonal to `MemoryNodeKind` (what
 * category of thing the node is) — a `preference` node can be either. A
 * future consolidation pass collapses many episodic nodes that support the
 * same idea into one semantic node (linked via a PART_OF edge), rather than
 * letting raw mentions pile up as separate durable facts forever.
 */
export type MemoryNodeMemoryType = 'episodic' | 'semantic';

export interface MemoryNode {
  id: string;
  /** Canonical short name used for dedup lookups, e.g. "dark mode preference". */
  label: string;
  kind: MemoryNodeKind;
  memoryType: MemoryNodeMemoryType;
  description?: string;
  /** Base64-encoded Float32Array, absent until the embedding model has run. */
  embedding?: string;
  /** 0-1: how sure we are this node is durable/true. */
  confidence: number;
  /** -1 (distressing) to 1 (joyful); absent if not scored. */
  valence?: number;
  /** 0-1: how emotionally charged, independent of direction. */
  intensity?: number;
  /** 0-1: how central this is to the user's core profile, independent of
   * emotional charge or truth certainty; absent if not scored. */
  salience?: number;
  /** Scoping container (e.g. per-Pal or per-topic isolation); absent = global. */
  compartmentId?: string;
  provenance: MemoryProvenance;
  /** The `memories` row this node was first extracted from, if any. */
  sourceMemoryId?: string;
  /** The chat session this node was extracted from, if any. */
  sourceConversationId?: string;
  /** Model signature that performed the extraction (e.g. the draft model's
   * id, or the active chat model's id when no draft model was available). */
  extractedBy?: string;
  pinned: boolean;
  status: MemoryStatus;
  lastAccessedAt?: string;
  accessCount: number;
  createdAt: string;
  updatedAt: string;
}

export type MemoryNodeInput = Omit<
  MemoryNode,
  | 'id'
  | 'status'
  | 'accessCount'
  | 'lastAccessedAt'
  | 'createdAt'
  | 'updatedAt'
  | 'confidence'
  | 'pinned'
> &
  Partial<Pick<MemoryNode, 'confidence' | 'pinned'>>;

export interface MemoryNodeFilter {
  kind?: MemoryNodeKind;
  memoryType?: MemoryNodeMemoryType;
  compartmentId?: string;
  status?: MemoryStatus;
  pinnedOnly?: boolean;
}

export interface MemoryEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  relation: MemoryEdgeRelation;
  /** 0-1: semantic strength of the relation, independent of confidence. */
  weight: number;
  /** 0-1: how sure we are this relation actually holds. */
  confidence: number;
  provenance: MemoryProvenance;
  sourceConversationId?: string;
  extractedBy?: string;
  status: MemoryStatus;
  lastAccessedAt?: string;
  accessCount: number;
  createdAt: string;
  updatedAt: string;
}

export type MemoryEdgeInput = Omit<
  MemoryEdge,
  | 'id'
  | 'status'
  | 'accessCount'
  | 'lastAccessedAt'
  | 'createdAt'
  | 'updatedAt'
  | 'weight'
  | 'confidence'
> &
  Partial<Pick<MemoryEdge, 'weight' | 'confidence'>>;

export type MemoryEdgeDirection = 'outgoing' | 'incoming' | 'both';

export interface MemoryEdgeFilter {
  nodeId?: string;
  direction?: MemoryEdgeDirection;
  relation?: MemoryEdgeRelation;
  status?: MemoryStatus;
}

export interface MemoryCompartment {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export type MemoryCompartmentInput = Omit<
  MemoryCompartment,
  'id' | 'createdAt' | 'updatedAt'
>;
