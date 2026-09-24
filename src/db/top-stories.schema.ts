import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { projects } from "./app.schema";

// ============================================================================
// Top Stories tracking: who wins Google's Top Stories carousel for breaking
// news topics, how fast each publisher shipped the story, and how fast
// Googlebot reached ours. See specs/0015-top-stories-tracking.md.
//
// Timestamps are ISO strings (app-written or the ISO default below) so they
// compare lexicographically on both backends.
// ============================================================================

const isoNow = sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;

// One row per project that has opted in. Defaults target Google Iran in
// Persian on mobile, the market this feature was built for.
export const topStoriesSettings = sqliteTable("top_stories_settings", {
  projectId: text("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  // Master switch: the scheduler skips inactive projects entirely.
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  locationCode: integer("location_code").notNull().default(2364),
  languageCode: text("language_code").notNull().default("fa"),
  device: text("device", { enum: ["mobile", "desktop"] })
    .notNull()
    .default("mobile"),
  snapshotIntervalMinutes: integer("snapshot_interval_minutes")
    .notNull()
    .default(30),
  trackingWindowHours: integer("tracking_window_hours").notNull().default(6),
  // Cap on topics the automatic sources may add in any rolling 24 hours; the
  // lever on SERP spend. Manual topics are not counted against it.
  maxAutoTopicsPerDay: integer("max_auto_topics_per_day").notNull().default(40),
  trendsImportEnabled: integer("trends_import_enabled", { mode: "boolean" })
    .notNull()
    .default(true),
  // ISO 3166-1 alpha-2 code for the Google Trends "Trending now" feed.
  trendsGeo: text("trends_geo").notNull().default("IR"),
  gscImportEnabled: integer("gsc_import_enabled", { mode: "boolean" })
    .notNull()
    .default(true),
  lastTrendsImportAt: text("last_trends_import_at"),
  lastTrendsError: text("last_trends_error"),
  lastGscImportAt: text("last_gsc_import_at"),
  lastGscError: text("last_gsc_error"),
  createdAt: text("created_at").notNull().default(isoNow),
  updatedAt: text("updated_at").notNull().default(isoNow),
});

// The publishers in the race: the project's own site plus competitors. Each
// news sitemap is polled on the 5-minute cron for exact publication times.
export const topStoriesSites = sqliteTable(
  "top_stories_sites",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    // Normalized bare host (lowercase, no protocol/www). Carousel cards from
    // subdomains of this host count for the site.
    domain: text("domain").notNull(),
    isOwn: integer("is_own", { mode: "boolean" }).notNull().default(false),
    newsSitemapUrl: text("news_sitemap_url"),
    lastFetchedAt: text("last_fetched_at"),
    // Last fetch that parsed. "First seen in sitemap" times are only recorded
    // while polling is continuous, so a first fetch (or one after an outage)
    // doesn't stamp a backlog of old articles as just published.
    lastSuccessAt: text("last_success_at"),
    lastFetchError: text("last_fetch_error"),
    createdAt: text("created_at").notNull().default(isoNow),
  },
  (table) => [
    uniqueIndex("top_stories_sites_project_domain_idx").on(
      table.projectId,
      table.domain,
    ),
  ],
);

// A hot news query tracked for a fixed window after it is added.
export const topStoriesTopics = sqliteTable(
  "top_stories_topics",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    // Sent to Google verbatim.
    query: text("query").notNull(),
    // Persian letter variants, ZWNJ and case folded (normalizePersianText);
    // the de-duplication key across sources.
    normalizedQuery: text("normalized_query").notNull(),
    source: text("source", {
      enum: ["google_trends", "gsc", "manual"],
    }).notNull(),
    trackingEndsAt: text("tracking_ends_at").notNull(),
    // Due time of the next SERP snapshot; null once tracking has finished.
    nextSnapshotAt: text("next_snapshot_at"),
    snapshotCount: integer("snapshot_count").notNull().default(0),
    lastError: text("last_error"),
    createdAt: text("created_at").notNull().default(isoNow),
  },
  (table) => [
    index("top_stories_topics_project_created_idx").on(
      table.projectId,
      table.createdAt,
    ),
    index("top_stories_topics_next_snapshot_idx").on(table.nextSnapshotAt),
    // One actively tracked topic per query and project.
    uniqueIndex("top_stories_topics_active_query_idx")
      .on(table.projectId, table.normalizedQuery)
      .where(sql`${table.nextSnapshotAt} IS NOT NULL`),
  ],
);

