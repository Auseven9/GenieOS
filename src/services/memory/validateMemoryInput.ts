import type {
  MemoryInput,
  MemoryKind,
  MemoryProvenance,
} from '../../types/memory';

export const VALID_KINDS: MemoryKind[] = [
  'fact',
  'preference',
  'episodic',
  'procedural',
  'relationship',
  'open_thread',
];

export const VALID_PROVENANCE: MemoryProvenance[] = [
  'user_stated',
  'model_inferred',
  'external_content',
];

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export interface ToMemoryInputOptions {
  /**
   * Set when the content this candidate was derived from includes anything
   * read from outside the conversation (web_search/read_url results, etc.).
   * A candidate claiming `user_stated` in that situation gets downgraded to
   * `model_inferred` — it may still be correct, but it can no longer be
   * verified as literally the user's own words, so it must not carry the
   * same trust as something the user typed directly. This is the actual
   * enforcement point for the provenance trust-tier rule; everything else
   * about `Memory.provenance` is just a label until this check exists.
   */
  disallowUserStated?: boolean;
}

/**
 * Turns a raw, untrusted object — model tool-call arguments, or a parsed
 * JSON candidate from the extraction pass — into a well-formed
 * `MemoryInput`. Every field is validated, defaulted, or clamped; nothing
 * here trusts the shape or range of the input, since it always originates
 * from model output. Returns null when there's no usable content.
 */
export function toMemoryInput(
  raw: Record<string, any>,
  options: ToMemoryInputOptions = {},
): MemoryInput | null {
  const content = typeof raw.content === 'string' ? raw.content.trim() : '';
  if (!content) {
    return null;
  }

  const kind: MemoryKind = VALID_KINDS.includes(raw.kind) ? raw.kind : 'fact';

  let provenance: MemoryProvenance = VALID_PROVENANCE.includes(raw.provenance)
    ? raw.provenance
    : 'model_inferred';
  if (options.disallowUserStated && provenance === 'user_stated') {
    provenance = 'model_inferred';
  }

  const tags = Array.isArray(raw.tags)
    ? raw.tags.filter((tag: unknown): tag is string => typeof tag === 'string')
    : [];

  const input: MemoryInput = {kind, content, provenance, tags};
  if (typeof raw.confidence === 'number') {
    input.confidence = clamp(raw.confidence, 0, 1);
  }
  if (typeof raw.valence === 'number') {
    input.valence = clamp(raw.valence, -1, 1);
  }
  if (typeof raw.intensity === 'number') {
    input.intensity = clamp(raw.intensity, 0, 1);
  }
  // A memory the user explicitly asked to be kept defaults to pinned, so
  // routine decay/eviction never quietly drops it.
  input.pinned =
    typeof raw.pinned === 'boolean' ? raw.pinned : provenance === 'user_stated';

  return input;
}
