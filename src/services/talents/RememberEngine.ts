import {TalentEngine, TalentResult, ToolDefinition} from './types';
import memoryRepository from '../../repositories/MemoryRepository';
import {
  VALID_KINDS,
  VALID_PROVENANCE,
  toMemoryInput,
} from '../memory/validateMemoryInput';

/**
 * NOT registered via registerDefaultTalents()/talentRegistry. Memory write
 * access is a cross-cutting device capability the user turns on globally,
 * not a per-Pal opt-in like web_search or render_html — a downloaded or
 * locally-authored Pal must never be able to grant itself write access to
 * the permanent memory store just by listing it in pact.talents (see the
 * PalsHub audit finding on undisclosed talent grants). Wiring this into
 * the model's actual tool list is a separate step gated by a global
 * "memory enabled" setting, handled where the tool list is assembled.
 */
export class RememberEngine implements TalentEngine {
  readonly name = 'remember';

  // Optional: absent until the user has configured an embedding model.
  // Falls back to storing the memory without a vector — it's still
  // browsable/pinnable/deletable, just not semantically searchable until
  // an embedding model is configured (or a later backfill pass runs).
  constructor(private embeddingModelPath?: string) {}

  async execute(args: Record<string, any>): Promise<TalentResult> {
    const input = toMemoryInput(args);
    if (!input) {
      return {
        type: 'error',
        summary: 'remember: missing or empty "content" argument',
        errorMessage: 'content is required and must be a non-empty string',
      };
    }

    try {
      await (this.embeddingModelPath
        ? memoryRepository.createMemoryWithEmbedding(
            this.embeddingModelPath,
            input,
          )
        : memoryRepository.createMemory(input));
      return {
        type: 'text',
        summary: `Remembered: ${input.content}`,
      };
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      return {
        type: 'error',
        summary: 'remember: failed to store memory',
        errorMessage: errMsg,
      };
    }
  }

  toToolDefinition(): ToolDefinition {
    return {
      type: 'function',
      function: {
        name: 'remember',
        description:
          'Store a durable fact, preference, or event about the user for future conversations. Use this when the user shares something worth remembering long-term, or explicitly asks you to remember something.',
        parameters: {
          type: 'object',
          properties: {
            content: {
              type: 'string',
              description:
                'The memory to store, written as a clear standalone statement.',
            },
            kind: {
              type: 'string',
              enum: VALID_KINDS,
              description: 'What kind of memory this is.',
            },
            tags: {
              type: 'array',
              items: {type: 'string'},
              description: 'Optional topic tags for later retrieval.',
            },
            provenance: {
              type: 'string',
              enum: VALID_PROVENANCE,
              description:
                '"user_stated" if the user said this directly; "model_inferred" if you inferred it yourself.',
            },
            confidence: {
              type: 'number',
              description:
                'How sure you are this is durable and true, from 0 to 1.',
            },
          },
          required: ['content'],
        },
      },
    };
  }
}
