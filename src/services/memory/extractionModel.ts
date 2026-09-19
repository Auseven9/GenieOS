import {modelStore} from '../../store';
import {resolveDraftModelId} from '../../store/draftResolution';
import draftCompletionEngine from './DraftCompletionEngine';

export interface ExtractionCompletionFn {
  complete: (prompt: string) => Promise<string>;
  /** Model signature that will actually run the completion — the audit
   * trail for extracted_by on whatever this produces. */
  extractedBy: string;
}

/**
 * Resolves the configured draft model — the small model paired for
 * speculative decoding with the active chat model — for use as an
 * independent completion engine. Reuses resolveDraftModelId() (plain ID
 * lookup) rather than resolveDraftCandidate(), since the latter's
 * MTP-capability/embedding-width checks only guard speculative-decoding
 * pairing validity and don't apply to running the draft model standalone.
 *
 * Returns undefined (never throws) whenever no draft model is configured
 * or downloaded, so callers can fall back to the active chat model instead.
 */
async function resolveDraftModel(): Promise<
  {path: string; modelId: string} | undefined
> {
  const activeModel = modelStore.activeModel;
  if (!activeModel) {
    return undefined;
  }
  const draftId = resolveDraftModelId(
    activeModel,
    modelStore.contextInitParams.selectedDraftModelId,
  );
  if (!draftId) {
    return undefined;
  }
  const draftModel = modelStore.models.find(m => m.id === draftId);
  if (!draftModel || !draftModel.isDownloaded) {
    return undefined;
  }
  try {
    const path = await modelStore.getModelFullPath(draftModel);
    return {path, modelId: draftModel.id};
  } catch {
    return undefined;
  }
}

/**
 * Builds a plain text-in/text-out completion function constrained to the
 * given JSON schema, plus a signature identifying which model actually
 * ran it. Shared by every background memory pass (turn extraction,
 * episodic-to-semantic consolidation, and future ones) so they all resolve
 * "which model does the reasoning" identically.
 *
 * Schema-constrained via response_format.json_schema — llama.rn's own
 * completion() converts this into the native grammar/json_schema
 * constraint for local llama.cpp contexts, and the OpenAI-compatible
 * remote engine forwards it verbatim, so this one shape works for either
 * backend. Callers still defend against malformed output regardless.
 *
 * Three-model architecture: prefers the small draft model, loaded as its
 * own independent context so it reasons about what to remember without
 * borrowing whichever chat model is currently active. Falls back to the
 * active chat model's engine only when no draft model is configured/
 * downloaded, so background passes still work before that pairing is set
 * up. Throws only when neither is available — the caller decides whether
 * that should abort or be swallowed.
 */
export async function createExtractionCompletionFn(
  schema: object,
  options: {temperature?: number; nPredict?: number} = {},
): Promise<ExtractionCompletionFn> {
  const temperature = options.temperature ?? 0.2;
  const nPredict = options.nPredict ?? 1500;

  const draftModel = await resolveDraftModel();
  if (draftModel) {
    return {
      complete: prompt =>
        draftCompletionEngine.complete(draftModel.path, prompt, {
          jsonSchema: schema,
          temperature,
          nPredict,
        }),
      extractedBy: draftModel.modelId,
    };
  }

  const engine = modelStore.engine;
  if (!engine) {
    throw new Error('extractionModel: no active model engine');
  }
  return {
    complete: async prompt => {
      const result = await engine.completion({
        messages: [{role: 'user', content: prompt}],
        response_format: {
          type: 'json_schema',
          json_schema: {strict: true, schema},
        },
        temperature,
        n_predict: nPredict,
        enable_thinking: false,
      });
      return result.text;
    },
    extractedBy: modelStore.activeModel?.id ?? 'unknown-active-model',
  };
}
