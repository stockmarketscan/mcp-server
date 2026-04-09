import { McpError } from "./errors";

/**
 * In BYOK mode, the MCP server does not hold its own API key.
 * Each consumer (Claude Desktop, Cursor, another MCP client) brings their own
 * StockMarketScan API key via:
 *   - HTTP transport: X-API-Key header on each request
 *   - stdio transport: STOCKMARKETSCAN_API_KEY env var (single-user local mode)
 *
 * API keys are OPTIONAL at the connection level. Consumers that connect
 * without a key can still use the "free tier" tools (list_screeners,
 * get_stock_info, explain_concept, ping). Tools that return paid content
 * will respond with a NEEDS_SUBSCRIPTION error pointing at the signup page.
 * This lets new users discover the platform via their LLM client before
 * committing to a subscription.
 */

export const API_BASE_URL =
  process.env.STOCKMARKETSCAN_API_URL || "https://stockmarketscan.com/api/v1";

/** Fallback for stdio mode — single-user local use. */
export function envApiKey(): string | null {
  return process.env.STOCKMARKETSCAN_API_KEY || null;
}

/**
 * Normalize an incoming API key. Returns the trimmed key if valid, null if
 * absent, or throws if the format is clearly wrong (so the consumer gets a
 * fast 400 instead of a silent 401 downstream).
 */
export function normalizeApiKey(key: string | null | undefined): string | null {
  if (!key) return null;
  const trimmed = key.trim();
  if (!trimmed) return null;
  if (!trimmed.startsWith("sms_") || trimmed.length < 20) {
    throw new McpError(
      "Invalid API key format. Expected a key starting with 'sms_' (at least 20 chars). " +
        "Remove the header to connect anonymously, or generate a valid key at https://stockmarketscan.com/settings.",
      "INVALID_API_KEY",
    );
  }
  return trimmed;
}
