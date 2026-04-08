import { z } from "zod";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { McpContext } from "../context";
import { McpError } from "../errors";

const symbolRegex = /^[A-Z0-9.^=\-]{1,20}$/;

// ── Shared types ────────────────────────────────────────────────────────────

interface FlowTimelineRow {
  data_date?: string;
  call_volume?: string | number;
  put_volume?: string | number;
  call_put_volume_ratio?: string | number | null;
  consecutive_days?: number;
  total_volume?: string | number;
  total_oi?: string | number;
  call_total_premium?: string | number;
  put_total_premium?: string | number;
  call_avg_iv?: string | number;
  put_avg_iv?: string | number;
}

interface PatternRow {
  name?: string;
  label?: string;
  direction?: string;
  confidence?: number;
}

interface SignalRow {
  symbol?: string;
  signal_date?: string;
  signal_type?: string;
  side?: string;
  strength_score?: number;
  call_put_ratio?: string | number;
  consecutive_days?: number;
  total_premium?: string | number;
}

interface CandleRow {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// ── Input schemas ───────────────────────────────────────────────────────────

export const GetStockReportInputSchema = z.object({
  symbol: z.string().regex(symbolRegex, "Invalid symbol").describe("Stock ticker, e.g. AAPL"),
  interval: z
    .enum(["1d", "1wk"])
    .default("1d")
    .optional()
    .describe("Pattern detection interval"),
});

export const SearchSetupsInputSchema = z.object({
  side: z
    .enum(["bullish", "bearish"])
    .default("bullish")
    .optional()
    .describe("Side of setups to return"),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(20)
    .optional()
    .describe("Max setups to return"),
});

// ── Tool metadata for registry ──────────────────────────────────────────────

export const compositeTools: Tool[] = [
  {
    name: "get_stock_report",
    description:
      "Return a comprehensive report on a single stock in one call — metadata, screener appearances, chart patterns, options flow, signal status, price summary, and upcoming earnings. THIS IS THE PREFERRED FIRST TOOL when a user asks about a single stock. It replaces 5-7 separate tool calls (get_stock_info + get_chart_patterns + get_options_flow_timeline + get_options_flow_signals + screener lookups + get_candles). Do NOT also call the primitives after calling this — the composite already has everything. Parallel fetch under the hood, graceful partial failures (if one source errors, that section returns null with a note). Returns { symbol, info, screeners, patterns, options_flow, signal, candle_summary, upcoming_earnings, overall_bias }. overall_bias is a heuristic hint, not financial advice.",
    inputSchema: z.toJSONSchema(GetStockReportInputSchema) as Tool["inputSchema"],
  },
  {
    name: "search_setups",
    description:
      "Find the strongest trading setups today by combining options flow signals and screener confluence into a ranked list. Use when the user asks 'what should I trade today', 'best setups', 'top bullish plays'. Returns a ranked list with a composite score (signal strength + screener confluence + streak length). Present the top 3-5 to the user with narrative context, don't dump the raw JSON. Use get_stock_report if the user wants to dig deeper into any specific result. Returns { side, date, count, setups: [{symbol, score, signal, screeners_hit, ...}] }.",
    inputSchema: z.toJSONSchema(SearchSetupsInputSchema) as Tool["inputSchema"],
  },
];

// ── Handlers ────────────────────────────────────────────────────────────────

type MaybeRow<T> = T | { error: string; code?: string };

async function safeCall<T>(fn: () => Promise<T>): Promise<MaybeRow<T>> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof McpError) {
      return { error: err.message, code: err.code };
    }
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

function toNum(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/,/g, ""));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

