/**
 * Standard tool annotations for every StockMarketScan MCP tool.
 *
 * All our tools are read-only (we never mutate upstream data — the server
 * only proxies GETs and a POST to /api/v1/patterns which is an idempotent
 * lookup). Claude.ai's MCP Directory submission guide lists these hints as
 * a hard requirement.
 *
 *   readOnlyHint      — the tool does not modify anything
 *   destructiveHint   — false because nothing is destroyed
 *   idempotentHint    — calling twice with the same args returns equivalent
 *                       data (stock values update over time, but there's no
 *                       side effect on the caller's state)
 *   openWorldHint     — tools query live market data from an external source
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";

export const READ_ONLY_ANNOTATIONS: Tool["annotations"] = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};
