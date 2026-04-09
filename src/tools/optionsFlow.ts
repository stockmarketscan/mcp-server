import { z } from "zod";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { McpContext } from "../context";
import { READ_ONLY_ANNOTATIONS } from "./annotations";

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
const symbolRegex = /^[A-Z0-9.^=\-]{1,20}$/;

export const GetOptionsFlowOverviewInputSchema = z.object({
  date: z
    .string()
    .regex(dateRegex, "Invalid date — use YYYY-MM-DD")
    .optional()
    .describe("Trading day (YYYY-MM-DD). Default = latest available day."),
  sort: z
    .enum(["streak", "volume", "callput", "premium"])
    .default("streak")
    .optional()
    .describe("Sort order: streak=longest streaks first, volume=highest volume, callput=most extreme C/P, premium=biggest dollar"),
  limit: z
    .number()
    .int()
    .min(1)
    .max(500)
    .default(100)
    .optional()
    .describe("Rows to return (max 500)"),
});

export const GetOptionsFlowTimelineInputSchema = z.object({
  symbol: z.string().regex(symbolRegex).describe("Stock ticker"),
  limit: z.number().int().min(1).max(365).default(60).optional().describe("Days of history (max 365)"),
});

export const GetOptionsFlowSignalsInputSchema = z.object({
  date_from: z.string().regex(dateRegex).optional().describe("Start date (YYYY-MM-DD)"),
  date_to: z.string().regex(dateRegex).optional().describe("End date (YYYY-MM-DD)"),
});

export const GetUnusualOptionsActivityInputSchema = z.object({
  symbol: z.string().regex(symbolRegex).optional().describe("Filter to one symbol"),
  side: z.enum(["call", "put", "both"]).default("both").optional(),
  min_vol_oi: z.number().min(0).default(1.5).optional(),
  min_premium_usd: z.number().min(0).default(25000).optional(),
  max_dte: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).max(1000).default(300).optional(),
});

export const optionsFlowTools: Tool[] = [
  {
    name: "get_options_flow_overview",
    description:
      "Return the daily options flow table for one trading day — aggregated call/put volume, premium, implied volatility, and consecutive-day streaks for every notable symbol. Use when the user asks 'what's the options flow today' or 'show me the top premium plays'. Each row includes call_put_volume_ratio (bullish if > 1.0), consecutive_days (streak length), total_premium (dollar size), call_avg_iv/put_avg_iv. Returns { date, sort, limit, data: [...], stats, dates }. Tier: Pro only — Basic users get 403.",
    inputSchema: z.toJSONSchema(GetOptionsFlowOverviewInputSchema) as Tool["inputSchema"],
    annotations: READ_ONLY_ANNOTATIONS,
  },
  {
    name: "get_options_flow_timeline",
    description:
      "Return the historical options flow for a single stock — most recent days first. Use when the user asks 'show me X's options flow history' or 'how long has X been bullish'. Returns { symbol, limit, count, data: [daily rows, newest first] }. Tier: Pro only.",
    inputSchema: z.toJSONSchema(GetOptionsFlowTimelineInputSchema) as Tool["inputSchema"],
    annotations: READ_ONLY_ANNOTATIONS,
  },
  {
    name: "get_options_flow_signals",
    description:
      "Return curated high-conviction options flow signals for a date range. These are the strongest setups filtered by long streaks, large premium, and screener confluence. Each signal includes performance tracking (max_high_pct, max_drawdown_pct). Use when the user asks 'what are today's signals' or 'show me bullish setups from last week'. If date_from/date_to omitted, returns last 60 days. Returns { count, signals: [...] }. Tier: Pro only.",
    inputSchema: z.toJSONSchema(GetOptionsFlowSignalsInputSchema) as Tool["inputSchema"],
    annotations: READ_ONLY_ANNOTATIONS,
  },
  {
    name: "get_unusual_options_activity",
    description:
      "Return individual options contracts flagged as unusual (Vol/OI > 1.5). Each row is one contract, not one stock. Use when the user wants contract-level detail. Filter by symbol, side (call/put/both), minimum vol/oi, minimum premium, or max days to expiration. For aggregated stock-level flow use get_options_flow_overview instead. Returns { date, count, contracts: [...] }.",
    inputSchema: z.toJSONSchema(GetUnusualOptionsActivityInputSchema) as Tool["inputSchema"],
    annotations: READ_ONLY_ANNOTATIONS,
  },
];

