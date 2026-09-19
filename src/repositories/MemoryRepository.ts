import {Q} from '@nozbe/watermelondb';
import type {Clause} from '@nozbe/watermelondb/QueryDescription';
import {database} from '../database';
import Memory from '../database/models/Memory';
import type {
  Memory as MemoryView,
  MemoryFilter,
  MemoryInput,
} from '../types/memory';

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    return 0;
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) {
    return 0;
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

class MemoryRepository {
  private collection() {
    return database.collections.get<Memory>('memories');
  }

  async createMemory(input: MemoryInput): Promise<MemoryView> {
    try {
      const created = await database.write(async () => {
        return await this.collection().create((record: Memory) => {
          record.kind = input.kind;
          record.content = input.content;
          record.embedding = input.embedding;
          record.confidence = input.confidence ?? 0.5;
          record.valence = input.valence;
          record.intensity = input.intensity;
          record.provenance = input.provenance;
          record.sourceConversationId = input.sourceConversationId;
          record.tags = Memory.safeStringifyArray(input.tags || []);
          record.pinned = input.pinned ?? false;
          record.supersededBy = undefined;
          record.status = 'active';
          record.lastAccessedAt = undefined;
          record.accessCount = 0;
        });
      });
      return created.toView();
    } catch (error) {
      console.error('MemoryRepository: error creating memory:', error);
      throw error;
    }
  }

  async getMemoryById(id: string): Promise<MemoryView | null> {
    try {
      const record = await this.collection().find(id);
      return record.toView();
    } catch (error) {
      console.error('MemoryRepository: error fetching memory by id:', error);
      return null;
    }
  }

  async listMemories(filter: MemoryFilter = {}): Promise<MemoryView[]> {
    try {
      const clauses: Clause[] = [];
      if (filter.kind) {
        clauses.push(Q.where('kind', filter.kind));
      }
      if (filter.provenance) {
        clauses.push(Q.where('provenance', filter.provenance));
      }
      if (filter.status) {
        clauses.push(Q.where('status', filter.status));
      } else {
        // Soft-deleted (retired) memories are excluded unless asked for
        // explicitly — same rule the memory-control UI relies on.
        clauses.push(Q.where('status', 'active'));
      }
      if (filter.pinnedOnly) {
        clauses.push(Q.where('pinned', true));
      }

      const records = await this.collection()
        .query(...clauses)
        .fetch();
      const views = records.map(record => record.toView());

      // Tag filtering happens in JS: tags are a JSON-stringified array, not
      // a queryable column, and the memory count here is small enough
      // (personal-use scale) that this is not a meaningful cost.
      return filter.tag
        ? views.filter(view => view.tags.includes(filter.tag!))
        : views;
    } catch (error) {
      console.error('MemoryRepository: error listing memories:', error);
      return [];
    }
  }

  /**
   * Never overwrites in place: writes a new memory carrying the edit, marks
   * the old one `superseded_by` the new id and retires it. This is what
   * keeps every auto-write and manual edit recoverable and auditable,
   * whether the change came from the model or from the user.
   */
  async supersedeMemory(
    id: string,
    next: MemoryInput,
  ): Promise<MemoryView | null> {
    try {
      const previous = await this.collection().find(id);
      const replacement = await this.createMemory(next);
      await database.write(async () => {
        await previous.update((record: Memory) => {
          record.supersededBy = replacement.id;
          record.status = 'retired';
        });
      });
      return replacement;
    } catch (error) {
      console.error('MemoryRepository: error superseding memory:', error);
      return null;
    }
  }

  async setPinned(id: string, pinned: boolean): Promise<void> {
    try {
      const record = await this.collection().find(id);
      await database.write(async () => {
        await record.update((r: Memory) => {
          r.pinned = pinned;
        });
      });
    } catch (error) {
      console.error('MemoryRepository: error setting pinned:', error);
    }
  }

  async recordAccess(id: string): Promise<void> {
    try {
      const record = await this.collection().find(id);
      await database.write(async () => {
        await record.update((r: Memory) => {
          r.accessCount = (r.accessCount || 0) + 1;
          r.lastAccessedAt = Date.now();
        });
      });
    } catch (error) {
      console.error('MemoryRepository: error recording access:', error);
    }
  }

  /** Hides the memory from normal retrieval/browsing without destroying it. */
  async softDelete(id: string): Promise<void> {
    try {
      const record = await this.collection().find(id);
      await database.write(async () => {
        await record.update((r: Memory) => {
          r.status = 'retired';
        });
      });
    } catch (error) {
      console.error('MemoryRepository: error soft-deleting memory:', error);
    }
  }

  /** Permanently removes the row. Only ever called on an explicit user action. */
  async hardDelete(id: string): Promise<void> {
    try {
      const record = await this.collection().find(id);
      await database.write(async () => {
        await record.destroyPermanently();
      });
    } catch (error) {
      console.error('MemoryRepository: error hard-deleting memory:', error);
    }
  }

  /**
   * Ranks active, embedded memories by cosine similarity to the query
   * vector. Brute-force in JS: at personal-use scale (thousands, not
   * millions, of memories) this is fast enough without a native ANN index.
   */
  async searchByEmbedding(
    queryVector: Float32Array,
    limit: number = 10,
  ): Promise<Array<MemoryView & {similarity: number}>> {
    try {
      const records = await this.collection()
        .query(Q.where('status', 'active'))
        .fetch();

      const scored = records
        .map(record => ({record, vector: record.embeddingVector}))
        .filter(
          (entry): entry is {record: Memory; vector: Float32Array} =>
            entry.vector !== undefined,
        )
        .map(({record, vector}) => ({
          ...record.toView(),
          similarity: cosineSimilarity(queryVector, vector),
        }))
        .sort((a, b) => b.similarity - a.similarity);

      return scored.slice(0, limit);
    } catch (error) {
      console.error('MemoryRepository: error searching by embedding:', error);
      return [];
    }
  }
}

export default new MemoryRepository();
export {cosineSimilarity};
