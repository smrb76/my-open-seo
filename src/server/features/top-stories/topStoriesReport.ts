import { sort } from "remeda";
import {
  classifyLoss,
  hostMatchesDomain,
  minutesBetween,
} from "@/shared/top-stories";
import type {
  TopStoriesAnalysis,
  TopStoriesArticleView,
  TopStoriesOutcome,
  TopStoriesOutcomeStats,
  TopStoriesPresence,
  TopStoriesReport,
  TopStoriesSiteRef,
  TopStoriesTopicRow,
  TopStoriesTopicSite,
  TopStoriesTopicSource,
} from "@/types/schemas/top-stories";

// Turns stored topics, carousel appearances and matched articles into the
// daily table and the win/loss analysis. Pure, so every number on the page is
// testable without a database.

interface ReportTopicInput {
  id: string;
  query: string;
  source: TopStoriesTopicSource;
  createdAt: string;
  trackingEndsAt: string;
  nextSnapshotAt: string | null;
  snapshotCount: number;
  lastError: string | null;
}

/** Carousel appearances of one host for one topic, aggregated in SQL. */
export interface ReportAppearanceInput {
  topicId: string;
  domain: string;
  firstSeenAt: string;
  bestPosition: number;
}

export interface ReportLinkInput {
  topicId: string;
  siteId: string;
  article: TopStoriesArticleView;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = sort(values, (a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/** Earliest of a set of ISO timestamps (they compare as strings). */
function earliest(values: string[]): string | null {
  return values.reduce<string | null>(
    (min, value) => (min === null || value < min ? value : min),
    null,
  );
}

function delay(from: string | null, to: string | null): number | null {
  return from && to ? minutesBetween(from, to) : null;
}

function buildTopicRow(input: {
  topic: ReportTopicInput;
  sites: TopStoriesSiteRef[];
  appearances: ReportAppearanceInput[];
  carouselSnapshotCount: number;
  links: ReportLinkInput[];
}): TopStoriesTopicRow {
  const { topic, sites } = input;
  const articles = new Map(
    input.links.map((link) => [link.siteId, link.article]),
  );
  const eventAt = earliest(
    [...articles.values()]
      .map((article) => article.publishedAt)
      .filter((value): value is string => value !== null),
  );

  const siteResults: TopStoriesTopicSite[] = sites.map((site) => {
    const seen = input.appearances.filter((appearance) =>
      hostMatchesDomain(appearance.domain, site.domain),
    );
    const firstSeenAt = earliest(
      seen.map((appearance) => appearance.firstSeenAt),
    );
    const bestPosition =
      seen.length > 0
        ? Math.min(...seen.map((appearance) => appearance.bestPosition))
        : null;
    const article = articles.get(site.id) ?? null;
    const publishedAt = article?.publishedAt ?? null;
    return {
      siteId: site.id,
      inTopStories: seen.length > 0,
      firstSeenAt,
      bestPosition,
      article,
      publishDelayMinutes: delay(eventAt, publishedAt),
      crawlDelayMinutes: delay(publishedAt, article?.firstCrawledAt ?? null),
      sitemapDelayMinutes: delay(
        publishedAt,
        article?.firstSeenInSitemapAt ?? null,
      ),
      carouselDelayMinutes: delay(publishedAt, firstSeenAt),
    };
  });

  const ownSiteId = sites.find((site) => site.isOwn)?.id;
  const inCarousel = (siteId: string | undefined) =>
    siteResults.some(
      (result) => result.siteId === siteId && result.inTopStories,
    );
  const competitorInCarousel = sites.some(
    (site) => !site.isOwn && inCarousel(site.id),
  );
  const outcome: TopStoriesOutcome =
    input.carouselSnapshotCount === 0
      ? "no_carousel"
      : inCarousel(ownSiteId)
        ? "won"
        : competitorInCarousel
          ? "lost"
          : "untracked_only";

  return {
    id: topic.id,
    query: topic.query,
    source: topic.source,
    createdAt: topic.createdAt,
    trackingEndsAt: topic.trackingEndsAt,
    isTracking: topic.nextSnapshotAt !== null,
    snapshotCount: topic.snapshotCount,
    carouselSnapshotCount: input.carouselSnapshotCount,
    lastError: topic.lastError,
    outcome,
    eventAt,
    firstPublisherSiteIds: siteResults
      .filter((result) => result.publishDelayMinutes === 0)
      .map((result) => result.siteId),
    sites: siteResults,
  };
}

function outcomeStats(
  rows: TopStoriesTopicRow[],
  ownSiteId: string | undefined,
): TopStoriesOutcomeStats {
  const own = rows.flatMap((row) =>
    row.sites.filter((site) => site.siteId === ownSiteId),
  );
  return {
    count: rows.length,
    medianPublishDelayMinutes: median(
      own.flatMap((site) =>
        site.publishDelayMinutes === null ? [] : [site.publishDelayMinutes],
      ),
    ),
    medianCrawlDelayMinutes: median(
      own.flatMap((site) =>
        site.crawlDelayMinutes === null ? [] : [site.crawlDelayMinutes],
      ),
    ),
  };
}

export function buildTopStoriesReport(input: {
  sites: TopStoriesSiteRef[];
  topics: ReportTopicInput[];
  appearances: ReportAppearanceInput[];
  carouselSnapshotCounts: Map<string, number>;
  links: ReportLinkInput[];
}): TopStoriesReport {
  const rows = input.topics.map((topic) =>
    buildTopicRow({
      topic,
      sites: input.sites,
      appearances: input.appearances.filter((a) => a.topicId === topic.id),
      carouselSnapshotCount: input.carouselSnapshotCounts.get(topic.id) ?? 0,
      links: input.links.filter((link) => link.topicId === topic.id),
    }),
  );

  const carouselRows = rows.filter((row) => row.outcome !== "no_carousel");
  const presence: TopStoriesPresence[] = input.sites.map((site) => {
    const topics = carouselRows.filter((row) =>
      row.sites.some((s) => s.siteId === site.id && s.inTopStories),
    ).length;
    return {
      siteId: site.id,
      topics,
      share: carouselRows.length > 0 ? topics / carouselRows.length : null,
    };
  });

  const ownSiteId = input.sites.find((site) => site.isOwn)?.id;
  const won = rows.filter((row) => row.outcome === "won");
  const lost = rows.filter((row) => row.outcome === "lost");
  const lostCauses: TopStoriesAnalysis["lostCauses"] = {
    slowPublish: 0,
    slowCrawl: 0,
    other: 0,
    noCrawlData: 0,
    notCovered: 0,
  };
  for (const row of lost) {
    lostCauses[
      classifyLoss(row.sites.find((site) => site.siteId === ownSiteId))
    ]++;
  }

  return {
    sites: input.sites,
    topics: rows,
    presence,
    analysis: {
      topicCount: rows.length,
      carouselTopicCount: carouselRows.length,
      won: outcomeStats(won, ownSiteId),
      lost: outcomeStats(lost, ownSiteId),
      lostCauses,
    },
  };
}
