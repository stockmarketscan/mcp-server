import { z } from "zod";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { McpContext } from "../context";

export const ScreenersInputSchema = z.object({
  slug: z.string().min(1).describe("The screener slug, e.g. 'hot-prospects', 'golden-cross', 'rsi-oversold'"),
  page: z.number().int().min(1).max(10000).default(1).optional().describe("Page number (1-based)"),
  limit: z.number().int().min(1).max(500).default(50).optional().describe("Rows per page (max 500)"),
});

export const SearchStocksInScreenersInputSchema = z.object({
  screener_slugs: z
    .array(z.string())
    .min(1)
    .max(24)
    .describe("List of screener slugs to query (1-24)"),
  mode: z
    .enum(["intersection", "union"])
    .default("intersection")
    .optional()
    .describe("intersection = stocks in ALL screeners; union = stocks in ANY screener"),
  limit: z.number().int().min(1).max(500).default(50).optional(),
});

export const screenersTools: Tool[] = [
  {
    name: "list_screeners",
    description:
      "Return metadata for all 24 stock screeners on the platform, including each screener's slug, name, description, category, and tier. Use this to discover which screeners are available before calling get_screener_data. Call this once per session — the list changes very rarely. Returns { tier, total, accessible, screeners: [...] }.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_screener_data",
    description:
      "Return the current rows of a single stock screener for its latest data date. Use this when the user asks about a specific screener like 'hot prospects' or 'golden cross'. Common slugs: hot-prospects, golden-cross, death-cross, rsi-oversold, rsi-overbought, defensive-stocks, dividend-prospects, j-pattern, nearing-6-month-highs, week-52-high-top-picks, top-penny-pops, strong-volume-gains, top-tech-stocks, fundamentally-fine, income-and-growth, best-reits. If you don't know the slug, call list_screeners first. Returns { screener, pagination, data: [stock rows] }.",
    inputSchema: z.toJSONSchema(ScreenersInputSchema) as Tool["inputSchema"],
  },
  {
    name: "search_stocks_in_screeners",
    description:
      "Find stocks that appear in multiple screeners simultaneously. Powerful for high-confidence picks where the user wants confluence across strategies. Use when the user asks 'which stocks are in both X and Y' or 'find stocks in 3+ bullish screeners'. Returns { screeners_queried, mode, count, symbols: [{symbol, screeners, match_count}] }. Intersection mode returns only stocks in ALL listed screeners; union returns stocks in ANY.",
    inputSchema: z.toJSONSchema(SearchStocksInScreenersInputSchema) as Tool["inputSchema"],
  },
];

export async function handleListScreeners(ctx: McpContext): Promise<unknown> {
  return ctx.cache.wrap("screeners:list", 3_600_000, () => ctx.apiClient.get("/screeners"));
}

export async function handleGetScreenerData(
  ctx: McpContext,
  rawArgs: unknown
): Promise<unknown> {
  const args = ScreenersInputSchema.parse(rawArgs);
  const page = args.page ?? 1;
  const limit = args.limit ?? 50;
  const key = `screeners:${args.slug}:${page}:${limit}`;
  return ctx.cache.wrap(key, 300_000, () =>
    ctx.apiClient.get(`/screeners/${args.slug}`, { page, limit })
  );
}

export async function handleSearchStocksInScreeners(
  ctx: McpContext,
  rawArgs: unknown
): Promise<unknown> {
  const args = SearchStocksInScreenersInputSchema.parse(rawArgs);
  const mode = args.mode ?? "intersection";
  const limit = args.limit ?? 50;

  // Fetch each screener in parallel with cached reads
  const results = await Promise.all(
    args.screener_slugs.map(async (slug) => {
      try {
        const res = await ctx.cache.wrap(
          `screeners:${slug}:1:500`,
          300_000,
          () =>
            ctx.apiClient.get<{ data?: { symbol?: string }[] }>(`/screeners/${slug}`, { limit: 500 })
        );
        const symbols = new Set(
          (res.data || [])
            .map((r) => (r.symbol || "").toUpperCase())
            .filter(Boolean)
        );
        return { slug, symbols };
      } catch {
        return { slug, symbols: new Set<string>() };
      }
    })
  );

  // Build symbol → screeners map
  const symbolMap = new Map<string, string[]>();
  for (const { slug, symbols } of results) {
    for (const sym of symbols) {
      if (!symbolMap.has(sym)) symbolMap.set(sym, []);
      symbolMap.get(sym)!.push(slug);
    }
  }

  const combined = Array.from(symbolMap.entries())
    .map(([symbol, screeners]) => ({
      symbol,
      screeners,
      match_count: screeners.length,
    }))
    .filter((row) => {
      if (mode === "intersection") return row.match_count === args.screener_slugs.length;
      return row.match_count >= 1;
    })
    .sort((a, b) => b.match_count - a.match_count || a.symbol.localeCompare(b.symbol))
    .slice(0, limit);

  return {
    screeners_queried: args.screener_slugs,
    mode,
    count: combined.length,
    symbols: combined,
  };
}
