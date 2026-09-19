import {Model} from '@nozbe/watermelondb';
import {field, readonly, date} from '@nozbe/watermelondb/decorators';
import type {
  MemoryEdge as MemoryEdgeView,
  MemoryEdgeRelation,
} from '../../types/memoryGraph';
import type {MemoryProvenance, MemoryStatus} from '../../types/memory';

export default class MemoryEdge extends Model {
  static table = 'memory_edges';

  @field('source_node_id') sourceNodeId!: string;
  @field('target_node_id') targetNodeId!: string;
  @field('relation') relation!: MemoryEdgeRelation;
  @field('weight') weight!: number;
  @field('confidence') confidence!: number;
  @field('provenance') provenance!: MemoryProvenance;
  @field('source_conversation_id') sourceConversationId?: string;
  @field('status') status!: MemoryStatus;
  @readonly @date('created_at') createdAt!: Date;
  @readonly @date('updated_at') updatedAt!: Date;

  toView(): MemoryEdgeView {
    return {
      id: this.id,
      sourceNodeId: this.sourceNodeId,
      targetNodeId: this.targetNodeId,
      relation: this.relation,
      weight: this.weight,
      confidence: this.confidence,
      provenance: this.provenance,
      sourceConversationId: this.sourceConversationId,
      status: this.status,
      createdAt: this.createdAt.toISOString(),
      updatedAt: this.updatedAt.toISOString(),
    };
  }
}
