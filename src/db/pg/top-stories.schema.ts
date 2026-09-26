import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { projects } from "./app.schema";

// Timestamps are stored as *text* (same column shape as the SQLite schema); see
// the note in pg/app.schema.ts. `isoNow` matches `new Date().toISOString()` so
// DB-defaulted and app-written values sort together lexicographically.
const isoNow = sql`to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

// Postgres mirror of the Top Stories tables. Column notes: see
// ../top-stories.schema.ts.
export const topStoriesSettings = pgTable("top_stories_settings", {
  projectId: text("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  isActive: boolean("is_active").notNull().default(true),
  locationCode: integer("location_code").notNull().default(2364),
  languageCode: text("language_code").notNull().default("fa"),
  device: text("device", { enum: ["mobile", "desktop"] })
    .notNull()
    .default("mobile"),
  snapshotIntervalMinutes: integer("snapshot_interval_minutes")
    .notNull()
    .default(30),
  trackingWindowHours: integer("tracking_window_hours").notNull().default(6),
  maxAutoTopicsPerDay: integer("max_auto_topics_per_day").notNull().default(40),
  trendsImportEnabled: boolean("trends_import_enabled").notNull().default(true),
  trendsGeo: text("trends_geo").notNull().default("IR"),
  gscImportEnabled: boolean("gsc_import_enabled").notNull().default(true),
  lastTrendsImportAt: text("last_trends_import_at"),
  lastTrendsError: text("last_trends_error"),
  lastGscImportAt: text("last_gsc_import_at"),
  lastGscError: text("last_gsc_error"),
  createdAt: text("created_at").notNull().default(isoNow),
  updatedAt: text("updated_at").notNull().default(isoNow),
});

export const topStoriesSites = pgTable(
  "top_stories_sites",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    domain: text("domain").notNull(),
    isOwn: boolean("is_own").notNull().default(false),
    newsSitemapUrl: text("news_sitemap_url"),
    lastFetchedAt: text("last_fetched_at"),
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

export const topStoriesTopics = pgTable(
  "top_stories_topics",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    query: text("query").notNull(),
    normalizedQuery: text("normalized_query").notNull(),
    source: text("source", {
      enum: ["google_trends", "gsc", "manual"],
    }).notNull(),
    trackingEndsAt: text("tracking_ends_at").notNull(),
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
    uniqueIndex("top_stories_topics_active_query_idx")
      .on(table.projectId, table.normalizedQuery)
      .where(sql`${table.nextSnapshotAt} IS NOT NULL`),
  ],
);

export const topStoriesSnapshots = pgTable(
  "top_stories_snapshots",
  {
    id: text("id").primaryKey(),
    topicId: text("topic_id")
      .notNull()
      .references(() => topStoriesTopics.id, { onDelete: "cascade" }),
    checkedAt: text("checked_at").notNull(),
    hasTopStories: boolean("has_top_stories").notNull(),
  },
  (table) => [
    index("top_stories_snapshots_topic_checked_idx").on(
      table.topicId,
      table.checkedAt,
    ),
  ],
);

export const topStoriesResults = pgTable(
  "top_stories_results",
  {
    snapshotId: text("snapshot_id")
      .notNull()
      .references(() => topStoriesSnapshots.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    domain: text("domain").notNull(),
    url: text("url").notNull(),
    title: text("title"),
    sourceName: text("source_name"),
    publishedAt: text("published_at"),
  },
  (table) => [primaryKey({ columns: [table.snapshotId, table.position] })],
);

export const topStoriesArticles = pgTable(
  "top_stories_articles",
  {
    id: text("id").primaryKey(),
    siteId: text("site_id")
      .notNull()
      .references(() => topStoriesSites.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    urlKey: text("url_key").notNull(),
    title: text("title"),
    normalizedTitle: text("normalized_title"),
    publishedAt: text("published_at"),
    publishedAtSource: text("published_at_source", {
      enum: ["sitemap", "page", "serp"],
    }),
    firstSeenInSitemapAt: text("first_seen_in_sitemap_at"),
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

export const topStoriesTopicArticles = pgTable(
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
    matchedBy: text("matched_by", {
      enum: ["carousel", "title", "manual"],
    }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.topicId, table.siteId] })],
);