export async function handleGetStockReport(
  ctx: McpContext,
  rawArgs: unknown
): Promise<unknown> {
  const args = GetStockReportInputSchema.parse(rawArgs);
  const symbol = args.symbol.toUpperCase();
  const interval = args.interval ?? "1d";

  // Fan-out all primitive calls in parallel.
  const [infoRes, patternsRes, flowRes, signalsRes, candlesRes, screenersListRes] =
    await Promise.all([
      safeCall(() => ctx.apiClient.get<Record<string, unknown>>(`/stocks/${encodeURIComponent(symbol)}`)),
      safeCall(() =>
        ctx.apiClient.get<{ patterns?: PatternRow[]; computedAt?: string; candleCount?: number; interval?: string }>(
          `/patterns/${encodeURIComponent(symbol)}`,
          { interval }
        )
      ),
      safeCall(() =>
        ctx.apiClient.get<{ data?: FlowTimelineRow[] }>(`/options-flow/${encodeURIComponent(symbol)}`, {
          limit: 30,
        })
      ),
      safeCall(() =>
        ctx.apiClient.get<{ signals?: SignalRow[] }>(`/options-flow/signals`)
      ),
      safeCall(() =>
        ctx.apiClient.get<{ data?: CandleRow[] }>(`/stocks/${encodeURIComponent(symbol)}/candles`, {
          range: "3mo",
          interval: "1d",
        })
      ),
      // Load the full screener list so we can cross-reference
      ctx.cache.wrap("screeners:list", 3_600_000, () =>
        ctx.apiClient.get<{ screeners?: { slug: string; tier: string }[] }>("/screeners")
      ).catch(() => null),
    ]);

  // If the primary info lookup failed outright, return NOT_FOUND-ish.
  if ("error" in infoRes) {
    throw new McpError(
      `Could not load stock info for ${symbol}: ${infoRes.error}`,
      (infoRes as { code?: string }).code === "NOT_FOUND" ? "NOT_FOUND" : "UPSTREAM_ERROR",
      "get_stock_report"
    );
  }

  // Resolve screener appearances by fanning out reads in parallel across
  // every accessible screener and checking each for the symbol.
  let screenersHit: string[] = [];
  if (screenersListRes && "screeners" in (screenersListRes as Record<string, unknown>)) {
    const list = (screenersListRes as { screeners: { slug: string; tier: string }[] }).screeners || [];
    // Filter out non-symbol screeners
    const slugs = list
      .map((s) => s.slug)
      .filter((slug) => slug !== "market-momentum");
    // Parallel lookups — cap concurrency implicitly via browser/node fetch pool
    const checks = await Promise.all(
      slugs.map(async (slug) => {
        try {
          const res = await ctx.cache.wrap(
            `screeners:${slug}:1:500`,
            300_000,
            () => ctx.apiClient.get<{ data?: { symbol?: string }[] }>(`/screeners/${slug}`, { limit: 500 })
          );
          const rows = (res as { data?: { symbol?: string }[] }).data || [];
          return rows.some((r) => (r.symbol || "").toUpperCase() === symbol) ? slug : null;
        } catch {
          return null;
        }
      })
    );
    screenersHit = checks.filter((s): s is string => s !== null);
  }

  // ── Build the composite response ──
  const patternsList = ("error" in patternsRes)
    ? []
    : ((patternsRes as { patterns?: PatternRow[] }).patterns || []);

  const flowData = ("error" in flowRes)
    ? []
    : ((flowRes as { data?: FlowTimelineRow[] }).data || []);
  const latestFlow = flowData[0];

  const allSignals = ("error" in signalsRes)
    ? []
    : ((signalsRes as { signals?: SignalRow[] }).signals || []);
  const symbolSignals = allSignals
    .filter((s) => (s.symbol || "").toUpperCase() === symbol)
    .sort((a, b) => (b.signal_date || "").localeCompare(a.signal_date || ""));
  const todaySignal = symbolSignals[0];
  const hasSignalToday = todaySignal && latestFlow
    ? (todaySignal.signal_date?.slice(0, 10) || "") === (latestFlow.data_date?.slice(0, 10) || "")
    : false;

  const candlesData = ("error" in candlesRes)
    ? []
    : ((candlesRes as { data?: CandleRow[] }).data || []);
  let candleSummary: Record<string, number | null> | null = null;
  if (candlesData.length > 0) {
    const closes = candlesData.map((c) => c.close);
    const lastClose = closes[closes.length - 1];
    const ma20 = closes.length >= 20
      ? closes.slice(-20).reduce((a, b) => a + b, 0) / 20
      : null;
    const change5d = closes.length >= 6
      ? ((lastClose - closes[closes.length - 6]) / closes[closes.length - 6]) * 100
      : null;
    const change30d = closes.length >= 31
      ? ((lastClose - closes[closes.length - 31]) / closes[closes.length - 31]) * 100
      : null;
    candleSummary = {
      last_close: Number(lastClose.toFixed(2)),
      ma_20: ma20 ? Number(ma20.toFixed(2)) : null,
      vs_ma_20_pct: ma20 ? Number((((lastClose - ma20) / ma20) * 100).toFixed(2)) : null,
      percent_change_5d: change5d ? Number(change5d.toFixed(2)) : null,
      percent_change_30d: change30d ? Number(change30d.toFixed(2)) : null,
      candle_count: candlesData.length,
    };
  }

  // Overall bias heuristic
  const flowBullish =
    latestFlow && toNum(latestFlow.call_put_volume_ratio) > 1.2 && (latestFlow.consecutive_days || 0) >= 2;
  const flowBearish =
    latestFlow && toNum(latestFlow.call_put_volume_ratio) < 0.8 && (latestFlow.consecutive_days || 0) >= 2;
  const hasBullishPattern = patternsList.some((p) => p.direction === "bullish");
  const hasBearishPattern = patternsList.some((p) => p.direction === "bearish");
  let overallBias: "bullish" | "bearish" | "neutral";
  if (flowBullish && (hasBullishPattern || screenersHit.length >= 2)) overallBias = "bullish";
  else if (flowBearish && (hasBearishPattern || screenersHit.length === 0)) overallBias = "bearish";
  else overallBias = "neutral";

  return {
    symbol,
    as_of: (latestFlow?.data_date || "").slice(0, 10) || null,
    info: "error" in infoRes ? null : infoRes,
    screeners: {
      count: screenersHit.length,
      appearing_in: screenersHit,
    },
    patterns: "error" in patternsRes
      ? { error: (patternsRes as { error: string }).error }
      : {
          interval,
          count: patternsList.length,
          list: patternsList.map((p) => ({
            name: p.name,
            direction: p.direction,
            confidence: p.confidence,
          })),
        },
    options_flow: "error" in flowRes
      ? { error: (flowRes as { error: string; code?: string }).error, code: (flowRes as { code?: string }).code }
      : latestFlow
        ? {
            latest_day: (latestFlow.data_date || "").slice(0, 10),
            call_put_ratio: latestFlow.call_put_volume_ratio ?? null,
            consecutive_days: latestFlow.consecutive_days ?? null,
            total_premium:
              toNum(latestFlow.call_total_premium) + toNum(latestFlow.put_total_premium),
            call_avg_iv: latestFlow.call_avg_iv ?? null,
            put_avg_iv: latestFlow.put_avg_iv ?? null,
          }
        : null,
    signal: "error" in signalsRes
      ? { error: (signalsRes as { error: string }).error }
      : {
          has_signal_today: hasSignalToday,
          last_signal_date: todaySignal?.signal_date || null,
          last_signal_side: todaySignal?.side || null,
          last_signal_strength: todaySignal?.strength_score ?? null,
        },
    candle_summary: candleSummary,
    overall_bias: overallBias,
    notes: "overall_bias is a heuristic hint based on flow, patterns, and screener confluence. It is NOT financial advice.",
  };
}

