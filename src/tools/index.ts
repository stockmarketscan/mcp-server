import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { ZodError } from "zod";
import type { McpContext } from "../context";
import { McpError } from "../errors";

import {
  screenersTools,
  handleListScreeners,
  handleGetScreenerData,
  handleSearchStocksInScreeners,
} from "./screeners";
import {
  patternsTools,
  handleGetChartPatterns,
  handleSearchPatterns,
} from "./patterns";
import {
  optionsFlowTools,
  handleGetOptionsFlowOverview,
  handleGetOptionsFlowTimeline,
  handleGetOptionsFlowSignals,
  handleGetUnusualOptionsActivity,
} from "./optionsFlow";
import { stockTools, handleGetStockInfo, handleGetCandles } from "./stocks";
import {
  compositeTools,
  handleGetStockReport,
  handleSearchSetups,
} from "./composite";
import { marketMomentumTools, handleGetMarketMomentum } from "./marketMomentum";
import { trendsTools, handleGetTrends, handleGetTrendConnections } from "./trends";
import { educationTools, handleExplainConcept } from "./education";

// ── Tool registry ──────────────────────────────────────────────────────────

const PING_TOOL: Tool = {
  name: "ping",
  description:
    "Minimal sanity check. Returns { status, version, timestamp, cache_size }. No auth needed. Use this to verify the MCP server is reachable and responsive.",
  inputSchema: { type: "object", properties: {}, required: [] },
};

const ALL_TOOLS: Tool[] = [
  PING_TOOL,
  ...screenersTools,
  ...patternsTools,
  ...optionsFlowTools,
  ...stockTools,
  ...compositeTools,
  ...marketMomentumTools,
  ...trendsTools,
  ...educationTools,
];

type ToolHandler = (ctx: McpContext, args: unknown) => Promise<unknown>;

const HANDLERS: Record<string, ToolHandler> = {
  ping: async (ctx) => ({
    status: "ok",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
    cache_size: ctx.cache.size(),
  }),
  list_screeners: (ctx) => handleListScreeners(ctx),
  get_screener_data: (ctx, args) => handleGetScreenerData(ctx, args),
  search_stocks_in_screeners: (ctx, args) => handleSearchStocksInScreeners(ctx, args),
  get_chart_patterns: (ctx, args) => handleGetChartPatterns(ctx, args),
  search_patterns: (ctx, args) => handleSearchPatterns(ctx, args),
  get_options_flow_overview: (ctx, args) => handleGetOptionsFlowOverview(ctx, args),
  get_options_flow_timeline: (ctx, args) => handleGetOptionsFlowTimeline(ctx, args),
  get_options_flow_signals: (ctx, args) => handleGetOptionsFlowSignals(ctx, args),
  get_unusual_options_activity: (ctx, args) => handleGetUnusualOptionsActivity(ctx, args),
  get_stock_info: (ctx, args) => handleGetStockInfo(ctx, args),
  get_candles: (ctx, args) => handleGetCandles(ctx, args),
  get_stock_report: (ctx, args) => handleGetStockReport(ctx, args),
  search_setups: (ctx, args) => handleSearchSetups(ctx, args),
  get_market_momentum: (ctx, args) => handleGetMarketMomentum(ctx, args),
  get_trends: (ctx, args) => handleGetTrends(ctx, args),
  get_trend_connections: (ctx, args) => handleGetTrendConnections(ctx, args),
  explain_concept: (ctx, args) => handleExplainConcept(ctx, args),
};

// ── Registration ───────────────────────────────────────────────────────────

export function registerAllTools(server: Server, ctx: McpContext): void {
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: ALL_TOOLS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params.name;
    const args = req.params.arguments ?? {};

    try {
      const handler = HANDLERS[name];
      if (!handler) {
        throw new McpError(`Unknown tool: ${name}`, "NOT_FOUND", name);
      }

      const result = await handler(ctx, args);

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      if (err instanceof ZodError) {
        const zodErr = new McpError(
          `Invalid input: ${err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
          "INVALID_INPUT",
          name
        );
        return {
          content: [{ type: "text", text: JSON.stringify(zodErr.toJSON(), null, 2) }],
          isError: true,
        };
      }

      if (err instanceof McpError) {
        err.tool = name;
        return {
          content: [{ type: "text", text: JSON.stringify(err.toJSON(), null, 2) }],
          isError: true,
        };
      }

      const message = err instanceof Error ? err.message : String(err);
      console.error(`[mcp:${name}] unhandled error:`, message);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                error: "Internal server error. Please try again.",
                code: "INTERNAL_ERROR",
                tool: name,
              },
              null,
              2
            ),
          },
        ],
        isError: true,
      };
    }
  });
}
