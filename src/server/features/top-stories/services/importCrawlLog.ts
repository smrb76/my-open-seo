import { AppError } from "@/server/lib/errors";
import {
  isGooglebotUserAgent,
  isIpInRanges,
  loadGooglebotRanges,
  parseAccessLogLine,
} from "@/server/features/top-stories/crawlLog";
import { TopStoriesRepository } from "@/server/features/top-stories/repositories/TopStoriesRepository";
import { normalizeArticleUrl } from "@/shared/top-stories";

/**
 * Record Googlebot's first fetch of our articles from access-log lines. Only
 * articles already known (from our sitemap or the carousel) are updated, and
 * an earlier time always wins over a later one.
 */
export async function importCrawlLog(input: {
  projectId: string;
  lines: string[];
  verifyGooglebotIps: boolean;
}) {
  const sites = await TopStoriesRepository.listSites(input.projectId);
  const own = sites.find((site) => site.isOwn);
  if (!own) {
    throw new AppError("VALIDATION_ERROR", "Add your own site first.");
  }
  const ranges = input.verifyGooglebotIps ? await loadGooglebotRanges() : null;
  if (input.verifyGooglebotIps && !ranges) {
    throw new AppError(
      "UPSTREAM_UNAVAILABLE",
      "Couldn't load Google's Googlebot IP list. Try again, or turn off IP verification.",
    );
  }

  let unparsed = 0;
  let googlebotHits = 0;
  let unverified = 0;
  const earliestByKey = new Map<string, string>();
  for (const line of input.lines) {
    const hit = parseAccessLogLine(line);
    if (!hit) {
      unparsed++;
      continue;
    }
    if (!isGooglebotUserAgent(hit.userAgent)) continue;
    if (hit.status !== null && hit.status >= 400) continue;
    if (ranges && !isIpInRanges(hit.ip, ranges)) {
      unverified++;
      continue;
    }
    googlebotHits++;
    const url = hit.target.startsWith("/")
      ? `https://${own.domain}${hit.target}`
      : hit.target;
    const urlKey = normalizeArticleUrl(url);
    if (!urlKey) continue;
    const previous = earliestByKey.get(urlKey);
    if (!previous || hit.time < previous) earliestByKey.set(urlKey, hit.time);
  }

  const articles = await TopStoriesRepository.getArticlesByKeys(own.id, [
    ...earliestByKey.keys(),
  ]);
  let updated = 0;
  for (const article of articles) {
    const time = earliestByKey.get(article.urlKey);
    if (!time) continue;
    if (article.firstCrawledAt && article.firstCrawledAt <= time) continue;
    await TopStoriesRepository.updateArticle(article.id, {
      firstCrawledAt: time,
      crawlSource: "log",
    });
    updated++;
  }

  return {
    lines: input.lines.length,
    unparsed,
    googlebotHits,
    unverified,
    matchedArticles: articles.length,
    updated,
  };
}
