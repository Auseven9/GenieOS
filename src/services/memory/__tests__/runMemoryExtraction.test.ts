const mockIsMemoryEnabled = jest.fn();
const mockGetEmbeddingModelPath = jest.fn();
const mockGetSessionById = jest.fn();
const mockCreateMemory = jest.fn();
const mockCreateMemoryWithEmbedding = jest.fn();
const mockCompletion = jest.fn();
const mockConvertToChatMessages = jest.fn();
const mockGetModelFullPath = jest.fn();
const mockDraftComplete = jest.fn();
const mockGetOrCreateCompartment = jest.fn();
const mockFindOrCreateNode = jest.fn();
const mockUpsertEdge = jest.fn();

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

jest.mock('../../../repositories/MemoryGraphRepository', () => ({
  __esModule: true,
  default: {
    getOrCreateCompartment: (...args: any[]) =>
      mockGetOrCreateCompartment(...args),
    findOrCreateNode: (...args: any[]) => mockFindOrCreateNode(...args),
    upsertEdge: (...args: any[]) => mockUpsertEdge(...args),
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
    activeModel: undefined,
    contextInitParams: {},
    models: [],
    getModelFullPath: (...args: any[]) => mockGetModelFullPath(...args),
  },
  chatSessionStore: {isGenerating: false},
}));

jest.mock('../DraftCompletionEngine', () => ({
  __esModule: true,
  default: {complete: (...args: any[]) => mockDraftComplete(...args)},
}));

import {maybeRunMemoryExtraction} from '../runMemoryExtraction';
import {chatSessionStore, modelStore} from '../../../store';

function makeSessionMessage(overrides: Record<string, any> = {}) {
  return {toMessageObject: () => ({id: 'ui-msg', ...overrides})};
}

function graphResponse(overrides: Record<string, any> = {}) {
  return JSON.stringify({nodes: [], edges: [], ...overrides});
}

