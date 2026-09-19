import {Q} from '@nozbe/watermelondb';
import type {Clause} from '@nozbe/watermelondb/QueryDescription';
import {database} from '../database';
import MemoryNode from '../database/models/MemoryNode';
import MemoryEdge from '../database/models/MemoryEdge';
import MemoryCompartment from '../database/models/MemoryCompartment';
import embeddingEngine from '../services/memory/EmbeddingEngine';
import {cosineSimilarity} from './MemoryRepository';
import type {
  MemoryNode as MemoryNodeView,
  MemoryNodeInput,
  MemoryNodeFilter,
  MemoryEdge as MemoryEdgeView,
  MemoryEdgeInput,
  MemoryEdgeFilter,
  MemoryCompartment as MemoryCompartmentView,
  MemoryCompartmentInput,
} from '../types/memoryGraph';

// Reinforcement bump applied to an existing edge's weight each time
// extraction re-derives the same (source, target, relation) triple, rather
// than forking a new parallel edge every turn — this is what makes
// repeatedly-mentioned relations strengthen over time instead of piling up
// as duplicates.
const EDGE_REINFORCEMENT_STEP = 0.1;

class MemoryGraphRepository {
  private nodes() {
    return database.collections.get<MemoryNode>('memory_nodes');
  }

  private edges() {
    return database.collections.get<MemoryEdge>('memory_edges');
  }

  private compartments() {
    return database.collections.get<MemoryCompartment>('memory_compartments');
  }

  // ---- Nodes ----------------------------------------------------------

  async createNode(input: MemoryNodeInput): Promise<MemoryNodeView> {
    try {
      const created = await database.write(async () => {
        return await this.nodes().create((record: MemoryNode) => {
          record.label = input.label;
          record.kind = input.kind;
          record.memoryType = input.memoryType;
          record.description = input.description;
          record.embedding = input.embedding;
          record.confidence = input.confidence ?? 0.5;
          record.valence = input.valence;
          record.intensity = input.intensity;
          record.salience = input.salience;
          record.compartmentId = input.compartmentId;
          record.provenance = input.provenance;
          record.sourceMemoryId = input.sourceMemoryId;
          record.pinned = input.pinned ?? false;
          record.status = 'active';
          record.lastAccessedAt = undefined;
          record.accessCount = 0;
        });
      });
      return created.toView();
    } catch (error) {
      console.error('MemoryGraphRepository: error creating node:', error);
      throw error;
    }
  }

  async createNodeWithEmbedding(
    embeddingModelPath: string,
    input: MemoryNodeInput,
  ): Promise<MemoryNodeView> {
    const vector = await embeddingEngine.embed(
      embeddingModelPath,
      input.description ? `${input.label}: ${input.description}` : input.label,
    );
    return this.createNode({
      ...input,
      embedding: MemoryNode.encodeEmbedding(vector),
    });
  }

  /**
   * Finds an existing active *semantic* node with the same label
   * (case-insensitive) and kind within the same compartment, or creates a
   * new one. This is what keeps the graph a graph rather than a fresh,
   * disconnected node per extraction pass: "cats" mentioned across ten
   * conversations should resolve to the same semantic node every time.
   *
   * Episodic nodes are never deduped this way: each is a distinct,
   * time-stamped instance by design (Tulving's split — see
   * MemoryNodeMemoryType), and it's exactly the accumulation of many
   * episodic nodes that a future consolidation pass collapses into one
   * semantic node. Deduping them here would silently defeat that.
   */
  async findOrCreateNode(
    input: MemoryNodeInput,
    embeddingModelPath?: string,
  ): Promise<MemoryNodeView> {
    if (input.memoryType === 'episodic') {
      return embeddingModelPath
        ? this.createNodeWithEmbedding(embeddingModelPath, input)
        : this.createNode(input);
    }

    try {
      const clauses: Clause[] = [
        Q.where('status', 'active'),
        Q.where('kind', input.kind),
        Q.where('memory_type', 'semantic'),
      ];
      if (input.compartmentId) {
        clauses.push(Q.where('compartment_id', input.compartmentId));
      } else {
        clauses.push(Q.where('compartment_id', null));
      }
      const candidates = await this.nodes()
        .query(...clauses)
        .fetch();
      const normalizedLabel = input.label.trim().toLowerCase();
      const existing = candidates.find(
        node => node.label.trim().toLowerCase() === normalizedLabel,
      );
      if (existing) {
        return existing.toView();
      }
    } catch (error) {
      console.error(
        'MemoryGraphRepository: error looking up existing node:',
        error,
      );
    }

    return embeddingModelPath
      ? this.createNodeWithEmbedding(embeddingModelPath, input)
      : this.createNode(input);
  }

