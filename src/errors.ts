export type ToolErrorCode =
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "MISSING_API_KEY"
  | "INVALID_API_KEY"
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
