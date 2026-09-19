import type {GraphNodeCandidate} from './validateMemoryGraphInput';

/**
 * The write-path gatekeeper: a deterministic screen every extracted node
 * passes through before it can reach the database, independent of
 * whatever the extraction model itself claims about its own output. An
 * LLM writing to its own long-term memory is an attack surface — a
 * hallucinated "fact", or a prompt-injection payload hidden in a web page
 * the model was asked to read, can otherwise poison the graph permanently.
 *
 * This is a heuristic first line of defense, not a guarantee: pattern
 * matching can miss a cleverly worded injection, and a sufficiently
 * subtle hallucination has no textual signature to catch at all. It
 * catches the cheap, common cases (obvious secrets, blunt "ignore your
 * instructions" payloads, low-confidence guesses) so they don't
 * automatically become permanent — it does not replace judgment.
 */

// Below this, a node is created but held out of the active graph
// (dedup, digest retrieval, spreading activation all skip it) rather than
// dropped outright, so a real fact at borderline confidence isn't lost —
// it's just not trusted by default.
export const CONFIDENCE_QUARANTINE_THRESHOLD = 0.4;

// Deliberately over-inclusive: a false positive here just means a
// legitimate node gets redacted/rejected and (at worst) has to be
// re-derived next turn, which is a far cheaper mistake than a leaked
// credential or a successful memory-poisoning injection.
const SECRET_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9]{16,}/g, // OpenAI-style API keys
  /AKIA[0-9A-Z]{16}/g, // AWS access key ids
  /ghp_[A-Za-z0-9]{20,}/g, // GitHub personal access tokens
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, // JWTs
  /\b(?:api[_-]?key|secret|password|passwd|access[_-]?token)\s*[:=]\s*\S+/gi,
];

const INJECTION_PATTERNS: RegExp[] = [
  /ignore (?:all|any|the)?\s*(?:previous|prior|above)\s*(?:instructions|prompts|rules)/i,
  /disregard (?:all|any|the)?\s*(?:previous|prior|above)\s*(?:instructions|prompts|rules)/i,
  /forget (?:everything|all)(?:\s*you\s*(?:know|were told))?/i,
  /you (?:must|should|will) now (?:act as|become|pretend to be)/i,
  /new (?:system )?instructions?\s*[:=]/i,
  /system prompt\s*[:=]/i,
  /\bremember that\b.{0,40}\b(?:always|never|secretly|from now on)\b/i,
];

function redactSecrets(text: string): {text: string; redacted: boolean} {
  let redacted = false;
  let result = text;
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(result)) {
      redacted = true;
    }
    // `test()` above may have advanced a global regex's lastIndex; reset
    // before using the same pattern for replace so it matches from the start.
    pattern.lastIndex = 0;
    result = result.replace(pattern, '[REDACTED]');
  }
  return {text: result, redacted};
}

function containsInjectionPattern(text: string): boolean {
  return INJECTION_PATTERNS.some(pattern => pattern.test(text));
}

export interface ScreenedNode {
  node: GraphNodeCandidate;
  /** True if this node was quarantined for low confidence — the caller
   * should persist it but keep it out of the active graph/digest. */
  quarantined: boolean;
  /** True if a secret/credential pattern was found and stripped. */
  redacted: boolean;
}

/**
 * Screens a single extracted node candidate. Returns null when the node
 * must never be written at all (a detected injection payload) — the
 * caller should drop it and log, not fall back to writing anything
 * derived from it. Otherwise returns the node (with any secrets redacted
 * from its label/content) plus whether it should land quarantined.
 */
export function screenNode(node: GraphNodeCandidate): ScreenedNode | null {
  if (
    containsInjectionPattern(node.label) ||
    containsInjectionPattern(node.content)
  ) {
    return null;
  }

  const label = redactSecrets(node.label);
  const content = redactSecrets(node.content);

  return {
    node:
      label.redacted || content.redacted
        ? {...node, label: label.text, content: content.text}
        : node,
    quarantined: node.confidence < CONFIDENCE_QUARANTINE_THRESHOLD,
    redacted: label.redacted || content.redacted,
  };
}
