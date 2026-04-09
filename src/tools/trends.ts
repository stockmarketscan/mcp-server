import { z } from "zod";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { McpContext } from "../context";
import { READ_ONLY_ANNOTATIONS } from "./annotations";

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

export const GetTrendsInputSchema = z.object({
  category: z
    .enum(["techscience", "patents", "fundingevents"])
    .default("techscience")
    .optional()
    .describe("Trend category"),
  days: z.number().int().min(1).max(180).default(10).optional().describe("Lookback window"),
  latest: z.boolean().default(false).optional().describe("If true, only return most recent day"),
  date: z.string().regex(dateRegex).optional().describe("Exact date lookup"),
});

export const GetTrendConnectionsInputSchema = z.object({
  days: z.number().int().min(1).max(90).default(14).optional(),
  latest: z.boolean().default(false).optional(),
  date: z.string().regex(dateRegex).optional(),
});

export const trendsTools: Tool[] = [
  {
    name: "get_trends",
    description:
      "Return AI-detected trending topics in tech & science, patents, or funding events. Use when the user asks 'what's trending in tech' or 'show me patent trends'. Returns { category, count, trends: [{date, topic, weight}] } where weight is 0-1. Tier: Pro only.",
    inputSchema: z.toJSONSchema(GetTrendsInputSchema) as Tool["inputSchema"],
    annotations: READ_ONLY_ANNOTATIONS,
  },
  {
    name: "get_trend_connections",
    description:
      "Return AI-computed connections between trending topics across categories (tech → patents, tech → funding, etc). Useful for spotting meta-trends. Use when the user asks 'what trends are connected' or 'show me cross-category signals'. Returns { count, connections: [{source_category, source_topic, target_category, target_topic, strength, rationale}] }. Tier: Pro only.",
    inputSchema: z.toJSONSchema(GetTrendConnectionsInputSchema) as Tool["inputSchema"],
    annotations: READ_ONLY_ANNOTATIONS,
  },
];

export async function handleGetTrends(ctx: McpContext, rawArgs: unknown): Promise<unknown> {
  const args = GetTrendsInputSchema.parse(rawArgs);
  const category = args.category ?? "techscience";
  const days = args.days ?? 10;
  const key = `trends:${category}:${days}:${args.latest ? "latest" : args.date || "range"}`;
  return ctx.cache.wrap(key, 1_800_000, () =>
    ctx.apiClient.get("/trends", {
      category,
      days,
      latest: args.latest ? 1 : undefined,
      date: args.date,
    })
  );
}

export async function handleGetTrendConnections(
  ctx: McpContext,
  rawArgs: unknown
): Promise<unknown> {
  const args = GetTrendConnectionsInputSchema.parse(rawArgs);
  const days = args.days ?? 14;
  const key = `trend-connections:${days}:${args.latest ? "latest" : args.date || "range"}`;
  return ctx.cache.wrap(key, 1_800_000, () =>
    ctx.apiClient.get("/trend-connections", {
      days,
      latest: args.latest ? 1 : undefined,
      date: args.date,
    })
  );
}
