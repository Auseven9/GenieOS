import {Model} from '@nozbe/watermelondb';
import {field, readonly, date} from '@nozbe/watermelondb/decorators';
import {encodeBase64, decodeBase64} from '../../utils/base64';
import type {
  Memory as MemoryView,
  MemoryKind,
  MemoryProvenance,
  MemoryStatus,
} from '../../types/memory';

export default class Memory extends Model {
  static table = 'memories';

  @field('kind') kind!: MemoryKind;
  @field('content') content!: string;
  @field('embedding') embedding?: string; // base64 Float32Array
  @field('confidence') confidence!: number;
  @field('valence') valence?: number;
  @field('intensity') intensity?: number;
  @field('provenance') provenance!: MemoryProvenance;
  @field('source_conversation_id') sourceConversationId?: string;
  @field('tags') tags!: string; // JSON stringified string[]
  @field('pinned') pinned!: boolean;
  @field('superseded_by') supersededBy?: string;
  @field('status') status!: MemoryStatus;
  @field('last_accessed_at') lastAccessedAt?: number;
  @field('access_count') accessCount!: number;
  @readonly @date('created_at') createdAt!: Date;
  @readonly @date('updated_at') updatedAt!: Date;

  get tagsArray(): string[] {
    try {
      return JSON.parse(this.tags || '[]');
    } catch {
      return [];
    }
  }

  /** Decodes the base64-stored embedding back into a float vector for cosine comparison. */
  get embeddingVector(): Float32Array | undefined {
    if (!this.embedding) {
      return undefined;
    }
    try {
      const bytes = decodeBase64(this.embedding);
      return new Float32Array(
        bytes.buffer,
        bytes.byteOffset,
        bytes.byteLength / 4,
      );
    } catch {
      return undefined;
    }
  }

  toView(): MemoryView {
    return {
      id: this.id,
      kind: this.kind,
      content: this.content,
      embedding: this.embedding,
      confidence: this.confidence,
      valence: this.valence,
      intensity: this.intensity,
      provenance: this.provenance,
      sourceConversationId: this.sourceConversationId,
      tags: this.tagsArray,
      pinned: this.pinned,
      supersededBy: this.supersededBy,
      status: this.status,
      lastAccessedAt: this.lastAccessedAt
        ? new Date(this.lastAccessedAt).toISOString()
        : undefined,
      accessCount: this.accessCount,
      createdAt: this.createdAt.toISOString(),
      updatedAt: this.updatedAt.toISOString(),
    };
  }

  /** Encodes a float vector for storage in the `embedding` text column. */
  static encodeEmbedding(vector: Float32Array): string {
    const bytes = new Uint8Array(
      vector.buffer,
      vector.byteOffset,
      vector.byteLength,
    );
    return encodeBase64(bytes);
  }

  static safeStringifyArray(value: string[]): string {
    try {
      return JSON.stringify(value || []);
    } catch {
      return '[]';
    }
  }
}
