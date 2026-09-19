import {Model} from '@nozbe/watermelondb';
import {field, readonly, date} from '@nozbe/watermelondb/decorators';
import {encodeBase64, decodeBase64} from '../../utils/base64';
import type {
  MemoryNode as MemoryNodeView,
  MemoryNodeKind,
} from '../../types/memoryGraph';
import type {MemoryProvenance, MemoryStatus} from '../../types/memory';

export default class MemoryNode extends Model {
  static table = 'memory_nodes';

  @field('label') label!: string;
  @field('kind') kind!: MemoryNodeKind;
  @field('description') description?: string;
  @field('embedding') embedding?: string; // base64 Float32Array
  @field('confidence') confidence!: number;
  @field('valence') valence?: number;
  @field('intensity') intensity?: number;
  @field('compartment_id') compartmentId?: string;
  @field('provenance') provenance!: MemoryProvenance;
  @field('source_memory_id') sourceMemoryId?: string;
  @field('pinned') pinned!: boolean;
  @field('status') status!: MemoryStatus;
  @field('last_accessed_at') lastAccessedAt?: number;
  @field('access_count') accessCount!: number;
  @readonly @date('created_at') createdAt!: Date;
  @readonly @date('updated_at') updatedAt!: Date;

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

  toView(): MemoryNodeView {
    return {
      id: this.id,
      label: this.label,
      kind: this.kind,
      description: this.description,
      embedding: this.embedding,
      confidence: this.confidence,
      valence: this.valence,
      intensity: this.intensity,
      compartmentId: this.compartmentId,
      provenance: this.provenance,
      sourceMemoryId: this.sourceMemoryId,
      pinned: this.pinned,
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
}
