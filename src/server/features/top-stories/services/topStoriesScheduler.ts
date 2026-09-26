import { groupBy } from "remeda";
import { createDataforseoClient } from "@/server/lib/dataforseo";
import { GscConnectionRepository } from "@/server/features/gsc/repositories/GscConnectionRepository";
import { GscService } from "@/server/features/gsc/services/GscService";
import { fetchNewsSitemap } from "@/server/features/top-stories/newsSitemap";
import { fetchTrendingQueries } from "@/server/features/top-stories/googleTrends";
import { findNewGscQueries } from "@/server/features/top-stories/gscNewQueries";
import {
  TopStoriesRepository,
  type TopStoriesSettings,
  type TopStoriesSite,
} from "@/server/features/top-stories/repositories/TopStoriesRepository";
import {
  createTopics,
  ingestSitemapEntries,
  linkTopicArticles,
  type PageFetchBudget,
} from "@/server/features/top-stories/services/topStoriesIngest";
import {
  computeNextSnapshotAt,
  hostOf,
  toIsoOrNull,
} from "@/shared/top-stories";

// The Top Stories half of the 5-minute cron: poll news sitemaps, import new
// topics, take due SERP snapshots, and check Googlebot crawl times. Every
// stage is capped per tick so one invocation stays inside Worker subrequest
// limits; whatever is left stays due and the next tick picks it up.

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

// Due at 4 minutes so the */5 cron's jitter can't skip a poll.
const SITEMAP_POLL_INTERVAL_MS = 4 * MINUTE_MS;
const MAX_SITEMAPS_PER_TICK = 10;
const MAX_SNAPSHOTS_PER_TICK = 20;
const SNAPSHOT_CONCURRENCY = 5;
const MAX_PAGE_FETCHES_PER_TICK = 5;
const MAX_CRAWL_CHECKS_PER_TICK = 8;
const TRENDS_IMPORT_INTERVAL_MS = HOUR_MS;
const GSC_IMPORT_INTERVAL_MS = 2 * HOUR_MS;
// Auto-imported queries are skipped when the same query was tracked recently;
// Trends keeps a story in its feed for a day or more.
const AUTO_DEDUPE_MS = 48 * HOUR_MS;
const GSC_MIN_IMPRESSIONS = 10;
const GSC_TOPICS_PER_IMPORT = 10;
// Crawl times come from URL Inspection while the article is fresh: once per
// 20 minutes, for articles tied to topics from the last day.
const CRAWL_RECHECK_MS = 20 * MINUTE_MS;
const CRAWL_WINDOW_MS = 24 * HOUR_MS;
const RETENTION_MS = 90 * 24 * HOUR_MS;

type TickSummary = {
  sitemapsFetched: number;
  sitemapErrors: number;
  articlesInserted: number;
  topicsImported: number;
  importErrors: number;
  snapshotsTaken: number;
  snapshotErrors: number;
  crawlChecks: number;
  crawlTimesFound: number;
};

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}

async function pollSitemaps(now: Date, summary: TickSummary) {
  const due = await TopStoriesRepository.getSitesDueForFetch(
    new Date(now.getTime() - SITEMAP_POLL_INTERVAL_MS).toISOString(),
    MAX_SITEMAPS_PER_TICK,
  );
  await Promise.all(
    due.map(async ({ site }) => {
      if (!site.newsSitemapUrl) return;
      const nowIso = now.toISOString();
      try {
        const entries = await fetchNewsSitemap(site.newsSitemapUrl);
        const { inserted } = await ingestSitemapEntries(site, entries, now);
        summary.sitemapsFetched++;
        summary.articlesInserted += inserted;
        await TopStoriesRepository.updateSite(site.id, site.projectId, {
          lastFetchedAt: nowIso,
          lastSuccessAt: nowIso,
          lastFetchError: null,
        });
      } catch (error) {
        summary.sitemapErrors++;
        await TopStoriesRepository.updateSite(site.id, site.projectId, {
          lastFetchedAt: nowIso,
          lastFetchError: errorMessage(error),
        });
      }
    }),
  );
}

function isDue(lastRunAt: string | null, intervalMs: number, now: Date) {
  return (
    lastRunAt === null || now.getTime() - Date.parse(lastRunAt) >= intervalMs
  );
}

/** Topics the automatic sources may still add under the rolling daily cap. */
async function remainingAutoTopics(settings: TopStoriesSettings, now: Date) {
  const used = await TopStoriesRepository.countAutoTopicsSince(
    settings.projectId,
    new Date(now.getTime() - 24 * HOUR_MS).toISOString(),
  );
  return Math.max(0, settings.maxAutoTopicsPerDay - used);
}

