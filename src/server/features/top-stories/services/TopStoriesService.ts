import { AppError } from "@/server/lib/errors";
import { parseRobotsTxt, readBodyCapped } from "@/server/lib/audit/discovery";
import { normalizeAndValidateStartUrl } from "@/server/lib/audit/url-policy";
import { fetchPublicUrl } from "@/server/features/top-stories/publicFetch";
import { GscConnectionRepository } from "@/server/features/gsc/repositories/GscConnectionRepository";
import {
  TopStoriesRepository,
  type TopStoriesSettings,
} from "@/server/features/top-stories/repositories/TopStoriesRepository";
import { getReportTopicData } from "@/server/features/top-stories/repositories/topStoriesReportQueries";
import {
  fetchNewsSitemap,
  TOP_STORIES_USER_AGENT,
} from "@/server/features/top-stories/newsSitemap";
import { importCrawlLog } from "@/server/features/top-stories/services/importCrawlLog";
import {
  createTopics,
  ensureArticle,
  ingestSitemapEntries,
  linkTopicArticles,
} from "@/server/features/top-stories/services/topStoriesIngest";
import {
  importGscTopics,
  importTrendsTopics,
} from "@/server/features/top-stories/services/topStoriesScheduler";
import { buildTopStoriesReport } from "@/server/features/top-stories/topStoriesReport";
import {
  hostMatchesDomain,
  hostOf,
  TOP_STORIES_LIMITS,
} from "@/shared/top-stories";
import type { TopStoriesReport } from "@/types/schemas/top-stories";

type SettingsPatch = Partial<
  Pick<
    TopStoriesSettings,
    | "isActive"
    | "locationCode"
    | "languageCode"
    | "device"
    | "snapshotIntervalMinutes"
    | "trackingWindowHours"
    | "maxAutoTopicsPerDay"
    | "trendsImportEnabled"
    | "trendsGeo"
    | "gscImportEnabled"
  >
>;

async function requireSettings(projectId: string) {
  const settings = await TopStoriesRepository.getSettings(projectId);
  if (!settings) {
    throw new AppError(
      "VALIDATION_ERROR",
      "Turn on Top Stories tracking for this project first.",
    );
  }
  return settings;
}

async function requireSite(projectId: string, siteId: string) {
  const site = await TopStoriesRepository.getSite(siteId, projectId);
  if (!site) throw new AppError("NOT_FOUND", "Site not found");
  return site;
}

async function requireTopic(projectId: string, topicId: string) {
  const topic = await TopStoriesRepository.getTopic(topicId, projectId);
  if (!topic) throw new AppError("NOT_FOUND", "Topic not found");
  return topic;
}

async function getOverview(projectId: string) {
  const [settings, sites, activeTopics, gscConnection] = await Promise.all([
    TopStoriesRepository.getSettings(projectId),
    TopStoriesRepository.listSites(projectId),
    TopStoriesRepository.listActiveTopics(projectId),
    GscConnectionRepository.getByProjectId(projectId),
  ]);
  return {
    settings,
    sites,
    activeTopics,
    gscConnected: gscConnection !== null,
  };
}

/** Opt a project in. Nothing runs on the schedule until this is called. */
async function enable(input: {
  projectId: string;
  ownDomain: string | null;
}): Promise<void> {
  await TopStoriesRepository.upsertSettings(input.projectId, {
    isActive: true,
  });
  if (input.ownDomain) {
    const sites = await TopStoriesRepository.listSites(input.projectId);
    if (!sites.some((site) => site.isOwn)) {
      // A convenience: if the project's domain can't be added (blocked or
      // unreachable), tracking is still on and the site can be added by hand.
      try {
        await addSite({
          projectId: input.projectId,
          domain: input.ownDomain,
          isOwn: true,
          newsSitemapUrl: null,
        });
      } catch (error) {
        console.warn(
          "[top-stories] Could not add the project's own site:",
          error,
        );
      }
    }
  }
}

async function updateSettings(
  projectId: string,
  patch: SettingsPatch,
): Promise<void> {
  await requireSettings(projectId);
  await TopStoriesRepository.upsertSettings(projectId, patch);
}

