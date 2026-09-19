import {modelStore, chatSessionStore} from '../../store';
import {resolveDraftModelId} from '../../store/draftResolution';
import {chatSessionRepository} from '../../repositories/ChatSessionRepository';
import memoryRepository from '../../repositories/MemoryRepository';
import memoryGraphRepository from '../../repositories/MemoryGraphRepository';
import memorySettingsRepository from '../../repositories/MemorySettingsRepository';
import {convertToChatMessages} from '../../utils/chat';
import draftCompletionEngine from './DraftCompletionEngine';
import {
  extractMemoryGraph,
  type ConversationTurn,
} from './GraphExtractionPipeline';
import {
  VALID_NODE_KINDS,
  VALID_RELATIONS,
  type GraphNodeCandidate,
} from './validateMemoryGraphInput';
import type {MemoryKind} from '../../types/memory';

// Bounds the prompt size for the extraction pass itself — this is separate
// from, and much smaller than, the digest's own retrieval budget.
const EXTRACTION_WINDOW_SIZE = 20;

const GRAPH_EXTRACTION_SCHEMA = {
  type: 'object',
  properties: {
    compartment: {type: ['string', 'null']},
    nodes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          label: {type: 'string'},
          content: {type: 'string'},
          kind: {type: 'string', enum: VALID_NODE_KINDS},
          memory_type: {type: 'string', enum: ['episodic', 'semantic']},
          confidence: {type: 'number'},
          valence: {type: 'number'},
          salience: {type: 'number'},
          provenance: {
            type: 'string',
            enum: ['user_stated', 'model_inferred'],
          },
        },
        required: ['label', 'content', 'memory_type'],
      },
    },
    edges: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          source_label: {type: 'string'},
          target_label: {type: 'string'},
          relation_type: {type: 'string', enum: VALID_RELATIONS},
          weight: {type: 'number'},
          confidence: {type: 'number'},
        },
        required: ['source_label', 'target_label', 'relation_type'],
      },
    },
  },
  required: ['nodes'],
};

/**
 * Maps a graph node's (memoryType, kind) onto the flat `memories` table's
 * own kind enum, so every extracted node still lands a `memories` row too
 * — that's what MemoryDigestBuilder's pinned/searchByText retrieval reads,
 * and it stays completely unaware the graph exists underneath it.
 */
function toMemoryKind(node: GraphNodeCandidate): MemoryKind {
  if (node.memoryType === 'episodic') {
    return 'episodic';
  }
  switch (node.kind) {
    case 'preference':
      return 'preference';
    case 'open_thread':
      return 'open_thread';
    case 'event':
      return 'episodic';
    default:
      return 'fact';
  }
}

/**
 * Resolves the file path of the configured draft model — the small model
 * paired for speculative decoding with the active chat model — for use as
 * an independent completion engine. Reuses resolveDraftModelId() (plain ID
 * lookup) rather than resolveDraftCandidate(), since the latter's
 * MTP-capability/embedding-width checks only guard speculative-decoding
 * pairing validity and don't apply to running the draft model standalone.
 *
 * Returns undefined (never throws) whenever no draft model is configured
 * or downloaded, so callers can fall back to the active chat model instead.
 */
async function resolveDraftModelPath(): Promise<string | undefined> {
  const activeModel = modelStore.activeModel;
  if (!activeModel) {
    return undefined;
  }
  const draftId = resolveDraftModelId(
    activeModel,
    modelStore.contextInitParams.selectedDraftModelId,
  );
  if (!draftId) {
    return undefined;
  }
  const draftModel = modelStore.models.find(m => m.id === draftId);
  if (!draftModel || !draftModel.isDownloaded) {
    return undefined;
  }
  try {
    return await modelStore.getModelFullPath(draftModel);
  } catch {
    return undefined;
  }
}

/**
 * Builds the plain text-in/text-out completion function
 * GraphExtractionPipeline expects. Schema-constrained via
 * response_format.json_schema — llama.rn's own completion() converts this
 * into the native grammar/json_schema constraint for local llama.cpp
 * contexts, and the OpenAI-compatible remote engine forwards it verbatim,
 * so this one shape works for either backend. extractMemoryGraph still
 * defends against malformed output regardless.
 *
 * Three-model architecture: prefers the small draft model, loaded as its
 * own independent context so it reasons about what to remember without
 * borrowing whichever chat model is currently active. Falls back to the
 * active chat model's engine only when no draft model is configured/
 * downloaded, so extraction still works before that pairing is set up.
 */
async function createModelCompletionFn(): Promise<
  (prompt: string) => Promise<string>
> {
  const draftModelPath = await resolveDraftModelPath();
  if (draftModelPath) {
    return (prompt: string) =>
      draftCompletionEngine.complete(draftModelPath, prompt, {
        jsonSchema: GRAPH_EXTRACTION_SCHEMA,
        temperature: 0.2,
        nPredict: 1500,
      });
  }

  const engine = modelStore.engine;
  if (!engine) {
    throw new Error('runMemoryExtraction: no active model engine');
  }
  return async (prompt: string) => {
    const result = await engine.completion({
      messages: [{role: 'user', content: prompt}],
      response_format: {
        type: 'json_schema',
        json_schema: {strict: true, schema: GRAPH_EXTRACTION_SCHEMA},
      },
      temperature: 0.2,
      n_predict: 1500,
      enable_thinking: false,
    });
    return result.text;
  };
}