export async function importTrendsTopics(
  settings: TopStoriesSettings,
  now: Date,
): Promise<number> {
  const trending = await fetchTrendingQueries(settings.trendsGeo);
  const since = now.getTime() - 24 * HOUR_MS;
  const fresh = trending.filter(
    (item) => item.startedAt === null || Date.parse(item.startedAt) >= since,
  );
  const remaining = await remainingAutoTopics(settings, now);
  return createTopics({
    projectId: settings.projectId,
    queries: fresh.slice(0, remaining).map((item) => item.query),
    source: "google_trends",
    settings,
    dedupeSince: new Date(now.getTime() - AUTO_DEDUPE_MS).toISOString(),
    now,
  });
}

export async function importGscTopics(
  settings: TopStoriesSettings,
  now: Date,
): Promise<number> {
  const connection = await GscConnectionRepository.getByProjectId(
    settings.projectId,
  );
  if (!connection) {
    throw new Error("Search Console isn't connected for this project.");
  }
  const remaining = await remainingAutoTopics(settings, now);
  if (remaining === 0) return 0;
  const queries = await findNewGscQueries({
    connection,
    now,
    minImpressions: GSC_MIN_IMPRESSIONS,
    limit: Math.min(GSC_TOPICS_PER_IMPORT, remaining),
  });
  return createTopics({
    projectId: settings.projectId,
    queries: queries.map((row) => row.query),
    source: "gsc",
    settings,
    dedupeSince: new Date(now.getTime() - AUTO_DEDUPE_MS).toISOString(),
    now,
  });
}

async function runImports(now: Date, summary: TickSummary) {
  const active = await TopStoriesRepository.getActiveProjects();
  for (const { settings } of active) {
    const nowIso = now.toISOString();
    if (
      settings.trendsImportEnabled &&
      isDue(settings.lastTrendsImportAt, TRENDS_IMPORT_INTERVAL_MS, now)
    ) {
      try {
        summary.topicsImported += await importTrendsTopics(settings, now);
        await TopStoriesRepository.upsertSettings(settings.projectId, {
          lastTrendsImportAt: nowIso,
          lastTrendsError: null,
        });
      } catch (error) {
        summary.importErrors++;
        await TopStoriesRepository.upsertSettings(settings.projectId, {
          lastTrendsImportAt: nowIso,
          lastTrendsError: errorMessage(error),
        });
      }
    }
    if (
      settings.gscImportEnabled &&
      isDue(settings.lastGscImportAt, GSC_IMPORT_INTERVAL_MS, now)
    ) {
      try {
        summary.topicsImported += await importGscTopics(settings, now);
        await TopStoriesRepository.upsertSettings(settings.projectId, {
          lastGscImportAt: nowIso,
          lastGscError: null,
        });
      } catch (error) {
        summary.importErrors++;
        await TopStoriesRepository.upsertSettings(settings.projectId, {
          lastGscImportAt: nowIso,
          lastGscError: errorMessage(error),
        });
      }
    }
  }
}

type DueTopic = Awaited<
  ReturnType<typeof TopStoriesRepository.getDueTopics>
>[number];

async function snapshotTopic(
  due: DueTopic,
  sitesByProject: Map<string, TopStoriesSite[]>,
  budget: PageFetchBudget,
  now: Date,
  summary: TickSummary,
) {
  const { topic, settings } = due;
  if (!topic.nextSnapshotAt) return;
  // A window that closed while the project was paused just ends, unchecked.
  const windowClosed = Date.parse(topic.trackingEndsAt) < now.getTime();
  // Claim the slot before paying for the SERP, so overlapping ticks can't
  // snapshot (and bill) the same slot twice. A failed call still spends the
  // slot: the next one is only an interval away, and a broken API key must
  // not turn into a retry loop.
  const claimed = await TopStoriesRepository.claimTopicSnapshot({
    topicId: topic.id,
    observedNextSnapshotAt: topic.nextSnapshotAt,
    nextSnapshotAt: windowClosed
      ? null
      : computeNextSnapshotAt({
          dueAt: topic.nextSnapshotAt,
          intervalMinutes: settings.snapshotIntervalMinutes,
          trackingEndsAt: topic.trackingEndsAt,
          now,
        }),
  });
  if (!claimed || windowClosed) return;

  const client = createDataforseoClient({
    userId: "system",
    userEmail: "system@openseo.so",
    organizationId: due.organizationId,
    projectId: topic.projectId,
  });
  let serp;
  try {
    serp = await client.serp.topStories({
      keyword: topic.query,
      locationCode: settings.locationCode,
      languageCode: settings.languageCode,
      device: settings.device,
    });
  } catch (error) {
    summary.snapshotErrors++;
    await TopStoriesRepository.recordTopicError(topic.id, errorMessage(error));
    return;
  }

  const cards = serp.cards.flatMap((card) => {
    const domain = hostOf(card.url);
    return domain ? [{ ...card, domain }] : [];
  });
  await TopStoriesRepository.insertSnapshot({
    topicId: topic.id,
    checkedAt: serp.checkedAt ?? now.toISOString(),
    results: cards.map((card) => ({
      position: card.position,
      domain: card.domain,
      url: card.url,
      title: card.title,
      sourceName: card.sourceName,
      publishedAt: card.publishedAt,
    })),
  });
  summary.snapshotsTaken++;

  let sites = sitesByProject.get(topic.projectId);
  if (!sites) {
    sites = await TopStoriesRepository.listSites(topic.projectId);
    sitesByProject.set(topic.projectId, sites);
  }
  await linkTopicArticles({ topic, sites, cards, budget });
}

