const mockCompletion = jest.fn();
const mockGetModelFullPath = jest.fn();
const mockDraftComplete = jest.fn();

jest.mock('../../../store', () => ({
  modelStore: {
    engine: {completion: (...args: any[]) => mockCompletion(...args)},
    activeModel: undefined,
    contextInitParams: {},
    models: [],
    getModelFullPath: (...args: any[]) => mockGetModelFullPath(...args),
  },
}));

jest.mock('../DraftCompletionEngine', () => ({
  __esModule: true,
  default: {complete: (...args: any[]) => mockDraftComplete(...args)},
}));

import {createExtractionCompletionFn} from '../extractionModel';
import {modelStore} from '../../../store';

const SCHEMA = {type: 'object', properties: {}};

describe('createExtractionCompletionFn', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (modelStore as any).activeModel = undefined;
    (modelStore as any).contextInitParams = {};
    (modelStore as any).models = [];
  });

  it('falls back to the active chat engine when no draft model is configured', async () => {
    (modelStore as any).activeModel = {id: 'chat-model'};
    mockCompletion.mockResolvedValue({text: 'hello'});

    const {complete, extractedBy} = await createExtractionCompletionFn(SCHEMA);
    const text = await complete('a prompt');

    expect(mockDraftComplete).not.toHaveBeenCalled();
    expect(text).toBe('hello');
    expect(extractedBy).toBe('chat-model');
    expect(mockCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        response_format: {
          type: 'json_schema',
          json_schema: {strict: true, schema: SCHEMA},
        },
      }),
    );
  });

  it('uses "unknown-active-model" when the active chat model has no id', async () => {
    mockCompletion.mockResolvedValue({text: 'hello'});
    const {extractedBy} = await createExtractionCompletionFn(SCHEMA);
    expect(extractedBy).toBe('unknown-active-model');
  });

  it('throws when there is no active model engine and no draft model', async () => {
    (modelStore as any).engine = undefined;
    await expect(createExtractionCompletionFn(SCHEMA)).rejects.toThrow(
      'extractionModel: no active model engine',
    );
    (modelStore as any).engine = {
      completion: (...args: any[]) => mockCompletion(...args),
    };
  });

  it('prefers the draft model when configured and downloaded', async () => {
    (modelStore as any).activeModel = {id: 'chat-model'};
    (modelStore as any).contextInitParams = {
      selectedDraftModelId: 'draft-model',
    };
    (modelStore as any).models = [{id: 'draft-model', isDownloaded: true}];
    mockGetModelFullPath.mockResolvedValue('/models/draft.gguf');
    mockDraftComplete.mockResolvedValue('draft says hi');

    const {complete, extractedBy} = await createExtractionCompletionFn(SCHEMA, {
      nPredict: 500,
    });
    const text = await complete('a prompt');

    expect(mockCompletion).not.toHaveBeenCalled();
    expect(text).toBe('draft says hi');
    expect(extractedBy).toBe('draft-model');
    expect(mockDraftComplete).toHaveBeenCalledWith(
      '/models/draft.gguf',
      'a prompt',
      expect.objectContaining({jsonSchema: SCHEMA, nPredict: 500}),
    );
  });

  it('falls back when the draft model is not downloaded', async () => {
    (modelStore as any).activeModel = {id: 'chat-model'};
    (modelStore as any).contextInitParams = {
      selectedDraftModelId: 'draft-model',
    };
    (modelStore as any).models = [{id: 'draft-model', isDownloaded: false}];
    mockCompletion.mockResolvedValue({text: 'hello'});

    const {extractedBy} = await createExtractionCompletionFn(SCHEMA);

    expect(mockDraftComplete).not.toHaveBeenCalled();
    expect(extractedBy).toBe('chat-model');
  });

  it('falls back when getModelFullPath throws for the draft model', async () => {
    (modelStore as any).activeModel = {id: 'chat-model'};
    (modelStore as any).contextInitParams = {
      selectedDraftModelId: 'draft-model',
    };
    (modelStore as any).models = [{id: 'draft-model', isDownloaded: true}];
    mockGetModelFullPath.mockRejectedValue(new Error('missing file'));
    mockCompletion.mockResolvedValue({text: 'hello'});

    const {extractedBy} = await createExtractionCompletionFn(SCHEMA);

    expect(mockDraftComplete).not.toHaveBeenCalled();
    expect(extractedBy).toBe('chat-model');
  });
});
