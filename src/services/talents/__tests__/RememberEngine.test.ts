const mockCreateMemory = jest.fn();
const mockCreateMemoryWithEmbedding = jest.fn();

jest.mock('../../../repositories/MemoryRepository', () => ({
  __esModule: true,
  default: {
    createMemory: (...args: any[]) => mockCreateMemory(...args),
    createMemoryWithEmbedding: (...args: any[]) =>
      mockCreateMemoryWithEmbedding(...args),
  },
}));

import {RememberEngine} from '../RememberEngine';

describe('RememberEngine', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateMemory.mockResolvedValue({id: 'mem-1'});
    mockCreateMemoryWithEmbedding.mockResolvedValue({id: 'mem-1'});
  });

  it('exposes name "remember"', () => {
    expect(new RememberEngine().name).toBe('remember');
  });

  it('rejects an empty content argument', async () => {
    const result = await new RememberEngine().execute({content: '   '});
    expect(result.type).toBe('error');
    expect(mockCreateMemory).not.toHaveBeenCalled();
  });

  it('stores via createMemory (no embedding) when no model path is configured', async () => {
    const engine = new RememberEngine();
    const result = await engine.execute({
      content: 'User prefers dark mode',
    });

    expect(result.type).toBe('text');
    expect(mockCreateMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'fact',
        content: 'User prefers dark mode',
        provenance: 'model_inferred',
        tags: [],
        pinned: false,
      }),
    );
    expect(mockCreateMemoryWithEmbedding).not.toHaveBeenCalled();
  });

  it('stores via createMemoryWithEmbedding when a model path is configured', async () => {
    const engine = new RememberEngine('/models/bge-small.gguf');
    await engine.execute({content: 'User prefers dark mode'});

    expect(mockCreateMemoryWithEmbedding).toHaveBeenCalledWith(
      '/models/bge-small.gguf',
      expect.objectContaining({content: 'User prefers dark mode'}),
    );
    expect(mockCreateMemory).not.toHaveBeenCalled();
  });

  it('defaults pinned to true when provenance is user_stated', async () => {
    const engine = new RememberEngine();
    await engine.execute({
      content: 'Remind me every Friday',
      provenance: 'user_stated',
    });

    expect(mockCreateMemory).toHaveBeenCalledWith(
      expect.objectContaining({provenance: 'user_stated', pinned: true}),
    );
  });

  it('falls back to "fact"/"model_inferred" for an invalid kind/provenance', async () => {
    const engine = new RememberEngine();
    await engine.execute({
      content: 'x',
      kind: 'not-a-real-kind',
      provenance: 'external_content_but_typo',
    });

    expect(mockCreateMemory).toHaveBeenCalledWith(
      expect.objectContaining({kind: 'fact', provenance: 'model_inferred'}),
    );
  });

  it('clamps confidence/valence/intensity into their valid ranges', async () => {
    const engine = new RememberEngine();
    await engine.execute({
      content: 'x',
      confidence: 5,
      valence: -10,
      intensity: 2,
    });

    expect(mockCreateMemory).toHaveBeenCalledWith(
      expect.objectContaining({confidence: 1, valence: -1, intensity: 1}),
    );
  });

  it('filters out non-string entries from tags', async () => {
    const engine = new RememberEngine();
    await engine.execute({content: 'x', tags: ['ok', 5, null, 'also-ok']});

    expect(mockCreateMemory).toHaveBeenCalledWith(
      expect.objectContaining({tags: ['ok', 'also-ok']}),
    );
  });

  it('returns an error result when the repository throws', async () => {
    mockCreateMemory.mockRejectedValue(new Error('db exploded'));
    const result = await new RememberEngine().execute({content: 'x'});

    expect(result.type).toBe('error');
    if (result.type === 'error') {
      expect(result.errorMessage).toBe('db exploded');
    }
  });

  it('toToolDefinition returns a valid function schema requiring content', () => {
    const def = new RememberEngine().toToolDefinition();
    expect(def.type).toBe('function');
    expect(def.function.name).toBe('remember');
    expect(def.function.parameters.required).toEqual(['content']);
  });
});