  async getNodeById(id: string): Promise<MemoryNodeView | null> {
    try {
      const record = await this.nodes().find(id);
      return record.toView();
    } catch (error) {
      console.error('MemoryGraphRepository: error fetching node by id:', error);
      return null;
    }
  }

  async listNodes(filter: MemoryNodeFilter = {}): Promise<MemoryNodeView[]> {
    try {
      const clauses: Clause[] = [];
      if (filter.kind) {
        clauses.push(Q.where('kind', filter.kind));
      }
      if (filter.memoryType) {
        clauses.push(Q.where('memory_type', filter.memoryType));
      }
      if (filter.compartmentId) {
        clauses.push(Q.where('compartment_id', filter.compartmentId));
      }
      if (filter.status) {
        clauses.push(Q.where('status', filter.status));
      } else {
        clauses.push(Q.where('status', 'active'));
      }
      if (filter.pinnedOnly) {
        clauses.push(Q.where('pinned', true));
      }
      const records = await this.nodes()
        .query(...clauses)
        .fetch();
      return records.map(record => record.toView());
    } catch (error) {
      console.error('MemoryGraphRepository: error listing nodes:', error);
      return [];
    }
  }

  async setNodePinned(id: string, pinned: boolean): Promise<void> {
    try {
      const record = await this.nodes().find(id);
      await database.write(async () => {
        await record.update((r: MemoryNode) => {
          r.pinned = pinned;
        });
      });
    } catch (error) {
      console.error('MemoryGraphRepository: error setting node pinned:', error);
    }
  }

  async recordNodeAccess(id: string): Promise<void> {
    try {
      const record = await this.nodes().find(id);
      await database.write(async () => {
        await record.update((r: MemoryNode) => {
          r.accessCount = (r.accessCount || 0) + 1;
          r.lastAccessedAt = Date.now();
        });
      });
    } catch (error) {
      console.error(
        'MemoryGraphRepository: error recording node access:',
        error,
      );
    }
  }

  async softDeleteNode(id: string): Promise<void> {
    try {
      const record = await this.nodes().find(id);
      await database.write(async () => {
        await record.update((r: MemoryNode) => {
          r.status = 'retired';
        });
      });
    } catch (error) {
      console.error('MemoryGraphRepository: error soft-deleting node:', error);
    }
  }

  async hardDeleteNode(id: string): Promise<void> {
    try {
      const record = await this.nodes().find(id);
      await database.write(async () => {
        await record.destroyPermanently();
      });
    } catch (error) {
      console.error('MemoryGraphRepository: error hard-deleting node:', error);
    }
  }

  async searchNodesByEmbedding(
    queryVector: Float32Array,
    limit: number = 10,
  ): Promise<Array<MemoryNodeView & {similarity: number}>> {
    try {
      const records = await this.nodes()
        .query(Q.where('status', 'active'))
        .fetch();

      const scored = records
        .map(record => ({record, vector: record.embeddingVector}))
        .filter(
          (entry): entry is {record: MemoryNode; vector: Float32Array} =>
            entry.vector !== undefined,
        )
        .map(({record, vector}) => ({
          ...record.toView(),
          similarity: cosineSimilarity(queryVector, vector),
        }))
        .sort((a, b) => b.similarity - a.similarity);

      return scored.slice(0, limit);
    } catch (error) {
      console.error(
        'MemoryGraphRepository: error searching nodes by embedding:',
        error,
      );
      return [];
    }
  }

  // ---- Edges ------------------------------------------------------------

  private async createEdgeRecord(
    input: MemoryEdgeInput,
  ): Promise<MemoryEdgeView> {
    const created = await database.write(async () => {
      return await this.edges().create((record: MemoryEdge) => {
        record.sourceNodeId = input.sourceNodeId;
        record.targetNodeId = input.targetNodeId;
        record.relation = input.relation;
        record.weight = input.weight ?? 0.5;
        record.confidence = input.confidence ?? 0.5;
        record.provenance = input.provenance;
        record.sourceConversationId = input.sourceConversationId;
        record.status = 'active';
      });
    });
    return created.toView();
  }

