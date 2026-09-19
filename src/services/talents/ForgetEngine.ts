import {TalentEngine, TalentResult, ToolDefinition} from './types';
import memoryRepository from '../../repositories/MemoryRepository';

/**
 * NOT registered via registerDefaultTalents()/talentRegistry — see the
 * comment on RememberEngine. Same global-capability reasoning applies here.
 */
export class ForgetEngine implements TalentEngine {
  readonly name = 'forget';

  async execute(args: Record<string, any>): Promise<TalentResult> {
    const memoryId =
      typeof args.memory_id === 'string' ? args.memory_id.trim() : '';
    if (!memoryId) {
      return {
        type: 'error',
        summary: 'forget: missing or empty "memory_id" argument',
        errorMessage: 'memory_id is required and must be a non-empty string',
      };
    }

    try {
      // Soft-delete only: this retires the memory from normal recall. Hard
      // deletion is a deliberate, user-only action exposed through the
      // memory management screen — never through a live tool call, so a
      // single bad call here is always recoverable.
      await memoryRepository.softDelete(memoryId);
      return {
        type: 'text',
        summary: `Forgot memory ${memoryId}.`,
      };
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      return {
        type: 'error',
        summary: 'forget: failed to retire memory',
        errorMessage: errMsg,
      };
    }
  }

  toToolDefinition(): ToolDefinition {
    return {
      type: 'function',
      function: {
        name: 'forget',
        description:
          'Retire a previously stored memory that is no longer accurate, or that the user asked you to forget. This hides it from future recall; it does not permanently delete it.',
        parameters: {
          type: 'object',
          properties: {
            memory_id: {
              type: 'string',
              description:
                'The id of the memory to retire, as given when it was retrieved.',
            },
          },
          required: ['memory_id'],
        },
      },
    };
  }
}
