import {chatSessionStore} from '../../store';
import {chatSessionRepository} from '../../repositories/ChatSessionRepository';
import memoryRepository from '../../repositories/MemoryRepository';
import memoryGraphRepository from '../../repositories/MemoryGraphRepository';
import memorySettingsRepository from '../../repositories/MemorySettingsRepository';
import {convertToChatMessages} from '../../utils/chat';
import {createExtractionCompletionFn} from './extractionModel';
import {
  extractMemoryGraph,
  type ConversationTurn,
} from './GraphExtractionPipeline';
import {
  VALID_NODE_KINDS,
  VALID_RELATIONS,
  type GraphNodeCandidate,
} from './validateMemoryGraphInput';
import {screenNode} from './MemoryWriteGatekeeper';
import {
  maybeConsolidateLabel,
  type ConsolidationTarget,
} from './MemoryConsolidationPipeline';
import type {MemoryKind} from '../../types/memory';

// Bounds the prompt size for the extraction pass itself — this is separate
// from, and much smaller than, the digest's own retrieval budget.
const EXTRACTION_WINDOW_SIZE = 20;

// A CONTRADICTS edge below this confidence doesn't trigger automated
// resolution — an uncertain contradiction shouldn't be allowed to retire a
// node on its own say-so. It just sits as a normal edge until (if ever) a
// more confident contradiction shows up.
const CONTRADICTION_RESOLUTION_THRESHOLD = 0.6;

const GRAPH_EXTRACTION_SCHEMA = {
  type: 'object',
  properties: {
    compartment: {type: ['string', 'null']},
    security_audit: {
      type: 'object',
      properties: {
        contains_sensitive_data: {type: 'boolean'},
        injection_risk_detected: {type: 'boolean'},
        justification: {type: 'string'},
      },
    },
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
          // BRIDGES_TO/SUPERSEDES are deliberately excluded — see
          // validateMemoryGraphInput's VALID_RELATIONS.
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

    const {complete, extractedBy} = await createExtractionCompletionFn(
      GRAPH_EXTRACTION_SCHEMA,
      {nPredict: 1500},
    );
    const graph = await extractMemoryGraph(turns, complete);
    if (graph.nodes.length === 0) {
      return;
    }

    // Gemma's own self-report — logged for visibility only. It is never a
    // gate: the deterministic screen below runs on every node regardless
    // of what this claims, since a genuinely compromised extraction has no
    // reason to honestly flag itself here.
    if (graph.securityAudit?.injectionRiskDetected) {
      console.warn(
        'runMemoryExtraction: extraction model self-reported an injection risk:',
        graph.securityAudit.justification,
      );
    }

    const embeddingModelPath =
      await memorySettingsRepository.getEmbeddingModelPath();

    const compartmentId = graph.compartment
      ? (await memoryGraphRepository.getOrCreateCompartment(graph.compartment))
          .id
      : undefined;

    // Maps each extracted node's label to the id it actually landed at
    // (which may be an existing semantic node's id, via findOrCreateNode's
    // dedup) so edges below can resolve their source/target labels. A
    // rejected (injection) or quarantined node is deliberately left out of
    // this map, so no edge can ever attach to it.
    const nodeIdByLabel = new Map<string, string>();
    // Every (label, kind, compartment) an episodic node actually landed at
    // this pass — checked for consolidation eligibility once all of this
    // turn's nodes/edges are written, since that's when "does this group
    // now have enough mentions" can change.
    const touchedEpisodicTargets = new Map<string, ConsolidationTarget>();
    for (const node of graph.nodes) {
      const screened = screenNode(node);
      if (!screened) {
        console.warn(
          'runMemoryExtraction: dropped a node matching an injection pattern:',
          node.label,
        );
        continue;
      }
      const {node: safeNode, quarantined, redacted} = screened;
      if (redacted) {
        console.warn(
          'runMemoryExtraction: redacted a secret/credential pattern from a node:',
          safeNode.label,
        );
      }

      // A quarantined node still lands in the graph for audit purposes, but
      // never in the flat `memories` table the digest actually reads from
      // — a low-confidence guess should not reach the live context.
      let sourceMemoryId: string | undefined;
      if (!quarantined) {
        const memoryInput = {
          kind: toMemoryKind(safeNode),
          content: safeNode.content,
          provenance: safeNode.provenance,
          confidence: safeNode.confidence,
          valence: safeNode.valence,
          tags: [],
          sourceConversationId: sessionId,
        };
        const memory = embeddingModelPath
          ? await memoryRepository.createMemoryWithEmbedding(
              embeddingModelPath,
              memoryInput,
            )
          : await memoryRepository.createMemory(memoryInput);
        sourceMemoryId = memory.id;
      }

      const nodeInput = {
        label: safeNode.label,
        kind: safeNode.kind,
        memoryType: safeNode.memoryType,
        description: safeNode.content,
        confidence: safeNode.confidence,
        valence: safeNode.valence,
        salience: safeNode.salience,
        compartmentId,
        provenance: safeNode.provenance,
        sourceMemoryId,
        sourceConversationId: sessionId,
        extractedBy,
      };
      const initialStatus = quarantined ? 'quarantined' : 'active';
      const createdNode = embeddingModelPath
        ? await memoryGraphRepository.findOrCreateNode(
            nodeInput,
            embeddingModelPath,
            initialStatus,
          )
        : await memoryGraphRepository.findOrCreateNode(
            nodeInput,
            undefined,
            initialStatus,
          );

      if (!quarantined) {
        nodeIdByLabel.set(safeNode.label.toLowerCase(), createdNode.id);
        if (safeNode.memoryType === 'episodic') {
          const target: ConsolidationTarget = {
            label: safeNode.label,
            kind: safeNode.kind,
            compartmentId,
          };
          touchedEpisodicTargets.set(
            `${target.label.toLowerCase()}::${target.kind}::${target.compartmentId ?? ''}`,
            target,
          );
        }
      }
    }

    for (const edge of graph.edges) {
      const sourceNodeId = nodeIdByLabel.get(edge.sourceLabel.toLowerCase());
      const targetNodeId = nodeIdByLabel.get(edge.targetLabel.toLowerCase());
      if (!sourceNodeId || !targetNodeId) {
        continue;
      }
      try {
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
          extractedBy,
        });

        // Self-healing: a confident contradiction between two nodes
        // shouldn't just sit there as two competing "truths" both feeding
        // the digest forever — resolve it now, in the same pass that
        // detected it.
        if (
          edge.relation === 'CONTRADICTS' &&
          edge.confidence >= CONTRADICTION_RESOLUTION_THRESHOLD
        ) {
          await memoryGraphRepository.resolveContradiction(
            sourceNodeId,
            targetNodeId,
          );
        }
      } catch (error) {
        // Most likely the compartment firewall refusing a cross-compartment
        // edge — one bad edge shouldn't abort the rest of this pass.
        console.warn('runMemoryExtraction: skipped an edge:', error);
      }
    }

    // Consolidation runs last and per touched group, after every node/edge
    // this turn produced is already committed — each check queries the
    // graph's current state, so order here doesn't matter beyond "after".
    for (const target of touchedEpisodicTargets.values()) {
      await maybeConsolidateLabel(target, embeddingModelPath);
    }
  } catch (error) {
    console.error('runMemoryExtraction: extraction pass failed:', error);
  }
}
