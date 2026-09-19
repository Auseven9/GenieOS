import {initLlama, LlamaContext, CompletionResponseFormat} from 'llama.rn';

/**
 * Standalone text completion via the small draft model (e.g. the 78M
 * "assistant" GGUF), loaded independently of its speculative-decoding
 * pairing role. Mirrors EmbeddingEngine's lazy-load/release pattern: a
 * plain file path in, a completion string out, decoupled from ModelStore's
 * chat/vision/draft lifecycle so it stays testable in isolation.
 *
 * This is the "three model architecture": the draft model reasons about
 * what to remember on its own, rather than borrowing whichever chat model
 * (uncensored or instruct) happens to be loaded for the visible turn.
 */

// Small enough for a short extraction prompt + a short JSON reply; this
// model is not used for long-form chat so there is no benefit to a larger
// context, only extra KV-cache RAM alongside the resident chat model.
const DRAFT_CONTEXT_SIZE = 2048;

interface CompleteOptions {
  jsonSchema?: object;
  temperature?: number;
  nPredict?: number;
}

class DraftCompletionEngine {
  private context: LlamaContext | undefined;
  private loadedModelPath: string | undefined;
  private loadPromise: Promise<LlamaContext> | undefined;

  private async ensureLoaded(modelPath: string): Promise<LlamaContext> {
    if (this.context && this.loadedModelPath === modelPath) {
      return this.context;
    }

    // A different model path than what's currently loaded: release first
    // rather than leaking a second resident context.
    if (this.context && this.loadedModelPath !== modelPath) {
      await this.unload();
    }

    if (!this.loadPromise) {
      this.loadPromise = initLlama({
        model: modelPath,
        n_ctx: DRAFT_CONTEXT_SIZE,
        n_batch: DRAFT_CONTEXT_SIZE,
        n_ubatch: DRAFT_CONTEXT_SIZE,
      }).then(ctx => {
        this.context = ctx;
        this.loadedModelPath = modelPath;
        return ctx;
      });
    }

    try {
      return await this.loadPromise;
    } finally {
      this.loadPromise = undefined;
    }
  }

  /**
   * Runs a single-turn completion against the draft model, loading it on
   * demand. `jsonSchema`, when given, is forwarded as
   * response_format.json_schema — llama.rn's completion() converts this
   * into the native grammar constraint itself (via its chat-template
   * formatting when messages are used, or a plain json_schema field
   * otherwise), the same mechanism the rest of the app's structured-output
   * call sites rely on.
   */
  async complete(
    modelPath: string,
    prompt: string,
    options: CompleteOptions = {},
  ): Promise<string> {
    const ctx = await this.ensureLoaded(modelPath);
    const responseFormat: CompletionResponseFormat | undefined =
      options.jsonSchema
        ? {
            type: 'json_schema',
            json_schema: {strict: true, schema: options.jsonSchema},
          }
        : undefined;
    const result = await ctx.completion({
      messages: [{role: 'user', content: prompt}],
      response_format: responseFormat,
      temperature: options.temperature ?? 0.2,
      n_predict: options.nPredict ?? 1000,
      enable_thinking: false,
    });
    return result.text;
  }

  /** Frees the draft context's RAM. Safe to call when nothing is loaded. */
  async unload(): Promise<void> {
    if (this.context) {
      await this.context.release();
      this.context = undefined;
      this.loadedModelPath = undefined;
    }
  }

  get isLoaded(): boolean {
    return this.context !== undefined;
  }
}

export default new DraftCompletionEngine();
export {DraftCompletionEngine};