export async function handleGetOptionsFlowOverview(
  ctx: McpContext,
  rawArgs: unknown
): Promise<unknown> {
  const args = GetOptionsFlowOverviewInputSchema.parse(rawArgs);
  const sort = args.sort ?? "streak";
  const limit = args.limit ?? 100;
  const date = args.date ?? "latest";
  const key = `options-flow:overview:${date}:${sort}:${limit}`;
  return ctx.cache.wrap(key, 120_000, () =>
    ctx.apiClient.get("/options-flow", {
      date: args.date,
      sort,
      limit,
    })
  );
}

export async function handleGetOptionsFlowTimeline(
  ctx: McpContext,
  rawArgs: unknown
): Promise<unknown> {
  const args = GetOptionsFlowTimelineInputSchema.parse(rawArgs);
  const sym = args.symbol.toUpperCase();
  const limit = args.limit ?? 60;
  const key = `options-flow:timeline:${sym}:${limit}`;
  return ctx.cache.wrap(key, 300_000, () =>
    ctx.apiClient.get(`/options-flow/${encodeURIComponent(sym)}`, { limit })
  );
}

export async function handleGetOptionsFlowSignals(
  ctx: McpContext,
  rawArgs: unknown
): Promise<unknown> {
  const args = GetOptionsFlowSignalsInputSchema.parse(rawArgs);
  const key = `options-flow:signals:${args.date_from || "default"}:${args.date_to || "default"}`;
  return ctx.cache.wrap(key, 300_000, () =>
    ctx.apiClient.get("/options-flow/signals", {
      date_from: args.date_from,
      date_to: args.date_to,
    })
  );
}

interface UnusualContract {
  symbol?: string;
  symbol_type?: string;
  volume?: string | number;
  open_interest?: string | number;
  volume_oi_ratio?: string | number;
  last_price?: string | number;
  days_to_expiration?: number;
}

export async function handleGetUnusualOptionsActivity(
  ctx: McpContext,
  rawArgs: unknown
): Promise<unknown> {
  const args = GetUnusualOptionsActivityInputSchema.parse(rawArgs);
  const limit = args.limit ?? 300;
  const side = args.side ?? "both";
  const minVolOi = args.min_vol_oi ?? 1.5;
  const minPremium = args.min_premium_usd ?? 25000;

  const raw = await ctx.cache.wrap(`uoa:raw:${limit}`, 120_000, () =>
    ctx.apiClient.get<{ data?: UnusualContract[] }>(`/options-flow/unusual`, { limit })
  );

  // Client-side filter
  const toNum = (v: unknown) => {
    if (typeof v === "number") return v;
    if (typeof v === "string") return Number(v.replace(/,/g, "")) || 0;
    return 0;
  };
  const contracts = (raw.data || []).filter((r: UnusualContract) => {
    if (args.symbol && (r.symbol || "").toUpperCase() !== args.symbol.toUpperCase()) return false;
    if (side === "call" && r.symbol_type !== "Call") return false;
    if (side === "put" && r.symbol_type !== "Put") return false;
    if (toNum(r.volume_oi_ratio) < minVolOi) return false;
    const premium = toNum(r.last_price) * toNum(r.volume) * 100;
    if (premium < minPremium) return false;
    if (args.max_dte != null && (r.days_to_expiration || 0) > args.max_dte) return false;
    return true;
  });

  return {
    count: contracts.length,
    contracts,
  };
}