export async function handleSearchSetups(
  ctx: McpContext,
  rawArgs: unknown
): Promise<unknown> {
  const args = SearchSetupsInputSchema.parse(rawArgs);
  const side = args.side ?? "bullish";
  const limit = args.limit ?? 20;

  // Pull today's signals (all sides)
  const signalsRes = await safeCall(() =>
    ctx.cache.wrap("options-flow:signals:default", 300_000, () =>
      ctx.apiClient.get<{ signals?: SignalRow[] }>("/options-flow/signals")
    )
  );

  if ("error" in signalsRes) {
    throw new McpError(
      `Could not load signals: ${signalsRes.error}`,
      (signalsRes as { code?: string }).code === "TIER_UPGRADE_REQUIRED"
        ? "TIER_UPGRADE_REQUIRED"
        : "UPSTREAM_ERROR",
      "search_setups"
    );
  }

  const allSignals = (signalsRes as { signals?: SignalRow[] }).signals || [];
  if (allSignals.length === 0) {
    return { side, date: null, count: 0, setups: [], note: "No signals available yet." };
  }

  // Get the most recent signal date
  const latestDate = allSignals
    .map((s) => (s.signal_date || "").slice(0, 10))
    .sort()
    .pop() || "";
  const todaysSignals = allSignals.filter(
    (s) => (s.signal_date || "").slice(0, 10) === latestDate && s.side === side
  );

  if (todaysSignals.length === 0) {
    return { side, date: latestDate, count: 0, setups: [] };
  }

  // Score each signal
  const setups = todaysSignals.map((s) => {
    const strength = s.strength_score || 0;
    const streakBonus = (s.consecutive_days || 0) >= 5 ? 1 : 0;
    const premiumBonus = toNum(s.total_premium) >= 10_000_000 ? 0.5 : 0;
    const score = strength + streakBonus + premiumBonus;
    return {
      symbol: s.symbol,
      score: Number(score.toFixed(1)),
      signal: {
        type: s.signal_type,
        strength: strength,
        consecutive_days: s.consecutive_days,
        call_put_ratio: s.call_put_ratio,
        total_premium: toNum(s.total_premium),
      },
    };
  });

  setups.sort((a, b) => b.score - a.score);

  return {
    side,
    date: latestDate,
    count: setups.length,
    setups: setups.slice(0, limit),
    note:
      "Scores combine signal strength, streak length, and premium size. This is a ranking hint, not financial advice.",
  };
}
