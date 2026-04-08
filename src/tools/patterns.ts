import { z } from "zod";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { McpContext } from "../context";

const symbolRegex = /^[A-Z0-9.^=\-]{1,20}$/;

export const GetChartPatternsInputSchema = z.object({
  symbol: z
    .string()
    .regex(symbolRegex, "Invalid symbol — use uppercase like AAPL")
    .describe("Stock ticker, e.g. AAPL, TSLA, MSFT"),
  interval: z.enum(["1d", "1wk"]).default("1d").optional().describe("Chart interval"),
});

export const SearchPatternsInputSchema = z.object({
  screener_slugs: z
    .array(z.string())
    .min(1)
    .max(24)
    .describe("Screener slugs to search within"),
  pattern_ids: z
    .array(z.string())
    .default([])
    .optional()
    .describe("Pattern ids to filter by (e.g. 'head_shoulders', 'cup_handle'). Empty = all patterns."),
  interval: z.enum(["1d", "1wk"]).default("1d").optional().describe("Chart interval"),
});

export const patternsTools: Tool[] = [
  {
    name: "get_chart_patterns",
    description:
      "Return all chart patterns currently detected for a single stock symbol. Covers 25+ patterns including head_shoulders, cup_handle, wedge_rising/falling, asc/desc/sym_triangle, double_top/bottom, channel_up/down, cup_handle, harmonic patterns (gartley, butterfly, bat, crab). Use when the user asks 'what patterns does X have' or 'is X forming a head and shoulders'. Returns { symbol, interval, computedAt, candleCount, patterns: [...] }. Empty patterns array if none detected.",
    inputSchema: z.toJSONSchema(GetChartPatternsInputSchema) as Tool["inputSchema"],
  },
  {
    name: "search_patterns",
    description:
      "Find all stocks across one or more screeners that currently exhibit specific chart patterns. Much faster than calling get_chart_patterns in a loop. Use when the user asks 'which stocks have a cup and handle' or 'find me hot prospects with bullish reversal patterns'. Returns { screeners_queried, patterns_queried, interval, count, matches: [...] }.",
    inputSchema: z.toJSONSchema(SearchPatternsInputSchema) as Tool["inputSchema"],
  },
];

export async function handleGetChartPatterns(
  ctx: McpContext,
  rawArgs: unknown
): Promise<unknown> {
  const args = GetChartPatternsInputSchema.parse(rawArgs);
  const interval = args.interval ?? "1d";
  const key = `patterns:${args.symbol.toUpperCase()}:${interval}`;
  return ctx.cache.wrap(key, 600_000, () =>
    ctx.apiClient.get(`/patterns/${encodeURIComponent(args.symbol.toUpperCase())}`, {
      interval,
    })
  );
}

export async function handleSearchPatterns(
  ctx: McpContext,
  rawArgs: unknown
): Promise<unknown> {
  const args = SearchPatternsInputSchema.parse(rawArgs);
  const interval = args.interval ?? "1d";
  const patternIds = args.pattern_ids ?? [];
  return ctx.apiClient.post("/patterns", {
    screeners: args.screener_slugs,
    patterns: patternIds,
    interval,
  });
}
