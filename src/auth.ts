import { McpError } from "./errors";

/**
 * In BYOK mode, the MCP server does not hold its own API key.
 * Each consumer (Claude Desktop, Cursor, another MCP client) brings their own
 * StockMarketScan API key via:
 *   - HTTP transport: X-API-Key header on each request
 *   - stdio transport: STOCKMARKETSCAN_API_KEY env var (single-user local mode)
 *
 * The MCP server just extracts the key, validates the format, and passes it
 * through to /api/v1/* on behalf of the consumer.
 */

export const API_BASE_URL =
  process.env.STOCKMARKETSCAN_API_URL || "https://stockmarketscan.com/api/v1";

/** Fallback for stdio mode — single-user local use. */
export function envApiKey(): string | null {
  return process.env.STOCKMARKETSCAN_API_KEY || null;
}

export function assertValidApiKey(key: string | null | undefined): string {
  if (!key) {
    throw new McpError(
      "Missing StockMarketScan API key. Generate one at " +
        "https://stockmarketscan.com/settings and pass it either as the " +
        "X-API-Key header (HTTP mode) or as the STOCKMARKETSCAN_API_KEY " +
        "env var (stdio mode).",
      "MISSING_API_KEY"
    );
  }
  if (!key.startsWith("sms_") || key.length < 20) {
    throw new McpError(
      "Invalid API key format. Expected a key starting with 'sms_'.",
      "INVALID_API_KEY"
    );
  }
  return key;
}