/** The news sitemap a site's robots.txt advertises, if any. */
async function discoverNewsSitemap(domain: string): Promise<string | null> {
  const origin = new URL(
    await normalizeAndValidateStartUrl(`https://${domain}`),
  ).origin;
  try {
    const response = await fetchPublicUrl(`${origin}/robots.txt`, {
      headers: { "User-Agent": TOP_STORIES_USER_AGENT },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    const text = await readBodyCapped(response, 500 * 1024);
    const robots = parseRobotsTxt(origin, text);
    return robots.sitemapUrls.find((url) => /news/i.test(url)) ?? null;
  } catch {
    return null;
  }
}

/** DNS-checked form of a user-entered URL; rejects internal targets. */
async function validateUserUrl(url: string | null): Promise<string | null> {
  return url === null ? null : normalizeAndValidateStartUrl(url);
}

async function addSite(input: {
  projectId: string;
  domain: string;
  isOwn: boolean;
  newsSitemapUrl: string | null;
}) {
  const sites = await TopStoriesRepository.listSites(input.projectId);
  const competitors = sites.filter((site) => !site.isOwn).length;
  if (!input.isOwn && competitors >= TOP_STORIES_LIMITS.maxCompetitors) {
    throw new AppError(
      "VALIDATION_ERROR",
      `Track at most ${TOP_STORIES_LIMITS.maxCompetitors} competitors.`,
    );
  }
  const newsSitemapUrl =
    (await validateUserUrl(input.newsSitemapUrl)) ??
    (await discoverNewsSitemap(input.domain));
  const siteId = await TopStoriesRepository.insertSite({
    ...input,
    newsSitemapUrl,
  });
  if (!siteId) {
    throw new AppError("CONFLICT", `${input.domain} is already tracked.`);
  }
  if (input.isOwn) {
    await TopStoriesRepository.clearOtherOwnSites(input.projectId, siteId);
  }
  return { newsSitemapUrl };
}

async function updateSite(input: {
  projectId: string;
  siteId: string;
  isOwn?: boolean;
  newsSitemapUrl?: string | null;
}) {
  const site = await requireSite(input.projectId, input.siteId);
  await TopStoriesRepository.updateSite(site.id, input.projectId, {
    ...(input.isOwn !== undefined && { isOwn: input.isOwn }),
    ...(input.newsSitemapUrl !== undefined && {
      newsSitemapUrl: await validateUserUrl(input.newsSitemapUrl),
      // A new URL deserves an immediate poll and a clean error state.
      lastFetchedAt: null,
      lastFetchError: null,
    }),
  });
  if (input.isOwn) {
    await TopStoriesRepository.clearOtherOwnSites(input.projectId, site.id);
  }
}

async function deleteSite(projectId: string, siteId: string) {
  await TopStoriesRepository.deleteSite(siteId, projectId);
}

/** Poll one site's sitemap right away (the "test" button). */
async function fetchSiteNow(projectId: string, siteId: string) {
  const site = await requireSite(projectId, siteId);
  if (!site.newsSitemapUrl) {
    throw new AppError("VALIDATION_ERROR", "Add a news sitemap URL first.");
  }
  const now = new Date();
  const nowIso = now.toISOString();
  try {
    const entries = await fetchNewsSitemap(site.newsSitemapUrl);
    const { inserted } = await ingestSitemapEntries(site, entries, now);
    await TopStoriesRepository.updateSite(site.id, projectId, {
      lastFetchedAt: nowIso,
      lastSuccessAt: nowIso,
      lastFetchError: null,
    });
    return {
      entries: entries.length,
      withPublicationDate: entries.filter((entry) => entry.publishedAt).length,
      inserted,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await TopStoriesRepository.updateSite(site.id, projectId, {
      lastFetchedAt: nowIso,
      lastFetchError: message.slice(0, 500),
    });
    throw new AppError("VALIDATION_ERROR", message);
  }
}

async function addTopics(projectId: string, queries: string[]) {
  const settings = await requireSettings(projectId);
  const now = new Date();
  const added = await createTopics({
    projectId,
    queries,
    source: "manual",
    settings,
    // Only a topic that is still being tracked blocks a manual re-add.
    dedupeSince: now.toISOString(),
    now,
  });
  return { added, skipped: queries.length - added };
}

async function importTopicsNow(
  projectId: string,
  source: "google_trends" | "gsc",
) {
  const settings = await requireSettings(projectId);
  const now = new Date();
  const nowIso = now.toISOString();
  try {
    const added =
      source === "google_trends"
        ? await importTrendsTopics(settings, now)
        : await importGscTopics(settings, now);
    await TopStoriesRepository.upsertSettings(
      projectId,
      source === "google_trends"
        ? { lastTrendsImportAt: nowIso, lastTrendsError: null }
        : { lastGscImportAt: nowIso, lastGscError: null },
    );
    return { added };
  } catch (error) {
    const message = (
      error instanceof Error ? error.message : String(error)
    ).slice(0, 500);
    await TopStoriesRepository.upsertSettings(
      projectId,
      source === "google_trends"
        ? { lastTrendsImportAt: nowIso, lastTrendsError: message }
        : { lastGscImportAt: nowIso, lastGscError: message },
    );
    throw new AppError("VALIDATION_ERROR", message);
  }
}

async function stopTopic(projectId: string, topicId: string) {
  await TopStoriesRepository.stopTopic(topicId, projectId);
}

async function deleteTopic(projectId: string, topicId: string) {
  await TopStoriesRepository.deleteTopic(topicId, projectId);
}

async function getTopicSnapshots(projectId: string, topicId: string) {
  await requireTopic(projectId, topicId);
  return TopStoriesRepository.getTopicSnapshots(topicId);
}

/**
 * Pin the article a site ran for a topic, or (url null) drop a manual pick
 * and let automatic matching decide again.
 */
async function setTopicArticle(input: {
  projectId: string;
  topicId: string;
  siteId: string;
  url: string | null;
}) {
  const topic = await requireTopic(input.projectId, input.topicId);
  const site = await requireSite(input.projectId, input.siteId);

  if (input.url === null) {
    await TopStoriesRepository.deleteTopicLink(topic.id, site.id);
    const snapshots = await TopStoriesRepository.getTopicSnapshots(topic.id);
    await linkTopicArticles({
      topic,
      sites: [site],
      cards: snapshots.flatMap((snapshot) => snapshot.results),
      budget: { remaining: 1 },
    });
    return;
  }

  const host = hostOf(input.url);
  if (!host || !hostMatchesDomain(host, site.domain)) {
    throw new AppError("VALIDATION_ERROR", `That URL isn't on ${site.domain}.`);
  }
  const article = await ensureArticle({
    site,
    url: await normalizeAndValidateStartUrl(input.url),
    title: null,
    publishedAt: null,
    budget: { remaining: 1 },
  });
  if (!article) throw new AppError("VALIDATION_ERROR", "Invalid article URL");
  await TopStoriesRepository.setTopicLink({
    topicId: topic.id,
    siteId: site.id,
    articleId: article.id,
    matchedBy: "manual",
  });
}

async function getReport(input: {
  projectId: string;
  from: string;
  to: string;
}): Promise<TopStoriesReport> {
  const [sites, topics] = await Promise.all([
    TopStoriesRepository.listSites(input.projectId),
    TopStoriesRepository.listTopics(input.projectId, input.from, input.to),
  ]);
  const data = await getReportTopicData(topics.map((topic) => topic.id));
  return buildTopStoriesReport({
    sites: sites.map((site) => ({
      id: site.id,
      domain: site.domain,
      isOwn: site.isOwn,
    })),
    topics,
    ...data,
  });
}

export const TopStoriesService = {
  getOverview,
  enable,
  updateSettings,
  addSite,
  updateSite,
  deleteSite,
  fetchSiteNow,
  addTopics,
  importTopicsNow,
  stopTopic,
  deleteTopic,
  getTopicSnapshots,
  setTopicArticle,
  getReport,
  importCrawlLog,
};