/**
 * Runs the post-turn extraction pass for a session and persists whatever
 * graph nodes/edges it finds — plus a flat `memories` row per node, so
 * existing digest retrieval keeps working unchanged. Fire-and-forget from
 * the caller's perspective: every failure mode here is swallowed and
 * logged, since memory retrieval/extraction must never be able to disrupt
 * the visible chat.
 *
 * Guarded on chatSessionStore.isGenerating so this never issues a second,
 * concurrent completion() call against the same engine while the visible
 * turn is still streaming — that concurrency has not been verified safe
 * against a real device/context and is not something to find out the hard
 * way in production.
 *
 * Also a no-op today: gated by isMemoryEnabled(), same as every other
 * memory entry point, so this function existing changes nothing until
 * memory is turned on in settings.
 */
export async function maybeRunMemoryExtraction(
  sessionId: string,
): Promise<void> {
  try {
    const memoryEnabled = await memorySettingsRepository.isMemoryEnabled();
    if (!memoryEnabled) {
      return;
    }
    if (chatSessionStore.isGenerating) {
      return;
    }

    const sessionData = await chatSessionRepository.getSessionById(sessionId);
    if (!sessionData || sessionData.messages.length === 0) {
      return;
    }

    // sessionData.messages is sorted most-recent-first (see
    // ChatSessionRepository.getSessionById); extraction needs chronological
    // order, oldest of the window first.
    const chronological = [...sessionData.messages].reverse();
    const recentUiMessages = chronological
      .slice(-EXTRACTION_WINDOW_SIZE)
      .map(msg => msg.toMessageObject());
    const apiMessages = convertToChatMessages(recentUiMessages, false);

    const turns: ConversationTurn[] = apiMessages
      .filter(
        (m): m is typeof m & {role: 'user' | 'assistant' | 'tool'} =>
          m.role === 'user' || m.role === 'assistant' || m.role === 'tool',
      )
      .map(m => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        text:
          typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
        source: m.role === 'tool' ? 'external_content' : undefined,
      }));

    if (turns.length === 0) {
      return;
    }

    const complete = await createModelCompletionFn();
    const graph = await extractMemoryGraph(turns, complete);
    if (graph.nodes.length === 0) {
      return;
    }

    const embeddingModelPath =
      await memorySettingsRepository.getEmbeddingModelPath();

    const compartmentId = graph.compartment
      ? (await memoryGraphRepository.getOrCreateCompartment(graph.compartment))
          .id
      : undefined;

    // Maps each extracted node's label to the id it actually landed at
    // (which may be an existing semantic node's id, via findOrCreateNode's
    // dedup) so edges below can resolve their source/target labels.
    const nodeIdByLabel = new Map<string, string>();
    for (const node of graph.nodes) {
      const memoryInput = {
        kind: toMemoryKind(node),
        content: node.content,
        provenance: node.provenance,
        confidence: node.confidence,
        valence: node.valence,
        tags: [],
        sourceConversationId: sessionId,
      };
      const memory = embeddingModelPath
        ? await memoryRepository.createMemoryWithEmbedding(
            embeddingModelPath,
            memoryInput,
          )
        : await memoryRepository.createMemory(memoryInput);

      const nodeInput = {
        label: node.label,
        kind: node.kind,
        memoryType: node.memoryType,
        description: node.content,
        confidence: node.confidence,
        valence: node.valence,
        salience: node.salience,
        compartmentId,
        provenance: node.provenance,
        sourceMemoryId: memory.id,
      };
      const createdNode = embeddingModelPath
        ? await memoryGraphRepository.findOrCreateNode(
            nodeInput,
            embeddingModelPath,
          )
        : await memoryGraphRepository.findOrCreateNode(nodeInput);
      nodeIdByLabel.set(node.label.toLowerCase(), createdNode.id);
    }

    for (const edge of graph.edges) {
      const sourceNodeId = nodeIdByLabel.get(edge.sourceLabel.toLowerCase());
      const targetNodeId = nodeIdByLabel.get(edge.targetLabel.toLowerCase());
      if (!sourceNodeId || !targetNodeId) {
        continue;
      }
      await memoryGraphRepository.upsertEdge({
        sourceNodeId,
        targetNodeId,
        relation: edge.relation,
        weight: edge.weight,
        confidence: edge.confidence,
        // Edges are the extraction model's own inferred relations between
        // two (independently provenance-tracked) nodes, never something
        // the user stated directly themselves.
        provenance: 'model_inferred',
        sourceConversationId: sessionId,
      });
    }
  } catch (error) {
    console.error('runMemoryExtraction: extraction pass failed:', error);
  }
}