describe('maybeRunMemoryExtraction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (chatSessionStore as any).isGenerating = false;
    (modelStore as any).activeModel = undefined;
    (modelStore as any).contextInitParams = {};
    (modelStore as any).models = [];
    mockIsMemoryEnabled.mockResolvedValue(true);
    mockGetEmbeddingModelPath.mockResolvedValue(undefined);
    mockCompletion.mockResolvedValue({text: graphResponse()});
    mockDraftComplete.mockResolvedValue(graphResponse());
    mockConvertToChatMessages.mockReturnValue([]);
    mockCreateMemory.mockResolvedValue({id: 'memory-1'});
    mockCreateMemoryWithEmbedding.mockResolvedValue({id: 'memory-1'});
    mockFindOrCreateNode.mockImplementation(async (input: any) => ({
      id: `node-${input.label}`,
      ...input,
    }));
    mockUpsertEdge.mockResolvedValue({id: 'edge-1'});
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

  it('persists a memory row and a graph node per extracted node, without an embedding model', async () => {
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
      text: graphResponse({
        nodes: [
          {
            label: 'cats',
            content: 'user is researching cats',
            memory_type: 'semantic',
          },
        ],
      }),
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
    expect(mockFindOrCreateNode).toHaveBeenCalledWith(
      expect.objectContaining({
        label: 'cats',
        description: 'user is researching cats',
        sourceMemoryId: 'memory-1',
      }),
    );
  });

  it('uses createMemoryWithEmbedding and passes the embedding model to findOrCreateNode when configured', async () => {
    mockGetSessionById.mockResolvedValue({messages: [makeSessionMessage()]});
    mockConvertToChatMessages.mockReturnValue([
      {role: 'user', content: 'I like dark mode'},
    ]);
    mockCompletion.mockResolvedValue({
      text: graphResponse({
        nodes: [{label: 'dark mode', content: 'likes dark mode'}],
      }),
    });
    mockGetEmbeddingModelPath.mockResolvedValue('/models/bge-small.gguf');

    await maybeRunMemoryExtraction('session-1');

    expect(mockCreateMemoryWithEmbedding).toHaveBeenCalledWith(
      '/models/bge-small.gguf',
      expect.objectContaining({content: 'likes dark mode'}),
    );
    expect(mockCreateMemory).not.toHaveBeenCalled();
    expect(mockFindOrCreateNode).toHaveBeenCalledWith(
      expect.objectContaining({label: 'dark mode'}),
      '/models/bge-small.gguf',
    );
  });

  it('resolves a compartment and creates edges between the ids findOrCreateNode returned', async () => {
    mockGetSessionById.mockResolvedValue({messages: [makeSessionMessage()]});
    mockConvertToChatMessages.mockReturnValue([
      {role: 'user', content: 'I love my cats and prefer dark mode'},
    ]);
    mockCompletion.mockResolvedValue({
      text: graphResponse({
        compartment: 'family',
        nodes: [
          {label: 'cats', content: 'has cats'},
          {label: 'dark mode', content: 'likes dark mode'},
        ],
        edges: [
          {
            source_label: 'cats',
            target_label: 'dark mode',
            relation_type: 'RELATES_TO',
          },
        ],
      }),
    });
    mockGetOrCreateCompartment.mockResolvedValue({id: 'compartment-1'});

    await maybeRunMemoryExtraction('session-1');

    expect(mockGetOrCreateCompartment).toHaveBeenCalledWith('family');
    expect(mockFindOrCreateNode).toHaveBeenCalledWith(
      expect.objectContaining({label: 'cats', compartmentId: 'compartment-1'}),
    );
    expect(mockUpsertEdge).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceNodeId: 'node-cats',
        targetNodeId: 'node-dark mode',
        relation: 'RELATES_TO',
        provenance: 'model_inferred',
        sourceConversationId: 'session-1',
      }),
    );
  });

  it('does not persist anything when extraction finds no nodes', async () => {
    mockGetSessionById.mockResolvedValue({messages: [makeSessionMessage()]});
    mockConvertToChatMessages.mockReturnValue([
      {role: 'user', content: 'hello'},
    ]);
    mockCompletion.mockResolvedValue({text: graphResponse()});

    await maybeRunMemoryExtraction('session-1');

    expect(mockCreateMemory).not.toHaveBeenCalled();
    expect(mockFindOrCreateNode).not.toHaveBeenCalled();
    expect(mockUpsertEdge).not.toHaveBeenCalled();
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

  it('uses the standalone draft model engine when a downloaded draft model is configured', async () => {
    (modelStore as any).activeModel = {id: 'chat-model'};
    (modelStore as any).contextInitParams = {
      selectedDraftModelId: 'draft-model',
    };
    (modelStore as any).models = [
      {id: 'draft-model', isDownloaded: true},
      {id: 'chat-model', isDownloaded: true},
    ];
    mockGetModelFullPath.mockResolvedValue('/models/draft.gguf');
    mockGetSessionById.mockResolvedValue({messages: [makeSessionMessage()]});
    mockConvertToChatMessages.mockReturnValue([
      {role: 'user', content: 'I like dark mode'},
    ]);
    mockDraftComplete.mockResolvedValue(
      graphResponse({
        nodes: [{label: 'dark mode', content: 'likes dark mode'}],
      }),
    );

    await maybeRunMemoryExtraction('session-1');

    expect(mockGetModelFullPath).toHaveBeenCalledWith({
      id: 'draft-model',
      isDownloaded: true,
    });
    expect(mockDraftComplete).toHaveBeenCalledWith(
      '/models/draft.gguf',
      expect.any(String),
      expect.objectContaining({jsonSchema: expect.any(Object)}),
    );
    expect(mockCompletion).not.toHaveBeenCalled();
    expect(mockCreateMemory).toHaveBeenCalledWith(
      expect.objectContaining({content: 'likes dark mode'}),
    );
  });

  it('falls back to the active chat engine when the draft model is not downloaded', async () => {
    (modelStore as any).activeModel = {id: 'chat-model'};
    (modelStore as any).contextInitParams = {
      selectedDraftModelId: 'draft-model',
    };
    (modelStore as any).models = [{id: 'draft-model', isDownloaded: false}];
    mockGetSessionById.mockResolvedValue({messages: [makeSessionMessage()]});
    mockConvertToChatMessages.mockReturnValue([
      {role: 'user', content: 'hello'},
    ]);
    mockCompletion.mockResolvedValue({text: graphResponse()});

    await maybeRunMemoryExtraction('session-1');

    expect(mockDraftComplete).not.toHaveBeenCalled();
    expect(mockCompletion).toHaveBeenCalled();
  });

  it('falls back to the active chat engine when no draft model is paired', async () => {
    (modelStore as any).activeModel = {id: 'chat-model'};
    (modelStore as any).contextInitParams = {};
    mockGetSessionById.mockResolvedValue({messages: [makeSessionMessage()]});
    mockConvertToChatMessages.mockReturnValue([
      {role: 'user', content: 'hello'},
    ]);
    mockCompletion.mockResolvedValue({text: graphResponse()});

    await maybeRunMemoryExtraction('session-1');

    expect(mockDraftComplete).not.toHaveBeenCalled();
    expect(mockCompletion).toHaveBeenCalled();
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