async function takeSnapshots(now: Date, summary: TickSummary) {
  const due = await TopStoriesRepository.getDueTopics(
    now.toISOString(),
    MAX_SNAPSHOTS_PER_TICK,
  );
  const sitesByProject = new Map<string, TopStoriesSite[]>();
  const budget: PageFetchBudget = { remaining: MAX_PAGE_FETCHES_PER_TICK };
  for (let i = 0; i < due.length; i += SNAPSHOT_CONCURRENCY) {
    await Promise.all(
      due.slice(i, i + SNAPSHOT_CONCURRENCY).map(async (topic) => {
        try {
          await snapshotTopic(topic, sitesByProject, budget, now, summary);
        } catch (error) {
          summary.snapshotErrors++;
          console.error(
            `[top-stories] Snapshot failed for topic ${topic.topic.id}:`,
            error,
          );
        }
      }),
    );
  }
}

async function checkCrawlTimes(now: Date, summary: TickSummary) {
  const due = await TopStoriesRepository.getArticlesDueForCrawlCheck({
    topicsSince: new Date(now.getTime() - CRAWL_WINDOW_MS).toISOString(),
    checkedBefore: new Date(now.getTime() - CRAWL_RECHECK_MS).toISOString(),
    limit: MAX_CRAWL_CHECKS_PER_TICK,
  });
  const byProject = groupBy(due, (row) => row.projectId);
  const nowIso = now.toISOString();

  for (const [projectId, rows] of Object.entries(byProject)) {
    const articles = rows.map((row) => row.article);
    let results: Awaited<ReturnType<typeof GscService.inspectUrls>>["results"];
    try {
      ({ results } = await GscService.inspectUrls({
        projectId,
        urls: articles.map((article) => article.url),
      }));
    } catch {
      // Not connected or the grant lapsed: back off until the next window.
      results = [];
    }
    for (const article of articles) {
      summary.crawlChecks++;
      const inspection = results.find((result) => result.url === article.url);
      const lastCrawl = toIsoOrNull(
        inspection?.result?.indexStatusResult?.lastCrawlTime,
      );
      if (lastCrawl) summary.crawlTimesFound++;
      await TopStoriesRepository.updateArticle(article.id, {
        crawlCheckedAt: nowIso,
        // The first crawl time we observe is the best estimate of the first
        // crawl: later inspections only ever report later recrawls.
        ...(lastCrawl && { firstCrawledAt: lastCrawl, crawlSource: "gsc" }),
      });
    }
  }
}

/** Cron body: one Top Stories tick. Stages fail independently. */
export async function runTopStoriesTick(): Promise<void> {
  const now = new Date();
  const summary: TickSummary = {
    sitemapsFetched: 0,
    sitemapErrors: 0,
    articlesInserted: 0,
    topicsImported: 0,
    importErrors: 0,
    snapshotsTaken: 0,
    snapshotErrors: 0,
    crawlChecks: 0,
    crawlTimesFound: 0,
  };
  const stages: Array<[string, () => Promise<void>]> = [
    ["sitemaps", () => pollSitemaps(now, summary)],
    ["imports", () => runImports(now, summary)],
    ["snapshots", () => takeSnapshots(now, summary)],
    ["crawl", () => checkCrawlTimes(now, summary)],
  ];
  let failedStages = 0;
  for (const [name, run] of stages) {
    try {
      await run();
    } catch (error) {
      failedStages++;
      console.error(`[top-stories] ${name} stage failed:`, error);
    }
  }
  const log = failedStages > 0 ? console.error : console.log;
  log({ event: "top_stories_tick_summary", failedStages, ...summary });
}

/** Daily cron body: drop topics and articles past the retention window. */
export async function pruneTopStories(): Promise<void> {
  await TopStoriesRepository.pruneBefore(
    new Date(Date.now() - RETENTION_MS).toISOString(),
  );
}
