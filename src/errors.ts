export type ToolErrorCode =
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "MISSING_API_KEY"
  | "INVALID_API_KEY"
  | "NEEDS_SUBSCRIPTION"
  | "TIER_UPGRADE_REQUIRED"
  | "RATE_LIMIT_EXCEEDED"
  | "UPSTREAM_ERROR"
  | "INTERNAL_ERROR";

export class McpError extends Error {
  constructor(
    message: string,
    public code: ToolErrorCode,
    public tool?: string,
    public requestId?: string,
  ) {
    super(message);
    this.name = "McpError";
  }

  toJSON() {
    return {
      error: this.message,
      code: this.code,
      tool: this.tool,
      requestId: this.requestId,
    };
  }
}

/**
 * Standard error for when a consumer tries to call a paid tool without
 * providing an API key. The message is designed to be shown directly to
 * the end user in their LLM client, including the signup URL.
 */
export function subscriptionRequiredError(tool: string): McpError {
  const err = new McpError(
    "This tool requires a StockMarketScan Basic or Pro subscription. " +
      "Sign up at https://stockmarketscan.com (2 minutes), then generate an " +
      "sms_* API key in Settings and configure your MCP client to pass it as " +
      "the X-API-Key header. See https://stockmarketscan.com/mcp for the exact " +
      "config for Claude Desktop, Cursor, Continue and other clients. Tools " +
      "that work without a key: list_screeners, get_stock_info, explain_concept, ping.",
    "NEEDS_SUBSCRIPTION",
    tool,
  );
  return err;
}
