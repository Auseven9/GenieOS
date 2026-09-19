/**
 * Long-term memory: durable facts/preferences/events extracted from
 * conversations, stored outside any single chat session and retrieved by
 * relevance rather than replayed as raw transcript.
 */

export type MemoryKind =
  | 'fact'
  | 'preference'
  | 'episodic'
  | 'procedural'
  | 'relationship'
  | 'open_thread';

/**
 * Where a memory's content came from. This is the trust boundary: content
 * read from the open web (or any source outside the user's own words) must
 * never be silently promoted to the same trust level as something the user
 * said directly, no matter how many times it's retrieved.
 */
export type MemoryProvenance =
  | 'user_stated'
  | 'model_inferred'
  | 'external_content';

/**
 * 'quarantined' is a third, distinct resting state from 'retired': a
 * quarantined row was never trusted (write-path screening held it back —
 * low confidence, or a redacted secret) rather than once-active and later
 * superseded. Both are excluded from default active-only queries, but the
 * distinction matters for audit/review UI.
 */
export type MemoryStatus = 'active' | 'retired' | 'quarantined';

export interface Memory {
  id: string;
  kind: MemoryKind;
  content: string;
  /** Base64-encoded Float32Array, absent until the embedding model has run. */
  embedding?: string;
  /** 0-1: how sure we are this is durable/true. */
  confidence: number;
  /** -1 (distressing) to 1 (joyful); absent if not scored. */
  valence?: number;
  /** 0-1: how emotionally charged, independent of direction. */
  intensity?: number;
  provenance: MemoryProvenance;
  sourceConversationId?: string;
  tags: string[];
  pinned: boolean;
  /** Id of the memory that replaced this one, if any (soft-supersede, never a blind overwrite). */
  supersededBy?: string;
  status: MemoryStatus;
  lastAccessedAt?: string;
  accessCount: number;
  createdAt: string;
  updatedAt: string;
}

export type MemoryInput = Omit<
  Memory,
  | 'id'
  | 'status'
  | 'supersededBy'
  | 'accessCount'
  | 'lastAccessedAt'
  | 'createdAt'
  | 'updatedAt'
  | 'confidence'
  | 'pinned'
> &
  Partial<Pick<Memory, 'confidence' | 'pinned'>>;

export interface MemoryFilter {
  kind?: MemoryKind;
  provenance?: MemoryProvenance;
  tag?: string;
  status?: MemoryStatus;
  pinnedOnly?: boolean;
}
