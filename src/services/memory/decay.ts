/**
 * Ebbinghaus-style temporal decay: a memory's influence on retrieval fades
 * exponentially the longer it goes without being reinforced (recalled), and
 * resets back to full strength the moment it is. This is what keeps a
 * memory that hasn't come up in weeks from continuing to compete equally
 * with one just reinforced this conversation — it fades into the
 * background rather than permanently polluting the context window,
 * without ever being destroyed (nothing here deletes or retires anything;
 * see MemoryRepository.recordAccess / MemoryGraphRepository.recordNodeAccess
 * for the "re-consolidation spike" this decay curve is measured against).
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// A memory at baseline salience (0.5) loses half its retrieval strength
// after two weeks of not being recalled. Salience scales this: a highly
// salient memory (1.0) gets a ~28-day half-life, a low-salience one (0.0)
// gets ~7 days.
export const DEFAULT_HALF_LIFE_DAYS = 14;

export interface DecayInput {
  /** A pinned memory never decays — the user explicitly asked it to persist. */
  pinned?: boolean;
  createdAt: string;
  lastAccessedAt?: string;
  /** 0-1, higher = more central = slower decay. Absent = baseline (0.5). */
  salience?: number;
}

/**
 * Returns a 0-1 retention multiplier: 1 for a pinned memory or one just
 * created/recalled, decaying toward 0 the longer it's gone unreinforced.
 * Intended to scale a relevance score (e.g. cosine similarity) at
 * retrieval time — this never mutates or removes anything itself.
 */
export function computeRetention(
  input: DecayInput,
  now: Date = new Date(),
): number {
  if (input.pinned) {
    return 1;
  }

  const lastReinforced = input.lastAccessedAt
    ? new Date(input.lastAccessedAt)
    : new Date(input.createdAt);
  const daysSince = Math.max(
    0,
    (now.getTime() - lastReinforced.getTime()) / MS_PER_DAY,
  );

  const salience = input.salience ?? 0.5;
  const halfLifeDays = DEFAULT_HALF_LIFE_DAYS * (0.5 + salience);

  return Math.pow(0.5, daysSince / halfLifeDays);
}
