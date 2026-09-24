import { z } from "zod";
import { isSupportedLanguageCode } from "@/shared/keyword-locations";
import { TOP_STORIES_LIMITS } from "@/shared/top-stories";
import { domainField } from "@/types/schemas/domain";

// ---------------------------------------------------------------------------
// Report types (server → UI)
// ---------------------------------------------------------------------------

export type TopStoriesTopicSource = "google_trends" | "gsc" | "manual";
export type TopStoriesMatchKind = "carousel" | "title" | "manual";

export interface TopStoriesSiteRef {
  id: string;
  domain: string;
  isOwn: boolean;
}

export interface TopStoriesArticleView {
  id: string;
  url: string;
  title: string | null;
  publishedAt: string | null;
  publishedAtSource: "sitemap" | "page" | "serp" | null;
  firstSeenInSitemapAt: string | null;
  firstCrawledAt: string | null;
  crawlSource: "log" | "gsc" | null;
  matchedBy: TopStoriesMatchKind;
}

export interface TopStoriesTopicSite {
  siteId: string;
  inTopStories: boolean;
  firstSeenAt: string | null;
  bestPosition: number | null;
  article: TopStoriesArticleView | null;
  /** Minutes behind the first tracked publisher (0 = first). */
  publishDelayMinutes: number | null;
  /** Minutes from publication to the first known Googlebot fetch. */
  crawlDelayMinutes: number | null;
  /** Minutes from publication to first appearing in the site's news sitemap. */
  sitemapDelayMinutes: number | null;
  /** Minutes from publication to first being seen in the carousel. */
  carouselDelayMinutes: number | null;
}

/**
 * won: our site was in the carousel. lost: it wasn't but a competitor was.
 * no_carousel: Google showed no Top Stories box. untracked_only: only
 * publishers outside the tracked set appeared.
 */
export type TopStoriesOutcome =
  | "won"
  | "lost"
  | "no_carousel"
  | "untracked_only";

export interface TopStoriesTopicRow {
  id: string;
  query: string;
  source: TopStoriesTopicSource;
  createdAt: string;
  trackingEndsAt: string;
  isTracking: boolean;
  snapshotCount: number;
  carouselSnapshotCount: number;
  lastError: string | null;
  outcome: TopStoriesOutcome;
  /** Earliest publication among tracked sites' articles. */
  eventAt: string | null;
  firstPublisherSiteIds: string[];
  sites: TopStoriesTopicSite[];
}

export interface TopStoriesPresence {
  siteId: string;
  topics: number;
  /** Share of topics that had a Top Stories box; null when none did. */
  share: number | null;
}

export interface TopStoriesOutcomeStats {
  count: number;
  medianPublishDelayMinutes: number | null;
  medianCrawlDelayMinutes: number | null;
}

export interface TopStoriesAnalysis {
  topicCount: number;
  carouselTopicCount: number;
  won: TopStoriesOutcomeStats;
  lost: TopStoriesOutcomeStats;
  /** Likely cause per lost topic; see classifyLoss. */
  lostCauses: {
    slowPublish: number;
    slowCrawl: number;
    other: number;
    noCrawlData: number;
    notCovered: number;
  };
}

export interface TopStoriesReport {
  sites: TopStoriesSiteRef[];
  topics: TopStoriesTopicRow[];
  presence: TopStoriesPresence[];
  analysis: TopStoriesAnalysis;
}

// ---------------------------------------------------------------------------
// Validation schemas (UI → server)
// ---------------------------------------------------------------------------

const projectIdField = z.string().uuid();
const isoDateTimeField = z.string().datetime({ offset: true });
const httpUrlField = z
  .string()
  .trim()
  .max(2048)
  .url()
  .refine((value) => /^https?:\/\//i.test(value), "Use an http(s) URL");

export const topStoriesProjectSchema = z.object({ projectId: projectIdField });

export const topStoriesReportSchema = z.object({
  projectId: projectIdField,
  from: isoDateTimeField,
  to: isoDateTimeField,
});

const { snapshotIntervalMinutes, trackingWindowHours, maxAutoTopicsPerDay } =
  TOP_STORIES_LIMITS;

export const updateTopStoriesSettingsSchema = z.object({
  projectId: projectIdField,
  isActive: z.boolean().optional(),
  locationCode: z.number().int().positive().optional(),
  languageCode: z
    .string()
    .max(10)
    .refine(isSupportedLanguageCode, "Unsupported language code")
    .optional(),
  device: z.enum(["mobile", "desktop"]).optional(),
  snapshotIntervalMinutes: z
    .number()
    .int()
    .min(snapshotIntervalMinutes.min)
    .max(snapshotIntervalMinutes.max)
    .optional(),
  trackingWindowHours: z
    .number()
    .int()
    .min(trackingWindowHours.min)
    .max(trackingWindowHours.max)
    .optional(),
  maxAutoTopicsPerDay: z
    .number()
    .int()
    .min(maxAutoTopicsPerDay.min)
    .max(maxAutoTopicsPerDay.max)
    .optional(),
  trendsImportEnabled: z.boolean().optional(),
  trendsGeo: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{2}$/, "Use a two-letter country code")
    .transform((value) => value.toUpperCase())
    .optional(),
  gscImportEnabled: z.boolean().optional(),
});

export const addTopStoriesSiteSchema = z.object({
  projectId: projectIdField,
  domain: domainField,
  isOwn: z.boolean(),
  newsSitemapUrl: httpUrlField.nullable(),
});

export const updateTopStoriesSiteSchema = z.object({
  projectId: projectIdField,
  siteId: z.string().uuid(),
  isOwn: z.boolean().optional(),
  newsSitemapUrl: httpUrlField.nullable().optional(),
});

export const topStoriesSiteSchema = z.object({
  projectId: projectIdField,
  siteId: z.string().uuid(),
});

export const addTopStoriesTopicsSchema = z.object({
  projectId: projectIdField,
  queries: z
    .array(z.string().trim().min(1).max(TOP_STORIES_LIMITS.maxQueryLength))
    .min(1)
    .max(50),
});

export const topStoriesTopicSchema = z.object({
  projectId: projectIdField,
  topicId: z.string().uuid(),
});

export const setTopStoriesTopicArticleSchema = z.object({
  projectId: projectIdField,
  topicId: z.string().uuid(),
  siteId: z.string().uuid(),
  // Null clears a manual pick and lets automatic matching decide again.
  url: httpUrlField.nullable(),
});

export const importTopStoriesTopicsSchema = z.object({
  projectId: projectIdField,
  source: z.enum(["google_trends", "gsc"]),
});

/** Lines per upload request; the client batches a file into these. */
export const CRAWL_LOG_LINES_PER_REQUEST = 2000;

export const importCrawlLogSchema = z.object({
  projectId: projectIdField,
  lines: z.array(z.string().max(8000)).min(1).max(CRAWL_LOG_LINES_PER_REQUEST),
  verifyGooglebotIps: z.boolean(),
});
