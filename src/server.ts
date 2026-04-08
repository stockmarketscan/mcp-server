#!/usr/bin/env node
/**
 * StockMarketScan MCP Server entry point.
 *
 * Transport is selected via the MCP_TRANSPORT env var:
 *   - stdio (default): local single-user mode, used by Claude Desktop etc.
 *   - http: hosted multi-user mode, used for Railway deployment
 *
 * See MCP/implementation-and-launch-plan.md for the full design.
 */

import { runStdio } from "./transports/stdio";
import { runHttp } from "./transports/http";

async function main(): Promise<void> {
  const transport = (process.env.MCP_TRANSPORT || "stdio").toLowerCase();

  if (transport === "http") {
    // Railway sets PORT; local dev uses MCP_PORT.
    const port = parseInt(process.env.PORT || process.env.MCP_PORT || "3333", 10);
    await runHttp(port);
    return;
  }

  if (transport === "stdio") {
    await runStdio();
    return;
  }

  console.error(`[mcp] unknown MCP_TRANSPORT value: ${transport} (expected "stdio" or "http")`);
  process.exit(1);
}

main().catch((err) => {
  console.error("[mcp] fatal startup error:", err);
  process.exit(1);
});