// One SERP capture of a topic.
export const topStoriesSnapshots = sqliteTable(
  "top_stories_snapshots",
  {
    id: text("id").primaryKey(),
    topicId: text("topic_id")
      .notNull()
      .references(() => topStoriesTopics.id, { onDelete: "cascade" }),
    checkedAt: text("checked_at").notNull(),
    // False when Google showed no Top Stories box for the query.
    hasTopStories: integer("has_top_stories", { mode: "boolean" }).notNull(),
  },
  (table) => [
    index("top_stories_snapshots_topic_checked_idx").on(
      table.topicId,
      table.checkedAt,
    ),
  ],
);

// One carousel card of a snapshot, from any publisher (tracked or not).
export const topStoriesResults = sqliteTable(
  "top_stories_results",
  {
    snapshotId: text("snapshot_id")
      .notNull()
      .references(() => topStoriesSnapshots.id, { onDelete: "cascade" }),
    // 1-based card order across the snapshot's Top Stories boxes.
    position: integer("position").notNull(),
    // Normalized bare host, like top_stories_sites.domain.
    domain: text("domain").notNull(),
    url: text("url").notNull(),
    title: text("title"),
    sourceName: text("source_name"),
    // Google's displayed publication time as DataForSEO resolves it. Coarse
    // for older cards ("3 hours ago"), so tracked sites prefer sitemap times.
    publishedAt: text("published_at"),
  },
  (table) => [primaryKey({ columns: [table.snapshotId, table.position] })],
);

// Articles of tracked sites: every news sitemap entry, plus carousel articles
// the sitemap didn't list.
export const topStoriesArticles = sqliteTable(
  "top_stories_articles",
  {
    id: text("id").primaryKey(),
    siteId: text("site_id")
      .notNull()
      .references(() => topStoriesSites.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    // normalizeArticleUrl(url): the join key for carousel and access-log URLs.
    urlKey: text("url_key").notNull(),
    title: text("title"),
    normalizedTitle: text("normalized_title"),
    publishedAt: text("published_at"),
    // Where publishedAt came from, most to least exact: the news sitemap's
    // publication_date, the page's datePublished, or the carousel card.
    publishedAtSource: text("published_at_source", {
      enum: ["sitemap", "page", "serp"],
    }),
    firstSeenInSitemapAt: text("first_seen_in_sitemap_at"),
    // Earliest known Googlebot fetch: the minimum of access-log hits and the
    // URL Inspection lastCrawlTime observed while the article was tracked.
    firstCrawledAt: text("first_crawled_at"),
    crawlSource: text("crawl_source", { enum: ["log", "gsc"] }),
    crawlCheckedAt: text("crawl_checked_at"),
    createdAt: text("created_at").notNull().default(isoNow),
  },
  (table) => [
    uniqueIndex("top_stories_articles_site_url_idx").on(
      table.siteId,
      table.urlKey,
    ),
    index("top_stories_articles_site_published_idx").on(
      table.siteId,
      table.publishedAt,
    ),
  ],
);

// Which article each tracked site ran for a topic. `siteId` repeats the
// article's site so the key can enforce one article per site per topic.
export const topStoriesTopicArticles = sqliteTable(
  "top_stories_topic_articles",
  {
    topicId: text("topic_id")
      .notNull()
      .references(() => topStoriesTopics.id, { onDelete: "cascade" }),
    siteId: text("site_id")
      .notNull()
      .references(() => topStoriesSites.id, { onDelete: "cascade" }),
    articleId: text("article_id")
      .notNull()
      .references(() => topStoriesArticles.id, { onDelete: "cascade" }),
    // carousel: Google showed it for the topic. title: its sitemap title
    // matched the query. manual: a user picked it and automation keeps off.
    matchedBy: text("matched_by", {
      enum: ["carousel", "title", "manual"],
    }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.topicId, table.siteId] })],
);
