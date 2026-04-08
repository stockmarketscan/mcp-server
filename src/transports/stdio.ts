import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ApiClient } from "../client/apiClient";
import { TtlCache } from "../cache";
import { registerAllTools } from "../tools";
import { assertValidApiKey, envApiKey, API_BASE_URL } from "../auth";

/**
 * Stdio transport for local single-user use (e.g. Claude Desktop).
 *
 * Since stdio has no per-request headers, the API key comes from the
 * STOCKMARKETSCAN_API_KEY environment variable. The same ApiClient instance
 * is shared across all tool calls for this process.
 */
export async function runStdio(): Promise<void> {
  const apiKey = assertValidApiKey(envApiKey());

  const server = new Server(
    { name: "stockmarketscan", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  const ctx = {
    apiClient: new ApiClient({ apiKey, baseUrl: API_BASE_URL }),
    cache: new TtlCache(process.env.MCP_CACHE_ENABLED !== "false"),
  };

  registerAllTools(server, ctx);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[mcp] stdio transport ready");
}
