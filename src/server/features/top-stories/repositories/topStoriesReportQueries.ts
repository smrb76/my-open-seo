import { and, count, eq, inArray, min } from "drizzle-orm";
import { db } from "@/db";
import {
  topStoriesArticles,
  topStoriesResults,
  topStoriesSnapshots,
  topStoriesTopicArticles,
} from "@/db/schema";
import { DB_BATCH_SIZE } from "@/db/runBatch";
import type {
  ReportAppearanceInput,
  ReportLinkInput,
} from "@/server/features/top-stories/topStoriesReport";

// Aggregated reads behind the report: per-host carousel appearances, carousel
// snapshot counts, and each site's matched article, for a set of topics.

export async function getReportTopicData(topicIds: string[]) {
  const appearances: ReportAppearanceInput[] = [];
  const carouselSnapshotCounts = new Map<string, number>();
  const links: ReportLinkInput[] = [];

  // Bounded IN lists keep D1 under its bound-parameter limit.
  for (let i = 0; i < topicIds.length; i += DB_BATCH_SIZE - 10) {
    const ids = topicIds.slice(i, i + DB_BATCH_SIZE - 10);
    const [appearanceRows, countRows, linkRows] = await Promise.all([
      db
        .select({
          topicId: topStoriesSnapshots.topicId,
          domain: topStoriesResults.domain,
          firstSeenAt: min(topStoriesSnapshots.checkedAt),
          bestPosition: min(topStoriesResults.position),
        })
        .from(topStoriesResults)
        .innerJoin(
          topStoriesSnapshots,
          eq(topStoriesSnapshots.id, topStoriesResults.snapshotId),
        )
        .where(inArray(topStoriesSnapshots.topicId, ids))
        .groupBy(topStoriesSnapshots.topicId, topStoriesResults.domain),
      db
        .select({ topicId: topStoriesSnapshots.topicId, value: count() })
        .from(topStoriesSnapshots)
        .where(
          and(
            inArray(topStoriesSnapshots.topicId, ids),
            eq(topStoriesSnapshots.hasTopStories, true),
          ),
        )
        .groupBy(topStoriesSnapshots.topicId),
      db
        .select({
          topicId: topStoriesTopicArticles.topicId,
          siteId: topStoriesTopicArticles.siteId,
          matchedBy: topStoriesTopicArticles.matchedBy,
          article: topStoriesArticles,
        })
        .from(topStoriesTopicArticles)
        .innerJoin(
          topStoriesArticles,
          eq(topStoriesArticles.id, topStoriesTopicArticles.articleId),
        )
        .where(inArray(topStoriesTopicArticles.topicId, ids)),
    ]);

    for (const row of appearanceRows) {
      if (row.firstSeenAt === null || row.bestPosition === null) continue;
      appearances.push({
        topicId: row.topicId,
        domain: row.domain,
        firstSeenAt: row.firstSeenAt,
        bestPosition: row.bestPosition,
      });
    }
    for (const row of countRows) {
      carouselSnapshotCounts.set(row.topicId, row.value);
    }
    for (const row of linkRows) {
      links.push({
        topicId: row.topicId,
        siteId: row.siteId,
        article: {
          id: row.article.id,
          url: row.article.url,
          title: row.article.title,
          publishedAt: row.article.publishedAt,
          publishedAtSource: row.article.publishedAtSource,
          firstSeenInSitemapAt: row.article.firstSeenInSitemapAt,
          firstCrawledAt: row.article.firstCrawledAt,
          crawlSource: row.article.crawlSource,
          matchedBy: row.matchedBy,
        },
      });
    }
  }

  return { appearances, carouselSnapshotCounts, links };
}
