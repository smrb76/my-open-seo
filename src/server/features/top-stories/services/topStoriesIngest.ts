import {
  TopStoriesRepository,
  type TopStoriesArticle,
  type TopStoriesSettings,
  type TopStoriesSite,
  type TopStoriesTopic,
} from "@/server/features/top-stories/repositories/TopStoriesRepository";
import { fetchArticlePageMeta } from "@/server/features/top-stories/articlePage";
import type { NewsSitemapEntry } from "@/server/features/top-stories/newsSitemap";
import {
  hostMatchesDomain,
  longestQueryToken,
  normalizeArticleUrl,
  normalizePersianText,
  titleMatchesQuery,
} from "@/shared/top-stories";

// Writes shared by the cron tick and user actions: storing sitemap articles,
// creating topics, and deciding which article each site ran for a topic.

const HOUR_MS = 3600_000;
// "First seen in sitemap" is only meaningful when the previous poll was
// recent; otherwise a backlog would be stamped as freshly published.
const CONTINUOUS_POLL_MS = 20 * 60_000;
// News sitemaps list the last ~2 days, so a week of stored keys covers them.
const RECENT_ARTICLE_MS = 7 * 24 * HOUR_MS;
// Title matching looks this far before the earliest carousel story (or, with
// no carousel yet, before the topic was added) for each site's first article.
const MATCH_LOOKBACK_FROM_CAROUSEL_MS = 3 * HOUR_MS;
const MATCH_LOOKBACK_FROM_TOPIC_MS = 24 * HOUR_MS;

export async function ingestSitemapEntries(
  site: TopStoriesSite,
  entries: NewsSitemapEntry[],
  now: Date,
): Promise<{ inserted: number; updated: number }> {
  const nowIso = now.toISOString();
  const continuous =
    site.lastSuccessAt !== null &&
    now.getTime() - Date.parse(site.lastSuccessAt) <= CONTINUOUS_POLL_MS;
  const existing = await TopStoriesRepository.getRecentArticlesByKey(
    site.id,
    new Date(now.getTime() - RECENT_ARTICLE_MS).toISOString(),
  );

  const seen = new Set<string>();
  const toInsert: Parameters<typeof TopStoriesRepository.insertArticles>[0] =
    [];
  let updated = 0;
  for (const entry of entries) {
    const urlKey = normalizeArticleUrl(entry.url);
    if (!urlKey || seen.has(urlKey)) continue;
    seen.add(urlKey);
    const fields = {
      title: entry.title,
      normalizedTitle: entry.title ? normalizePersianText(entry.title) : null,
      publishedAt: entry.publishedAt,
      publishedAtSource: entry.publishedAt ? ("sitemap" as const) : null,
      firstSeenInSitemapAt: continuous ? nowIso : null,
    };
    const current = existing.get(urlKey);
    if (!current) {
      toInsert.push({
        id: crypto.randomUUID(),
        siteId: site.id,
        url: entry.url,
        urlKey,
        ...fields,
      });
    } else if (current.publishedAtSource !== "sitemap" && entry.publishedAt) {
      // Found earlier on a carousel card or page; the sitemap time is exact.
      await TopStoriesRepository.updateArticle(current.id, fields);
      updated++;
    }
  }
  await TopStoriesRepository.insertArticles(toInsert);
  return { inserted: toInsert.length, updated };
}

/** Add topics, skipping queries already tracked since `dedupeSince`. */
export async function createTopics(input: {
  projectId: string;
  queries: string[];
  source: TopStoriesTopic["source"];
  settings: Pick<TopStoriesSettings, "trackingWindowHours">;
  dedupeSince: string;
  now: Date;
}): Promise<number> {
  const known = await TopStoriesRepository.getTopicKeysSince(
    input.projectId,
    input.dedupeSince,
  );
  const nowIso = input.now.toISOString();
  const trackingEndsAt = new Date(
    input.now.getTime() + input.settings.trackingWindowHours * HOUR_MS,
  ).toISOString();
  const rows = [];
  for (const raw of input.queries) {
    const query = raw.trim();
    const normalizedQuery = normalizePersianText(query);
    if (!normalizedQuery || known.has(normalizedQuery)) continue;
    known.add(normalizedQuery);
    rows.push({
      id: crypto.randomUUID(),
      projectId: input.projectId,
      query,
      normalizedQuery,
      source: input.source,
      trackingEndsAt,
      nextSnapshotAt: nowIso,
      createdAt: nowIso,
    });
  }
  return TopStoriesRepository.insertTopics(rows);
}

