const mockIsMemoryEnabled = jest.fn();
const mockGetEmbeddingModelPath = jest.fn();

jest.mock('../../repositories/MemorySettingsRepository', () => ({
  __esModule: true,
  default: {
    isMemoryEnabled: (...args: any[]) => mockIsMemoryEnabled(...args),
    getEmbeddingModelPath: (...args: any[]) =>
      mockGetEmbeddingModelPath(...args),
  },
}));

import {chatSessionStore, defaultCompletionSettings} from '../ChatSessionStore';
import {palStore} from '../PalStore';
import type {Pal} from '../PalStore';

function toolNamesOf(result: {tools?: unknown}): string[] {
  return ((result.tools ?? []) as any[]).map(t => t?.function?.name ?? t?.name);
}

describe('ChatSessionStore - memory tools injection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    chatSessionStore.sessions = [];
    chatSessionStore.activeSessionId = null;
    chatSessionStore.newChatPalId = undefined;
    chatSessionStore.newChatCompletionSettings = {...defaultCompletionSettings};
    chatSessionStore.newChatThinkingOverride = undefined;
    palStore.pals = [];
    mockIsMemoryEnabled.mockResolvedValue(false);
    mockGetEmbeddingModelPath.mockResolvedValue(undefined);
  });

  it('adds no remember/forget tools when memory is disabled (the current, live-app default)', async () => {
    const result = await chatSessionStore.resolveCompletionSettings();
    const names = toolNamesOf(result);
    expect(names).not.toContain('remember');
    expect(names).not.toContain('forget');
  });

  it('adds remember and forget tool definitions when memory is enabled', async () => {
    mockIsMemoryEnabled.mockResolvedValue(true);
    mockGetEmbeddingModelPath.mockResolvedValue('/models/bge-small.gguf');

    const result = await chatSessionStore.resolveCompletionSettings();
    const names = toolNamesOf(result);
    expect(names).toContain('remember');
    expect(names).toContain('forget');
  });

  it('appends memory tools alongside PACT-derived tools rather than replacing them', async () => {
    const palWithTalent: Pal = {
      id: 'palToolful',
      name: 'Toolful',
      systemPrompt: '',
      isSystemPromptChanged: false,
      useAIPrompt: false,
      source: 'local',
      pact: {talents: [{name: 'calculate', necessity: 'required'}]},
    } as unknown as Pal;
    palStore.pals.push(palWithTalent);
    mockIsMemoryEnabled.mockResolvedValue(true);
    mockGetEmbeddingModelPath.mockResolvedValue('/models/bge-small.gguf');

    const result = await chatSessionStore.resolveCompletionSettings(
      undefined,
      'palToolful',
    );
    const names = toolNamesOf(result);
    expect(names).toContain('calculate');
    expect(names).toContain('remember');
    expect(names).toContain('forget');
  });

  it('does not break settings resolution when the memory settings lookup throws', async () => {
    mockIsMemoryEnabled.mockRejectedValue(new Error('db exploded'));
    const result = await chatSessionStore.resolveCompletionSettings();
    expect(toolNamesOf(result)).not.toContain('remember');
  });
});
