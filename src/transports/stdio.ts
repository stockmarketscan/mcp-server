import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ApiClient } from "../client/apiClient";
import { TtlCache } from "../cache";
import { registerAllTools } from "../tools";
import { normalizeApiKey, envApiKey, API_BASE_URL } from "../auth";

/**
 * Stdio transport for local single-user use (e.g. Claude Desktop).
 *
 * Since stdio has no per-request headers, the API key comes from the
 * STOCKMARKETSCAN_API_KEY environment variable. The same ApiClient instance
 * is shared across all tool calls for this process. The key is OPTIONAL —
 * without it, only the free-tier tools work (list_screeners, get_stock_info,
 * explain_concept, ping) and every other tool responds with a friendly
 * NEEDS_SUBSCRIPTION error pointing at the signup page.
 */
export async function runStdio(): Promise<void> {
  const apiKey = normalizeApiKey(envApiKey());

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
  console.error(
    apiKey
      ? "[mcp] stdio transport ready (authenticated)"
      : "[mcp] stdio transport ready (anonymous — only free tools will work)",
  );
}
