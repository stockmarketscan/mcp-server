import { z } from "zod";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { McpContext } from "../context";
import { McpError } from "../errors";

export const ExplainConceptInputSchema = z.object({
  term: z
    .string()
    .min(1)
    .describe("Term to explain, e.g. 'call_put_ratio', 'golden_cross', 'consecutive_days', 'strength_score', 'vol_oi_ratio', 'streak'"),
});

interface GlossaryEntry {
  title: string;
  explanation: string;
  interpretation?: Record<string, unknown>;
  related_terms?: string[];
}

const GLOSSARY: Record<string, GlossaryEntry> = {
  call_put_ratio: {
    title: "Call/Put Ratio (C/P)",
    explanation:
      "The day's call option volume divided by the day's put option volume. Measures which side of the options market is seeing more activity — calls (bullish bets) or puts (bearish bets / hedges).",
    interpretation: {
      bullish_clear: "> 1.6",
      bearish_clear: "< 0.65",
      neutral_zone: "0.65 to 1.6",
      extreme_bullish: "> 2.5",
      extreme_bearish: "< 0.4",
      caveat:
        "A high ratio alone is not meaningful without premium size and streak context — $50K premium with a 10x ratio is retail noise.",
    },
    related_terms: ["consecutive_days", "total_premium", "iv_skew"],
  },
  consecutive_days: {
    title: "Consecutive Days (Streak)",
    explanation:
      "Number of consecutive trading sessions a stock has held the same options flow bias (C/P > 1 = bullish regime, C/P < 1 = bearish regime). A streak resets when the direction flips.",
    interpretation: {
      noise: "1-2 days",
      notable: "3-4 days",
      strong: "5+ days",
      rare: "8+ days (usually tied to a real ongoing story)",
    },
    related_terms: ["call_put_ratio", "strength_score"],
  },
  strength_score: {
    title: "Signal Strength Score",
    explanation:
      "An internal 0-10 score that ranks the strength of an options flow signal. Combines factors like C/P ratio extremity, streak length, total premium size, OI build, and confluence with external screeners.",
    interpretation: {
      weak: "< 5 (signal ignored)",
      moderate: "5-6",
      strong: "7-8",
      exceptional: "9-10",
    },
    related_terms: ["call_put_ratio", "consecutive_days", "premium"],
  },
  vol_oi_ratio: {
    title: "Volume / Open Interest Ratio",
    explanation:
      "Today's contract volume divided by yesterday's open interest. Measures whether the day's activity is new positioning (vol > OI) or rotation of existing positions (vol <= OI). The foundational metric for 'unusual options activity' — contracts above 1.24 qualify as unusual.",
    interpretation: {
      normal: "< 1.0",
      elevated: "1.0 - 1.5",
      unusual: "1.5 - 3.0",
      extreme: "> 3.0",
      caveat:
        "High vol/OI on a small contract can be retail noise. Always check total premium to confirm.",
    },
    related_terms: ["unusual_options_activity", "open_interest", "volume"],
  },
  premium: {
    title: "Total Premium",
    explanation:
      "The total dollar amount paid for options on a symbol on a given day. Calculated as last_price × volume × 100, summed across all contracts. The sanity check for C/P ratios — prevents excitement about flashy ratios on tiny notional amounts.",
    interpretation: {
      retail: "< $500k",
      notable: "$500k - $5M",
      institutional: "$5M - $50M",
      heavyweight: "> $50M",
    },
    related_terms: ["call_put_ratio", "consecutive_days"],
  },
  golden_cross: {
    title: "Golden Cross Screener",
    explanation:
      "Stocks whose 50-day moving average has recently crossed above the 200-day moving average. Classic bullish medium-term signal. Indicates a change from a longer-term downtrend to uptrend.",
    related_terms: ["death_cross", "moving_average"],
  },
  death_cross: {
    title: "Death Cross Screener",
    explanation:
      "Stocks whose 50-day moving average has recently crossed below the 200-day moving average. The bearish opposite of golden cross — medium-term downtrend signal.",
    related_terms: ["golden_cross", "moving_average"],
  },
  hot_prospects: {
    title: "Hot Prospects Screener",
    explanation:
      "Curated list of stocks with strong momentum and confluence across multiple technical factors — positive price action, above-average volume, and healthy recent trend. Our highest-signal momentum screener.",
    related_terms: ["strong_volume_gains", "trend_seeker"],
  },
};

export const educationTools: Tool[] = [
  {
    name: "explain_concept",
    description:
      "Return a plain-language explanation of a platform-specific term, metric, or screener. Use ONLY for terms that are specific to StockMarketScan (e.g. 'strength_score' which is our internal scoring, or 'hot_prospects' which is our curated screener). Do NOT use for generic finance terms the model already knows — answer those directly. Returns { term, title, explanation, interpretation, related_terms }.",
    inputSchema: z.toJSONSchema(ExplainConceptInputSchema) as Tool["inputSchema"],
  },
];

export async function handleExplainConcept(
  _ctx: McpContext,
  rawArgs: unknown
): Promise<unknown> {
  const args = ExplainConceptInputSchema.parse(rawArgs);
  const key = args.term.toLowerCase().replace(/[^a-z0-9_]/g, "_");
  const entry = GLOSSARY[key];
  if (!entry) {
    throw new McpError(
      `No glossary entry for "${args.term}". Known terms: ${Object.keys(GLOSSARY).join(", ")}`,
      "NOT_FOUND",
      "explain_concept"
    );
  }
  return {
    term: key,
    title: entry.title,
    explanation: entry.explanation,
    interpretation: entry.interpretation || null,
    related_terms: entry.related_terms || [],
  };
}
