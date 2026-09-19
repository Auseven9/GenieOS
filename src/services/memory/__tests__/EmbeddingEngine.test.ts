import {initLlama} from 'llama.rn';
import {EmbeddingEngine} from '../EmbeddingEngine';

const mockedInitLlama = initLlama as jest.Mock;

function makeMockContext(vectorByText: Record<string, number[]> = {}) {
  return {
    contextId: 1,
    embedding: jest.fn(async (text: string) => ({
      embedding: vectorByText[text] || [0, 0, 0],
    })),
    release: jest.fn(async () => {}),
  };
}

describe('EmbeddingEngine', () => {
  beforeEach(() => {
    mockedInitLlama.mockReset();
  });

  it('loads the model with embedding mode enabled and returns a Float32Array', async () => {
    const ctx = makeMockContext({hello: [0.1, 0.2, 0.3]});
    mockedInitLlama.mockResolvedValue(ctx);

    const engine = new EmbeddingEngine();
    const vector = await engine.embed('/models/bge-small.gguf', 'hello');

    expect(mockedInitLlama).toHaveBeenCalledWith(
      expect.objectContaining({
        model: '/models/bge-small.gguf',
        embedding: true,
      }),
    );
    expect(vector).toBeInstanceOf(Float32Array);
    expect(Array.from(vector)).toEqual([
      Math.fround(0.1),
      Math.fround(0.2),
      Math.fround(0.3),
    ]);
  });

  it('reuses the loaded context for repeated calls to the same model path', async () => {
    const ctx = makeMockContext({a: [1, 0], b: [0, 1]});
    mockedInitLlama.mockResolvedValue(ctx);

    const engine = new EmbeddingEngine();
    await engine.embed('/models/bge-small.gguf', 'a');
    await engine.embed('/models/bge-small.gguf', 'b');

    expect(mockedInitLlama).toHaveBeenCalledTimes(1);
    expect(ctx.embedding).toHaveBeenCalledTimes(2);
  });

  it('embedMany reuses one context across a batch', async () => {
    const ctx = makeMockContext({x: [1, 1], y: [2, 2]});
    mockedInitLlama.mockResolvedValue(ctx);

    const engine = new EmbeddingEngine();
    const vectors = await engine.embedMany('/models/bge-small.gguf', [
      'x',
      'y',
    ]);

    expect(mockedInitLlama).toHaveBeenCalledTimes(1);
    expect(vectors).toHaveLength(2);
    expect(Array.from(vectors[0])).toEqual([1, 1]);
    expect(Array.from(vectors[1])).toEqual([2, 2]);
  });

  it('releases and reloads when a different model path is requested', async () => {
    const ctxA = makeMockContext({a: [1, 0]});
    const ctxB = makeMockContext({b: [0, 1]});
    mockedInitLlama.mockResolvedValueOnce(ctxA).mockResolvedValueOnce(ctxB);

    const engine = new EmbeddingEngine();
    await engine.embed('/models/model-a.gguf', 'a');
    await engine.embed('/models/model-b.gguf', 'b');

    expect(ctxA.release).toHaveBeenCalledTimes(1);
    expect(mockedInitLlama).toHaveBeenCalledTimes(2);
  });

  it('unload releases the context and clears loaded state', async () => {
    const ctx = makeMockContext({a: [1]});
    mockedInitLlama.mockResolvedValue(ctx);

    const engine = new EmbeddingEngine();
    await engine.embed('/models/bge-small.gguf', 'a');
    expect(engine.isLoaded).toBe(true);

    await engine.unload();
    expect(ctx.release).toHaveBeenCalledTimes(1);
    expect(engine.isLoaded).toBe(false);
  });

  it('unload is a no-op when nothing is loaded', async () => {
    const engine = new EmbeddingEngine();
    await expect(engine.unload()).resolves.toBeUndefined();
  });
});
