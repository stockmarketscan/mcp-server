import { z } from "zod";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { McpContext } from "../context";
import { READ_ONLY_ANNOTATIONS } from "./annotations";

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

export const GetMarketMomentumInputSchema = z.object({
  date: z.string().regex(dateRegex).optional().describe("Single day (YYYY-MM-DD)"),
  date_from: z.string().regex(dateRegex).optional().describe("Range start"),
  date_to: z.string().regex(dateRegex).optional().describe("Range end"),
});

export const marketMomentumTools: Tool[] = [
  {
    name: "get_market_momentum",
    description:
      "Return NYSE and NASDAQ market breadth data — advancing/declining issues, new highs/lows, percent advancing. Use when the user asks 'how's the market today' or 'is breadth strong'. Default (no params): last 7 trading days. Returns { dates, count, data: [{exchange, advancing_issues, declining_issues, new_highs, new_lows, percent_advancing_issues, data_date}] }. Two rows per date (NYSE + NASDAQ). Tier: Basic+.",
    inputSchema: z.toJSONSchema(GetMarketMomentumInputSchema) as Tool["inputSchema"],
    annotations: READ_ONLY_ANNOTATIONS,
  },
];

export async function handleGetMarketMomentum(
  ctx: McpContext,
  rawArgs: unknown
): Promise<unknown> {
  const args = GetMarketMomentumInputSchema.parse(rawArgs);
  const key = `market-momentum:${args.date || ""}:${args.date_from || ""}:${args.date_to || ""}`;
  return ctx.cache.wrap(key, 300_000, () =>
    ctx.apiClient.get("/market-momentum", {
      date: args.date,
      date_from: args.date_from,
      date_to: args.date_to,
    })
  );
}
