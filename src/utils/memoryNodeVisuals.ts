/**
 * Pure visual-encoding helpers for the Memory Explorer graph: what color,
 * size, and opacity a node should render at, derived from its psychological
 * metadata (valence/salience/confidence — see types/memoryGraph.ts).
 * Deliberately has no React/SVG dependency so the mapping itself is
 * trivially testable.
 */

const NEUTRAL_RGB = {r: 158, g: 158, b: 158}; // Material gray 500
const NEGATIVE_RGB = {r: 211, g: 47, b: 47}; // Material red 700
const POSITIVE_RGB = {r: 56, g: 142, b: 60}; // Material green 700

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function toHexByte(n: number): string {
  return Math.round(Math.max(0, Math.min(255, n)))
    .toString(16)
    .padStart(2, '0');
}

/**
 * Diverging color scale for valence: -1 (distressing) → red, 0 (neutral,
 * or never scored) → gray, 1 (joyful) → green. A node whose valence was
 * never scored renders identically to an explicitly neutral one — the
 * graph has no way to visually distinguish "unknown" from "neutral"
 * anyway, so it doesn't pretend to.
 */
export function valenceToColor(valence: number | undefined): string {
  const v = Math.max(-1, Math.min(1, valence ?? 0));
  const target = v < 0 ? NEGATIVE_RGB : POSITIVE_RGB;
  const t = Math.abs(v);
  const r = lerp(NEUTRAL_RGB.r, target.r, t);
  const g = lerp(NEUTRAL_RGB.g, target.g, t);
  const b = lerp(NEUTRAL_RGB.b, target.b, t);
  return `#${toHexByte(r)}${toHexByte(g)}${toHexByte(b)}`;
}

const MIN_RADIUS = 10;
const MAX_RADIUS = 26;
// A never-scored node renders at a middling size — neither the smallest
// nor the largest thing on screen, so its absence of data doesn't read as
// a (false) signal of low importance.
const DEFAULT_SALIENCE = 0.4;

/** Node circle radius from salience (0-1). */
export function salienceToRadius(salience: number | undefined): number {
  const s = Math.max(0, Math.min(1, salience ?? DEFAULT_SALIENCE));
  return MIN_RADIUS + (MAX_RADIUS - MIN_RADIUS) * s;
}

// A floor, not zero: even a near-zero-confidence node must stay visible
// and tappable, just visibly faded — confidence communicates "how sure,"
// not "whether it exists."
const MIN_OPACITY = 0.35;

/** Node fill opacity from confidence (0-1) — encodes uncertainty as visual
 * fade rather than a separate widget. */
export function confidenceToOpacity(confidence: number): number {
  const c = Math.max(0, Math.min(1, confidence));
  return MIN_OPACITY + (1 - MIN_OPACITY) * c;
}

// Applied on top of confidenceToOpacity's result when a search is active
// and this node doesn't match — dims it without fully hiding it, so the
// graph's shape stays legible while attention is drawn to the match(es).
export const SEARCH_DIM_MULTIPLIER = 0.15;
