import {initLlama, LlamaContext} from 'llama.rn';

/**
 * Turns text into a fixed-size vector for memory retrieval, using a small
 * dedicated embedding GGUF model (e.g. bge-small-en-v1.5) loaded via
 * llama.rn's own embedding mode — not the chat/draft/vision models.
 *
 * Deliberately decoupled from ModelStore: this engine only needs a file
 * path, not a registered Model entry, so it stays testable in isolation
 * and doesn't touch ModelStore's per-chat-model projection/draft wiring.
 * Resolving "which downloaded file is the embedding model" is a settings
 * concern that hands this a path, not the other way around.
 *
 * The context is loaded lazily and released after use rather than kept
 * resident for the session — see the RAM-budget discussion this was
 * designed against: there is no spare headroom to keep a fourth model
 * loaded alongside the main/draft/vision stack.
 */

// bge-small-en-v1.5 was trained on 512-token inputs; there is no benefit
// to a larger context for this model and it only costs KV-cache RAM.
const EMBEDDING_CONTEXT_SIZE = 512;

// L2-normalize embeddings at the source (llama.cpp's embd_normalize=2) so
// stored vectors are directly comparable by dot product as well as cosine,
// and match bge's documented retrieval usage.
const L2_NORMALIZE = 2;

class EmbeddingEngine {
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
        embedding: true,
        embd_normalize: L2_NORMALIZE,
        n_ctx: EMBEDDING_CONTEXT_SIZE,
        n_batch: EMBEDDING_CONTEXT_SIZE,
        n_ubatch: EMBEDDING_CONTEXT_SIZE,
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

  /** Embeds a single piece of text, loading the model on demand. */
  async embed(modelPath: string, text: string): Promise<Float32Array> {
    const ctx = await this.ensureLoaded(modelPath);
    const result = await ctx.embedding(text);
    return new Float32Array(result.embedding);
  }

  /**
   * Embeds several texts against one loaded context rather than reloading
   * the model per call — the shape the extraction pipeline actually needs
   * when it turns a batch of candidate memories into vectors at once.
   */
  async embedMany(modelPath: string, texts: string[]): Promise<Float32Array[]> {
    const ctx = await this.ensureLoaded(modelPath);
    const results: Float32Array[] = [];
    for (const text of texts) {
      const result = await ctx.embedding(text);
      results.push(new Float32Array(result.embedding));
    }
    return results;
  }

  /** Frees the embedding context's RAM. Safe to call when nothing is loaded. */
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

export default new EmbeddingEngine();
export {EmbeddingEngine};