  /**
   * Creates a new typed edge, or — if an active edge already connects the
   * same two nodes with the same relation — reinforces it instead: weight
   * nudges up (capped at 1) and confidence is averaged with the new
   * observation. This is the graph's reinforcement mechanism: a relation
   * re-derived across many conversations should get stronger, not
   * duplicate itself into parallel edges.
   */
  async upsertEdge(input: MemoryEdgeInput): Promise<MemoryEdgeView> {
    try {
      const existingMatches = await this.edges()
        .query(
          Q.where('source_node_id', input.sourceNodeId),
          Q.where('target_node_id', input.targetNodeId),
          Q.where('relation', input.relation),
          Q.where('status', 'active'),
        )
        .fetch();

      const existing = existingMatches[0];
      if (!existing) {
        return this.createEdgeRecord(input);
      }

      const nextWeight = Math.min(1, existing.weight + EDGE_REINFORCEMENT_STEP);
      const nextConfidence =
        (existing.confidence + (input.confidence ?? existing.confidence)) / 2;

      await database.write(async () => {
        await existing.update((r: MemoryEdge) => {
          r.weight = nextWeight;
          r.confidence = nextConfidence;
        });
      });
      return existing.toView();
    } catch (error) {
      console.error('MemoryGraphRepository: error upserting edge:', error);
      throw error;
    }
  }

  async getEdgeById(id: string): Promise<MemoryEdgeView | null> {
    try {
      const record = await this.edges().find(id);
      return record.toView();
    } catch (error) {
      console.error('MemoryGraphRepository: error fetching edge by id:', error);
      return null;
    }
  }

  async listEdges(filter: MemoryEdgeFilter = {}): Promise<MemoryEdgeView[]> {
    try {
      const clauses: Clause[] = [];
      if (filter.status) {
        clauses.push(Q.where('status', filter.status));
      } else {
        clauses.push(Q.where('status', 'active'));
      }
      if (filter.relation) {
        clauses.push(Q.where('relation', filter.relation));
      }

      if (!filter.nodeId) {
        const records = await this.edges()
          .query(...clauses)
          .fetch();
        return records.map(record => record.toView());
      }

      const direction = filter.direction ?? 'both';
      const results: MemoryEdge[] = [];
      if (direction === 'outgoing' || direction === 'both') {
        results.push(
          ...(await this.edges()
            .query(...clauses, Q.where('source_node_id', filter.nodeId))
            .fetch()),
        );
      }
      if (direction === 'incoming' || direction === 'both') {
        results.push(
          ...(await this.edges()
            .query(...clauses, Q.where('target_node_id', filter.nodeId))
            .fetch()),
        );
      }

      const seen = new Set<string>();
      return results
        .filter(record => {
          if (seen.has(record.id)) {
            return false;
          }
          seen.add(record.id);
          return true;
        })
        .map(record => record.toView());
    } catch (error) {
      console.error('MemoryGraphRepository: error listing edges:', error);
      return [];
    }
  }

  async softDeleteEdge(id: string): Promise<void> {
    try {
      const record = await this.edges().find(id);
      await database.write(async () => {
        await record.update((r: MemoryEdge) => {
          r.status = 'retired';
        });
      });
    } catch (error) {
      console.error('MemoryGraphRepository: error soft-deleting edge:', error);
    }
  }

  async hardDeleteEdge(id: string): Promise<void> {
    try {
      const record = await this.edges().find(id);
      await database.write(async () => {
        await record.destroyPermanently();
      });
    } catch (error) {
      console.error('MemoryGraphRepository: error hard-deleting edge:', error);
    }
  }

  // ---- Compartments -------------------------------------------------

  async getOrCreateCompartment(
    name: string,
    description?: string,
  ): Promise<MemoryCompartmentView> {
    try {
      const normalized = name.trim().toLowerCase();
      const existing = await this.compartments().query().fetch();
      const match = existing.find(
        c => c.name.trim().toLowerCase() === normalized,
      );
      if (match) {
        return match.toView();
      }
    } catch (error) {
      console.error(
        'MemoryGraphRepository: error looking up existing compartment:',
        error,
      );
    }

    return this.createCompartment({name, description});
  }

  async createCompartment(
    input: MemoryCompartmentInput,
  ): Promise<MemoryCompartmentView> {
    const created = await database.write(async () => {
      return await this.compartments().create((record: MemoryCompartment) => {
        record.name = input.name;
        record.description = input.description;
      });
    });
    return created.toView();
  }

  async listCompartments(): Promise<MemoryCompartmentView[]> {
    try {
      const records = await this.compartments().query().fetch();
      return records.map(record => record.toView());
    } catch (error) {
      console.error(
        'MemoryGraphRepository: error listing compartments:',
        error,
      );
      return [];
    }
  }
}

export default new MemoryGraphRepository();
export {MemoryGraphRepository, EDGE_REINFORCEMENT_STEP};
