const mockIsMemoryEnabled = jest.fn();
const mockGetEmbeddingModelPath = jest.fn();
const mockGetSessionById = jest.fn();
const mockCreateMemory = jest.fn();
const mockCreateMemoryWithEmbedding = jest.fn();
const mockCompletion = jest.fn();
const mockConvertToChatMessages = jest.fn();

jest.mock('../../../repositories/MemorySettingsRepository', () => ({
  __esModule: true,
  default: {
    isMemoryEnabled: (...args: any[]) => mockIsMemoryEnabled(...args),
    getEmbeddingModelPath: (...args: any[]) =>
      mockGetEmbeddingModelPath(...args),
  },
}));

jest.mock('../../../repositories/MemoryRepository', () => ({
  __esModule: true,
  default: {
    createMemory: (...args: any[]) => mockCreateMemory(...args),
    createMemoryWithEmbedding: (...args: any[]) =>
      mockCreateMemoryWithEmbedding(...args),
  },
}));

jest.mock('../../../repositories/ChatSessionRepository', () => ({
  chatSessionRepository: {
    getSessionById: (...args: any[]) => mockGetSessionById(...args),
  },
}));

jest.mock('../../../utils/chat', () => ({
  convertToChatMessages: (...args: any[]) => mockConvertToChatMessages(...args),
}));

jest.mock('../../../store', () => ({
  modelStore: {
    engine: {completion: (...args: any[]) => mockCompletion(...args)},
  },
  chatSessionStore: {isGenerating: false},
}));

import {maybeRunMemoryExtraction} from '../runMemoryExtraction';
import {chatSessionStore} from '../../../store';

function makeSessionMessage(overrides: Record<string, any> = {}) {
  return {toMessageObject: () => ({id: 'ui-msg', ...overrides})};
}

describe('maybeRunMemoryExtraction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (chatSessionStore as any).isGenerating = false;
    mockIsMemoryEnabled.mockResolvedValue(true);
    mockGetEmbeddingModelPath.mockResolvedValue(undefined);
    mockCompletion.mockResolvedValue({text: '[]'});
    mockConvertToChatMessages.mockReturnValue([]);
  });

  it('does nothing when memory is disabled', async () => {
    mockIsMemoryEnabled.mockResolvedValue(false);
    await maybeRunMemoryExtraction('session-1');
    expect(mockGetSessionById).not.toHaveBeenCalled();
  });

  it('does nothing while the engine is busy generating the visible turn', async () => {
    (chatSessionStore as any).isGenerating = true;
    await maybeRunMemoryExtraction('session-1');
    expect(mockGetSessionById).not.toHaveBeenCalled();
  });

  it('does nothing when the session has no messages', async () => {
    mockGetSessionById.mockResolvedValue({messages: []});
    await maybeRunMemoryExtraction('session-1');
    expect(mockCompletion).not.toHaveBeenCalled();
  });

  it('does nothing when the session is not found', async () => {
    mockGetSessionById.mockResolvedValue(null);
    await maybeRunMemoryExtraction('session-1');
    expect(mockCompletion).not.toHaveBeenCalled();
  });

  it('builds turns from tool/user/assistant roles and persists extracted candidates without an embedding model', async () => {
    mockGetSessionById.mockResolvedValue({
      messages: [makeSessionMessage(), makeSessionMessage()],
    });
    mockConvertToChatMessages.mockReturnValue([
      {role: 'user', content: 'search for cats'},
      {role: 'tool', content: 'a page about cats'},
      {role: 'assistant', content: 'here is what I found'},
      {role: 'system', content: 'ignored'},
    ]);
    mockCompletion.mockResolvedValue({
      text: JSON.stringify([{content: 'user is researching cats'}]),
    });

    await maybeRunMemoryExtraction('session-1');

    expect(mockCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        response_format: expect.objectContaining({type: 'json_schema'}),
      }),
    );
    expect(mockCreateMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'user is researching cats',
        sourceConversationId: 'session-1',
      }),
    );
    expect(mockCreateMemoryWithEmbedding).not.toHaveBeenCalled();
  });

  it('uses createMemoryWithEmbedding when an embedding model path is configured', async () => {
    mockGetSessionById.mockResolvedValue({messages: [makeSessionMessage()]});
    mockConvertToChatMessages.mockReturnValue([
      {role: 'user', content: 'I like dark mode'},
    ]);
    mockCompletion.mockResolvedValue({
      text: JSON.stringify([{content: 'likes dark mode'}]),
    });
    mockGetEmbeddingModelPath.mockResolvedValue('/models/bge-small.gguf');

    await maybeRunMemoryExtraction('session-1');

    expect(mockCreateMemoryWithEmbedding).toHaveBeenCalledWith(
      '/models/bge-small.gguf',
      expect.objectContaining({content: 'likes dark mode'}),
    );
    expect(mockCreateMemory).not.toHaveBeenCalled();
  });

  it('does not persist anything when extraction finds no candidates', async () => {
    mockGetSessionById.mockResolvedValue({messages: [makeSessionMessage()]});
    mockConvertToChatMessages.mockReturnValue([
      {role: 'user', content: 'hello'},
    ]);
    mockCompletion.mockResolvedValue({text: '[]'});

    await maybeRunMemoryExtraction('session-1');

    expect(mockCreateMemory).not.toHaveBeenCalled();
    expect(mockCreateMemoryWithEmbedding).not.toHaveBeenCalled();
  });

  it('swallows an error from the completion engine rather than throwing', async () => {
    mockGetSessionById.mockResolvedValue({messages: [makeSessionMessage()]});
    mockConvertToChatMessages.mockReturnValue([
      {role: 'user', content: 'hello'},
    ]);
    mockCompletion.mockRejectedValue(new Error('engine exploded'));

    await expect(
      maybeRunMemoryExtraction('session-1'),
    ).resolves.toBeUndefined();
  });

  it('does nothing when there is no active model engine', async () => {
    jest.resetModules();
    jest.doMock('../../../store', () => ({
      modelStore: {engine: undefined},
      chatSessionStore: {isGenerating: false},
    }));
    jest.doMock('../../../repositories/MemorySettingsRepository', () => ({
      __esModule: true,
      default: {
        isMemoryEnabled: () => Promise.resolve(true),
        getEmbeddingModelPath: () => Promise.resolve(undefined),
      },
    }));
    jest.doMock('../../../repositories/ChatSessionRepository', () => ({
      chatSessionRepository: {
        getSessionById: () =>
          Promise.resolve({messages: [makeSessionMessage()]}),
      },
    }));
    jest.doMock('../../../utils/chat', () => ({
      convertToChatMessages: () => [{role: 'user', content: 'hello'}],
    }));
    const {maybeRunMemoryExtraction: run} = require('../runMemoryExtraction');
    await expect(run('session-1')).resolves.toBeUndefined();
  });
});
