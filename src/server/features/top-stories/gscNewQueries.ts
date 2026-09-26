import { sortBy } from "remeda";
import { createGscClient } from "@/server/lib/gscClient";
import type { GscConnection } from "@/server/features/gsc/repositories/GscConnectionRepository";

// "New" Search Console queries: searches that brought the site impressions in
// the last two days but none in the two weeks before. For a news site these
// are mostly fresh stories. GSC's fresh data lags a few hours, so this source
// catches the slower-burning topics that Google Trends already surfaced.

const RECENT_DAYS = 2;
const BASELINE_DAYS = 14;
const RECENT_ROW_LIMIT = 5000;
// The API maximum. The baseline is ranked by clicks, so a query past this row
// can look new when it isn't; the impressions floor keeps that noise low.
const BASELINE_ROW_LIMIT = 25_000;

/** GSC reports days in Pacific Time. */
function pacificDate(date: Date, daysBack: number): string {
  const shifted = new Date(date.getTime() - daysBack * 24 * 3600_000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
  }).format(shifted);
}

export async function findNewGscQueries(input: {
  connection: GscConnection;
  now: Date;
  minImpressions: number;
  limit: number;
}): Promise<Array<{ query: string; impressions: number }>> {
  const client = createGscClient({
    userId: input.connection.connectedByUserId,
    gscAccountId: input.connection.gscAccountId ?? undefined,
  });
  const siteUrl = input.connection.siteUrl;
  const [recent, baseline] = await Promise.all([
    client.querySearchAnalytics(siteUrl, {
      startDate: pacificDate(input.now, RECENT_DAYS - 1),
      endDate: pacificDate(input.now, 0),
      dimensions: ["query"],
      dataState: "all",
      rowLimit: RECENT_ROW_LIMIT,
    }),
    client.querySearchAnalytics(siteUrl, {
      startDate: pacificDate(input.now, RECENT_DAYS + BASELINE_DAYS - 1),
      endDate: pacificDate(input.now, RECENT_DAYS),
      dimensions: ["query"],
      dataState: "all",
      rowLimit: BASELINE_ROW_LIMIT,
    }),
  ]);

  const seenBefore = new Set(baseline.map((row) => row.keys?.[0]));
  const fresh = recent.flatMap((row) => {
    const query = row.keys?.[0]?.trim();
    return query &&
      !seenBefore.has(row.keys?.[0]) &&
      row.impressions >= input.minImpressions
      ? [{ query, impressions: row.impressions }]
      : [];
  });
  return sortBy(fresh, [(row) => row.impressions, "desc"]).slice(
    0,
    input.limit,
  );
}
