import { XMLParser } from "fast-xml-parser";
import { sortBy } from "remeda";
import { z } from "zod";
import { readBodyCapped } from "@/server/lib/audit/discovery";
import { TOP_STORIES_USER_AGENT } from "@/server/features/top-stories/newsSitemap";
import { toIsoOrNull } from "@/shared/top-stories";

// Google Trends "Trending now" RSS feed: the searches surging in a country
// right now, which is the list of breaking topics worth watching.

const TRENDS_RSS_URL = "https://trends.google.com/trending/rss";
const FETCH_TIMEOUT_MS = 15_000;
const MAX_FEED_BYTES = 2 * 1024 * 1024;

const xmlParser = new XMLParser({
  removeNSPrefix: true,
  parseTagValue: false,
  isArray: (name) => name === "item",
});

const feedSchema = z.object({
  rss: z.object({
    channel: z.object({ item: z.array(z.unknown()).optional() }).passthrough(),
  }),
});

const itemSchema = z
  .object({
    title: z.string(),
    pubDate: z.string().optional(),
    approx_traffic: z.string().optional(),
  })
  .passthrough();

interface TrendingQuery {
  query: string;
  startedAt: string | null;
  /** "2,000+" → 2000; null when the feed omits it. */
  approxTraffic: number | null;
}

function parseTraffic(value: string | undefined): number | null {
  const digits = value?.replace(/[^\d]/g, "");
  return digits ? Number(digits) : null;
}

/** Trending searches for an ISO 3166-1 alpha-2 country, busiest first. */
export async function fetchTrendingQueries(
  geo: string,
): Promise<TrendingQuery[]> {
  const url = `${TRENDS_RSS_URL}?geo=${encodeURIComponent(geo)}`;
  const response = await fetch(url, {
    headers: { "User-Agent": TOP_STORIES_USER_AGENT },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Google Trends returned HTTP ${response.status}`);
  }
  const text = await readBodyCapped(response, MAX_FEED_BYTES);
  if (text === null) throw new Error("Google Trends feed is too large");

  let raw: unknown;
  try {
    raw = xmlParser.parse(text);
  } catch {
    throw new Error("Google Trends returned invalid XML");
  }
  const feed = feedSchema.safeParse(raw);
  if (!feed.success) {
    throw new Error(`No Google Trends feed for "${geo}"`);
  }

  const queries = (feed.data.rss.channel.item ?? []).flatMap((entry) => {
    const item = itemSchema.safeParse(entry);
    const query = item.success ? item.data.title.trim() : "";
    if (!item.success || !query) return [];
    return [
      {
        query,
        startedAt: toIsoOrNull(item.data.pubDate),
        approxTraffic: parseTraffic(item.data.approx_traffic),
      },
    ];
  });
  return sortBy(queries, [(item) => item.approxTraffic ?? 0, "desc"]);
}
