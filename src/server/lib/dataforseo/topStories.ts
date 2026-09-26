import { z } from "zod";
import { dataforseoPost } from "@/server/lib/dataforseo/core";
import {
  assertOk,
  buildTaskBilling,
  parseTaskItems,
  type DataforseoApiResponse,
} from "@/server/lib/dataforseo/envelope";

// Top Stories snapshots from the Google organic SERP. One page (depth 10) is
// enough: the carousel only renders on page one. Items are validated loosely
// and only `top_stories` entries are read strictly, so an unrelated SERP
// feature changing shape can't fail a snapshot.

const serpItemTypeSchema = z.object({ type: z.string() }).passthrough();
type SerpItemLike = z.infer<typeof serpItemTypeSchema>;

const topStoriesItemSchema = z.object({
  type: z.literal("top_stories"),
  items: z
    .array(
      z
        .object({
          source: z.string().nullable().optional(),
          domain: z.string().nullable().optional(),
          title: z.string().nullable().optional(),
          url: z.string().nullable().optional(),
          timestamp: z.string().nullable().optional(),
        })
        .passthrough(),
    )
    .nullable()
    .optional(),
});

interface TopStoriesCard {
  /** 1-based order across all Top Stories boxes on the page. */
  position: number;
  url: string;
  title: string | null;
  sourceName: string | null;
  /** ISO time Google displayed for the story, as DataForSEO resolved it. */
  publishedAt: string | null;
}

interface TopStoriesSerp {
  /** ISO time DataForSEO crawled the SERP; null if it wasn't reported. */
  checkedAt: string | null;
  cards: TopStoriesCard[];
}

/** DataForSEO timestamps look like "2024-06-17 19:40:50 +00:00". */
function parseDataforseoDateTime(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  const iso = value.replace(
    /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-]\d{2}:\d{2})$/,
    "$1T$2$3",
  );
  const time = Date.parse(iso);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

function extractTopStoriesCards(items: SerpItemLike[]): TopStoriesCard[] {
  const cards: TopStoriesCard[] = [];
  for (const item of items) {
    if (item.type !== "top_stories") continue;
    const parsed = topStoriesItemSchema.safeParse(item);
    if (!parsed.success) {
      console.warn(
        "dataforseo.top-stories.invalid-item",
        parsed.error.issues.slice(0, 3),
      );
      continue;
    }
    for (const card of parsed.data.items ?? []) {
      if (!card.url) continue;
      cards.push({
        position: cards.length + 1,
        url: card.url,
        title: card.title ?? null,
        sourceName: card.source ?? null,
        publishedAt: parseDataforseoDateTime(card.timestamp),
      });
    }
  }
  return cards;
}

export async function fetchTopStoriesSerp(input: {
  keyword: string;
  locationCode: number;
  languageCode: string;
  device: "desktop" | "mobile";
}): Promise<DataforseoApiResponse<TopStoriesSerp>> {
  const response = await dataforseoPost(
    "/v3/serp/google/organic/live/advanced",
    [
      {
        keyword: input.keyword,
        location_code: input.locationCode,
        language_code: input.languageCode,
        device: input.device,
        os: input.device === "desktop" ? "windows" : "android",
        depth: 10,
      },
    ],
  );
  const task = assertOk(response, { treatNoResultsAsEmpty: true });
  const items = parseTaskItems(
    "google-organic-live-advanced",
    task,
    serpItemTypeSchema,
  );
  const first = task.result?.[0];
  const datetime =
    first && typeof first === "object" && "datetime" in first
      ? first.datetime
      : null;
  return {
    data: {
      checkedAt: parseDataforseoDateTime(
        typeof datetime === "string" ? datetime : null,
      ),
      cards: extractTopStoriesCards(items),
    },
    billing: buildTaskBilling(task),
  };
}
