import {initLlama} from 'llama.rn';
import {DraftCompletionEngine} from '../DraftCompletionEngine';
import {modelStore} from '../../../store';

const mockedInitLlama = initLlama as jest.Mock;
const mockedRunExclusive = modelStore.runExclusiveContextOperation as jest.Mock;

function makeMockContext(textToReturn = '[]') {
  return {
    contextId: 1,
    completion: jest.fn(async () => ({text: textToReturn})),
    release: jest.fn(async () => {}),
  };
}

describe('DraftCompletionEngine', () => {
  beforeEach(() => {
    mockedInitLlama.mockReset();
    mockedRunExclusive.mockClear();
  });

  it('routes context load and release through modelStore.runExclusiveContextOperation', async () => {
    const ctx = makeMockContext('hi');
    mockedInitLlama.mockResolvedValue(ctx);

    const engine = new DraftCompletionEngine();
    await engine.complete('/models/draft.gguf', 'hi');
    await engine.unload();

    expect(mockedRunExclusive).toHaveBeenCalledTimes(2);
  });

  it('loads the model without embedding mode and returns completion text', async () => {
    const ctx = makeMockContext('hello from the draft model');
    mockedInitLlama.mockResolvedValue(ctx);

    const engine = new DraftCompletionEngine();
    const text = await engine.complete('/models/draft.gguf', 'say hi');

    expect(mockedInitLlama).toHaveBeenCalledWith(
      expect.objectContaining({model: '/models/draft.gguf'}),
    );
    expect(mockedInitLlama.mock.calls[0][0].embedding).toBeUndefined();
    expect(text).toBe('hello from the draft model');
  });

  it('forwards a json schema as response_format.json_schema', async () => {
    const ctx = makeMockContext('[]');
    mockedInitLlama.mockResolvedValue(ctx);

    const engine = new DraftCompletionEngine();
    const schema = {type: 'array'};
    await engine.complete('/models/draft.gguf', 'extract', {
      jsonSchema: schema,
    });

    expect(ctx.completion).toHaveBeenCalledWith(
      expect.objectContaining({
        response_format: {
          type: 'json_schema',
          json_schema: {strict: true, schema},
        },
      }),
    );
  });

  it('omits response_format when no schema is given', async () => {
    const ctx = makeMockContext('[]');
    mockedInitLlama.mockResolvedValue(ctx);

    const engine = new DraftCompletionEngine();
    await engine.complete('/models/draft.gguf', 'extract');

    expect(ctx.completion).toHaveBeenCalledWith(
      expect.objectContaining({response_format: undefined}),
    );
  });

  it('reuses the loaded context for repeated calls to the same model path', async () => {
    const ctx = makeMockContext('[]');
    mockedInitLlama.mockResolvedValue(ctx);

    const engine = new DraftCompletionEngine();
    await engine.complete('/models/draft.gguf', 'a');
    await engine.complete('/models/draft.gguf', 'b');

    expect(mockedInitLlama).toHaveBeenCalledTimes(1);
    expect(ctx.completion).toHaveBeenCalledTimes(2);
  });

  it('releases and reloads when a different model path is requested', async () => {
    const ctxA = makeMockContext('a');
    const ctxB = makeMockContext('b');
    mockedInitLlama.mockResolvedValueOnce(ctxA).mockResolvedValueOnce(ctxB);

    const engine = new DraftCompletionEngine();
    await engine.complete('/models/model-a.gguf', 'a');
    await engine.complete('/models/model-b.gguf', 'b');

    expect(ctxA.release).toHaveBeenCalledTimes(1);
    expect(mockedInitLlama).toHaveBeenCalledTimes(2);
  });

  it('unload releases the context and clears loaded state', async () => {
    const ctx = makeMockContext('a');
    mockedInitLlama.mockResolvedValue(ctx);

    const engine = new DraftCompletionEngine();
    await engine.complete('/models/draft.gguf', 'a');
    expect(engine.isLoaded).toBe(true);

    await engine.unload();
    expect(ctx.release).toHaveBeenCalledTimes(1);
    expect(engine.isLoaded).toBe(false);
  });

  it('unload is a no-op when nothing is loaded', async () => {
    const engine = new DraftCompletionEngine();
    await expect(engine.unload()).resolves.toBeUndefined();
  });
});