/** Budget for article page fetches within one tick or request. */
export type PageFetchBudget = { remaining: number };

/**
 * The stored article for a URL of a tracked site, creating it from the carousel
 * card (and, budget permitting, the page's own datePublished) when no sitemap
 * listed it.
 */
export async function ensureArticle(input: {
  site: TopStoriesSite;
  url: string;
  title: string | null;
  publishedAt: string | null;
  budget: PageFetchBudget;
}): Promise<TopStoriesArticle | null> {
  const urlKey = normalizeArticleUrl(input.url);
  if (!urlKey) return null;
  const existing = await TopStoriesRepository.findArticleByKey(
    input.site.id,
    urlKey,
  );
  if (existing) return existing;

  let title = input.title;
  let publishedAt = input.publishedAt;
  let publishedAtSource: TopStoriesArticle["publishedAtSource"] = publishedAt
    ? "serp"
    : null;
  if (input.budget.remaining > 0) {
    input.budget.remaining--;
    try {
      const meta = await fetchArticlePageMeta(input.url);
      if (meta.publishedAt) {
        publishedAt = meta.publishedAt;
        publishedAtSource = "page";
      }
      title ??= meta.title;
    } catch (error) {
      console.warn(`[top-stories] Page fetch failed for ${input.url}:`, error);
    }
  }

  await TopStoriesRepository.insertArticles([
    {
      id: crypto.randomUUID(),
      siteId: input.site.id,
      url: input.url,
      urlKey,
      title,
      normalizedTitle: title ? normalizePersianText(title) : null,
      publishedAt,
      publishedAtSource,
    },
  ]);
  // Re-read rather than trusting our id: a concurrent insert may have won.
  return TopStoriesRepository.findArticleByKey(input.site.id, urlKey);
}

/**
 * Decide which article each tracked site ran for a topic. A carousel card is
 * authoritative and replaces a title match; a manual pick is never touched.
 * Sites still unmatched get their earliest article whose title covers the
 * query.
 */
export async function linkTopicArticles(input: {
  topic: TopStoriesTopic;
  sites: TopStoriesSite[];
  cards: Array<{
    domain: string;
    url: string;
    title: string | null;
    publishedAt: string | null;
  }>;
  budget: PageFetchBudget;
}): Promise<void> {
  const { topic } = input;
  const links = new Map(
    (await TopStoriesRepository.getTopicLinks(topic.id)).map((link) => [
      link.siteId,
      link.matchedBy,
    ]),
  );

  for (const site of input.sites) {
    const current = links.get(site.id);
    if (current === "manual" || current === "carousel") continue;
    const card = input.cards.find((c) =>
      hostMatchesDomain(c.domain, site.domain),
    );
    if (!card) continue;
    const article = await ensureArticle({
      site,
      ...card,
      budget: input.budget,
    });
    if (!article) continue;
    await TopStoriesRepository.setTopicLink({
      topicId: topic.id,
      siteId: site.id,
      articleId: article.id,
      matchedBy: "carousel",
    });
    links.set(site.id, "carousel");
  }

  const unmatched = input.sites.filter((site) => !links.has(site.id));
  const token = longestQueryToken(topic.normalizedQuery);
  if (unmatched.length === 0 || !token) return;

  const anchor = await TopStoriesRepository.getEarliestCardPublishedAt(
    topic.id,
  );
  const from = anchor
    ? Date.parse(anchor) - MATCH_LOOKBACK_FROM_CAROUSEL_MS
    : Date.parse(topic.createdAt) - MATCH_LOOKBACK_FROM_TOPIC_MS;
  const candidates = await TopStoriesRepository.findTitleCandidates({
    siteIds: unmatched.map((site) => site.id),
    from: new Date(from).toISOString(),
    to: topic.trackingEndsAt,
    token,
  });
  for (const site of unmatched) {
    // Candidates come oldest first, so this is the site's first coverage.
    const match = candidates.find(
      (candidate) =>
        candidate.siteId === site.id &&
        candidate.normalizedTitle !== null &&
        titleMatchesQuery(topic.normalizedQuery, candidate.normalizedTitle),
    );
    if (!match) continue;
    await TopStoriesRepository.setTopicLink({
      topicId: topic.id,
      siteId: site.id,
      articleId: match.id,
      matchedBy: "title",
    });
  }
}
