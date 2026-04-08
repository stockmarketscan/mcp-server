import { z } from "zod";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { McpContext } from "../context";

const symbolRegex = /^[A-Z0-9.^=\-]{1,20}$/;

export const GetStockInfoInputSchema = z.object({
  symbol: z
    .string()
    .regex(symbolRegex, "Invalid symbol")
    .describe("Stock ticker, e.g. AAPL"),
});

export const GetCandlesInputSchema = z.object({
  symbol: z.string().regex(symbolRegex, "Invalid symbol").describe("Stock ticker"),
  interval: z.enum(["1d", "1wk"]).default("1d").optional().describe("Daily or weekly candles"),
  range: z
    .string()
    .default("6mo")
    .optional()
    .describe("Range: 1d, 5d, 1y, 2y, 5y, max, or {N}mo (1-240)"),
});

export const stockTools: Tool[] = [
  {
    name: "get_stock_info",
    description:
      "Return basic metadata for a stock — full company name, exchange, industry, last close price, and percent change. Use this when you first encounter a symbol and need to identify it. Lighter than get_stock_report (composite) or get_candles (full history). Returns { symbol, symbol_name, last_price, percent_change, exchange, industry }. Returns NOT_FOUND for unknown tickers.",
    inputSchema: z.toJSONSchema(GetStockInfoInputSchema) as Tool["inputSchema"],
  },
  {
    name: "get_candles",
    description:
      "Return OHLCV price candles for a single stock. Use when you need price history to compute indicators or answer 'how much is X up this month'. time is a Unix epoch in seconds (UTC midnight for daily). Default range is 6mo. Use larger ranges like '1y' or '2y' only when the user explicitly asks for long history — max range is 20 years. Returns { symbol, interval, range, count, data: [{time, open, high, low, close, volume}] }.",
    inputSchema: z.toJSONSchema(GetCandlesInputSchema) as Tool["inputSchema"],
  },
];

export async function handleGetStockInfo(
  ctx: McpContext,
  rawArgs: unknown
): Promise<unknown> {
  const args = GetStockInfoInputSchema.parse(rawArgs);
  const sym = args.symbol.toUpperCase();
  const key = `stock:${sym}`;
  return ctx.cache.wrap(key, 300_000, () =>
    ctx.apiClient.get(`/stocks/${encodeURIComponent(sym)}`)
  );
}

export async function handleGetCandles(
  ctx: McpContext,
  rawArgs: unknown
): Promise<unknown> {
  const args = GetCandlesInputSchema.parse(rawArgs);
  const sym = args.symbol.toUpperCase();
  const interval = args.interval ?? "1d";
  const range = args.range ?? "6mo";
  const key = `candles:${sym}:${interval}:${range}`;
  return ctx.cache.wrap(key, 600_000, () =>
    ctx.apiClient.get(`/stocks/${encodeURIComponent(sym)}/candles`, {
      interval,
      range,
    })
  );
}
