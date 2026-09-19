/**
 * Pulls a JSON object out of a completion that may have wrapped it in
 * prose or a markdown code fence — a model asked for "JSON only" cannot be
 * trusted to actually produce only JSON. Returns undefined on anything
 * that doesn't parse to an object, rather than throwing. Shared by every
 * background memory pass that expects an object-shaped (not array-shaped)
 * response.
 */
export function extractJsonObject(
  raw: string,
): Record<string, any> | undefined {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(match[0]);
    return typeof parsed === 'object' &&
      parsed !== null &&
      !Array.isArray(parsed)
      ? parsed
      : undefined;
  } catch {
    return undefined;
  }
}
