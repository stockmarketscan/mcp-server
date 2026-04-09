/**
 * Response size enforcement for MCP tool results.
 *
 * Anthropic's Claude.ai MCP Directory submission guide requires tools to
 * return at most 25,000 tokens per result. We don't have a tokenizer in
 * the server runtime, so we apply a conservative character-based proxy:
 * ~4 characters per token → 25k tokens ≈ 100k characters.
 *
 * Strategy when a response would exceed the limit:
 *   1. If the result is a plain object with an array field (data / rows /
 *      contracts / signals / setups / ...), we truncate the array and
 *      annotate the response with a _truncated hint telling the client
 *      how many rows were dropped and how to request a smaller page.
 *   2. Otherwise we return a structured RESULT_TOO_LARGE error pointing
 *      the model at the relevant filter/pagination parameter.
 *
 * The returned text is always valid JSON so clients can still parse it.
 */

const MAX_CHARS = 100_000;

interface TruncationResult {
  text: string;
  truncated: boolean;
}

const ARRAY_FIELDS = [
  "data",
  "rows",
  "contracts",
  "signals",
  "setups",
  "matches",
  "patterns",
  "trends",
  "connections",
  "symbols",
  "screeners",
] as const;

function pickArrayField(obj: Record<string, unknown>): string | null {
  for (const key of ARRAY_FIELDS) {
    const value = obj[key];
    if (Array.isArray(value) && value.length > 0) return key;
  }
  // Fallback: find the longest array in the object
  let best: { key: string; length: number } | null = null;
  for (const [key, value] of Object.entries(obj)) {
    if (Array.isArray(value) && (!best || value.length > best.length)) {
      best = { key, length: value.length };
    }
  }
  return best?.key ?? null;
}

export function stringifyWithLimit(
  toolName: string,
  result: unknown,
): TruncationResult {
  const full = JSON.stringify(result, null, 2);
  if (full.length <= MAX_CHARS) {
    return { text: full, truncated: false };
  }

  // Try to truncate the main array field
  if (result && typeof result === "object" && !Array.isArray(result)) {
    const obj = result as Record<string, unknown>;
    const arrayField = pickArrayField(obj);
    if (arrayField && Array.isArray(obj[arrayField])) {
      const originalLength = (obj[arrayField] as unknown[]).length;

      // Binary search for the largest truncation length that fits.
      let low = 1;
      let high = originalLength;
      let fitted = 0;
      let fittedText = "";

      while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        const truncated = {
          ...obj,
          [arrayField]: (obj[arrayField] as unknown[]).slice(0, mid),
          _truncated: {
            reason:
              "Response exceeds the 25,000 token limit. Only the first " +
              `${mid} of ${originalLength} ${arrayField} are included.`,
            original_count: originalLength,
            returned_count: mid,
            hint:
              "Use pagination or filter arguments (page, limit, date range, " +
              "symbol, side, etc) to request a smaller slice.",
          },
        };
        const text = JSON.stringify(truncated, null, 2);
        if (text.length <= MAX_CHARS) {
          fitted = mid;
          fittedText = text;
          low = mid + 1;
        } else {
          high = mid - 1;
        }
      }

      if (fitted > 0) {
        return { text: fittedText, truncated: true };
      }
    }
  }

  // Fallback: structured error response
  const err = {
    error:
      "Response would exceed the 25,000 token limit per tool result. " +
      "Please narrow the query with a stricter filter, smaller limit, or " +
      "pagination.",
    code: "RESULT_TOO_LARGE",
    tool: toolName,
    approx_size_chars: full.length,
    max_size_chars: MAX_CHARS,
  };
  return { text: JSON.stringify(err, null, 2), truncated: true };
}
