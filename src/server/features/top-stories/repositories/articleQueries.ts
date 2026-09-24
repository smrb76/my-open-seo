import {
  and,
  asc,
  eq,
  gte,
  inArray,
  isNull,
  like,
  lt,
  lte,
  min,
  or,
  sql,
} from "drizzle-orm";
import { db } from "@/db";
import {
  projects,
  topStoriesArticles,
  topStoriesResults,
  topStoriesSettings,
  topStoriesSites,
  topStoriesSnapshots,
  topStoriesTopicArticles,
  topStoriesTopics,
} from "@/db/schema";
import { DB_BATCH_SIZE, executeInBatches, runBatch } from "@/db/runBatch";

// Snapshots, articles and topic-article links: the write-heavy half of the
// Top Stories repository. Exposed through TopStoriesRepository.

type TopStoriesArticle = typeof topStoriesArticles.$inferSelect;
type TopicMatchKind =
  (typeof topStoriesTopicArticles.$inferSelect)["matchedBy"];
type ArticleInsert = typeof topStoriesArticles.$inferInsert;
type ResultInsert = typeof topStoriesResults.$inferInsert;

function chunks<T>(items: T[], size = DB_BATCH_SIZE - 10): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------

export async function insertSnapshot(input: {
  topicId: string;
  checkedAt: string;
  results: Omit<ResultInsert, "snapshotId">[];
}): Promise<void> {
  const snapshotId = crypto.randomUUID();
  await runBatch((tx) => [
    tx.insert(topStoriesSnapshots).values({
      id: snapshotId,
      topicId: input.topicId,
      checkedAt: input.checkedAt,
      hasTopStories: input.results.length > 0,
    }),
    ...input.results.map((result) =>
      tx.insert(topStoriesResults).values({ ...result, snapshotId }),
    ),
    tx
      .update(topStoriesTopics)
      .set({
        snapshotCount: sql`${topStoriesTopics.snapshotCount} + 1`,
        lastError: null,
      })
      .where(eq(topStoriesTopics.id, input.topicId)),
  ]);
}

/** Earliest publication time Google showed on any card for the topic. */
export async function getEarliestCardPublishedAt(
  topicId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ value: min(topStoriesResults.publishedAt) })
    .from(topStoriesResults)
    .innerJoin(
      topStoriesSnapshots,
      eq(topStoriesSnapshots.id, topStoriesResults.snapshotId),
    )
    .where(eq(topStoriesSnapshots.topicId, topicId));
  return row?.value ?? null;
}

export async function getTopicSnapshots(topicId: string) {
  const snapshots = await db
    .select()
    .from(topStoriesSnapshots)
    .where(eq(topStoriesSnapshots.topicId, topicId))
    .orderBy(asc(topStoriesSnapshots.checkedAt));
  const rows =
    snapshots.length === 0
      ? []
      : await db
          .select({ result: topStoriesResults })
          .from(topStoriesResults)
          .innerJoin(
            topStoriesSnapshots,
            eq(topStoriesSnapshots.id, topStoriesResults.snapshotId),
          )
          .where(eq(topStoriesSnapshots.topicId, topicId))
          .orderBy(asc(topStoriesResults.position));
  return snapshots.map((snapshot) => ({
    ...snapshot,
    results: rows
      .map((row) => row.result)
      .filter((result) => result.snapshotId === snapshot.id),
  }));
}

// ---------------------------------------------------------------------------
// Articles
// ---------------------------------------------------------------------------

/** Articles of a site first stored since `since`, keyed by urlKey. */
export async function getRecentArticlesByKey(siteId: string, since: string) {
  const rows = await db
    .select({
      id: topStoriesArticles.id,
      urlKey: topStoriesArticles.urlKey,
      publishedAtSource: topStoriesArticles.publishedAtSource,
    })
    .from(topStoriesArticles)
    .where(
      and(
        eq(topStoriesArticles.siteId, siteId),
        gte(topStoriesArticles.createdAt, since),
      ),
    );
  return new Map(rows.map((row) => [row.urlKey, row]));
}

export async function insertArticles(rows: ArticleInsert[]): Promise<void> {
  await executeInBatches(rows, (tx, row) =>
    tx.insert(topStoriesArticles).values(row).onConflictDoNothing(),
  );
}

export async function updateArticle(
  articleId: string,
  patch: Partial<Omit<TopStoriesArticle, "id" | "siteId" | "createdAt">>,
): Promise<void> {
  await db
    .update(topStoriesArticles)
    .set(patch)
    .where(eq(topStoriesArticles.id, articleId));
}

export async function findArticleByKey(
  siteId: string,
  urlKey: string,
): Promise<TopStoriesArticle | null> {
  const rows = await db
    .select()
    .from(topStoriesArticles)
    .where(
      and(
        eq(topStoriesArticles.siteId, siteId),
        eq(topStoriesArticles.urlKey, urlKey),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function getArticlesByKeys(
  siteId: string,
  urlKeys: string[],
): Promise<TopStoriesArticle[]> {
  const out: TopStoriesArticle[] = [];
  for (const keys of chunks(urlKeys)) {
    out.push(
      ...(await db
        .select()
        .from(topStoriesArticles)
        .where(
          and(
            eq(topStoriesArticles.siteId, siteId),
            inArray(topStoriesArticles.urlKey, keys),
          ),
        )),
    );
  }
  return out;
}

/**
 * Title-match candidates: articles of the given sites published inside the
 * window whose normalized title contains `token` (a SQL pre-filter; callers
 * apply the full token rule).
 */
export async function findTitleCandidates(input: {
  siteIds: string[];
  from: string;
  to: string;
  token: string;
}) {
  if (input.siteIds.length === 0) return [];
  return db
    .select({
      id: topStoriesArticles.id,
      siteId: topStoriesArticles.siteId,
      normalizedTitle: topStoriesArticles.normalizedTitle,
      publishedAt: topStoriesArticles.publishedAt,
    })
    .from(topStoriesArticles)
    .where(
      and(
        inArray(topStoriesArticles.siteId, input.siteIds),
        gte(topStoriesArticles.publishedAt, input.from),
        lte(topStoriesArticles.publishedAt, input.to),
        like(topStoriesArticles.normalizedTitle, `%${input.token}%`),
      ),
    )
    .orderBy(asc(topStoriesArticles.publishedAt));
}

/**
 * Own-site articles tied to a recent topic that still lack a crawl time and
 * are due for a URL Inspection check.
 */
export async function getArticlesDueForCrawlCheck(input: {
  topicsSince: string;
  checkedBefore: string;
  limit: number;
}) {
  const rows = await db
    .select({
      article: topStoriesArticles,
      projectId: topStoriesSites.projectId,
    })
    .from(topStoriesArticles)
    .innerJoin(
      topStoriesSites,
      eq(topStoriesSites.id, topStoriesArticles.siteId),
    )
    .innerJoin(
      topStoriesTopicArticles,
      eq(topStoriesTopicArticles.articleId, topStoriesArticles.id),
    )
    .innerJoin(
      topStoriesTopics,
      eq(topStoriesTopics.id, topStoriesTopicArticles.topicId),
    )
    .innerJoin(
      topStoriesSettings,
      eq(topStoriesSettings.projectId, topStoriesSites.projectId),
    )
    .innerJoin(projects, eq(projects.id, topStoriesSites.projectId))
    .where(
      and(
        eq(topStoriesSites.isOwn, true),
        eq(topStoriesSettings.isActive, true),
        isNull(projects.archivedAt),
        isNull(topStoriesArticles.firstCrawledAt),
        gte(topStoriesTopics.createdAt, input.topicsSince),
        or(
          isNull(topStoriesArticles.crawlCheckedAt),
          lt(topStoriesArticles.crawlCheckedAt, input.checkedBefore),
        ),
      ),
    )
    .orderBy(
      sql`${topStoriesArticles.crawlCheckedAt} is not null`,
      asc(topStoriesArticles.crawlCheckedAt),
    )
    .limit(input.limit);
  // An article linked to several topics comes back once per link.
  return [...new Map(rows.map((row) => [row.article.id, row])).values()];
}

// ---------------------------------------------------------------------------
// Topic ↔ article links
// ---------------------------------------------------------------------------

export async function getTopicLinks(topicId: string) {
  return db
    .select({
      siteId: topStoriesTopicArticles.siteId,
      articleId: topStoriesTopicArticles.articleId,
      matchedBy: topStoriesTopicArticles.matchedBy,
    })
    .from(topStoriesTopicArticles)
    .where(eq(topStoriesTopicArticles.topicId, topicId));
}

export async function setTopicLink(input: {
  topicId: string;
  siteId: string;
  articleId: string;
  matchedBy: TopicMatchKind;
}): Promise<void> {
  await db
    .insert(topStoriesTopicArticles)
    .values(input)
    .onConflictDoUpdate({
      target: [topStoriesTopicArticles.topicId, topStoriesTopicArticles.siteId],
      set: { articleId: input.articleId, matchedBy: input.matchedBy },
    });
}

export async function deleteTopicLink(topicId: string, siteId: string) {
  await db
    .delete(topStoriesTopicArticles)
    .where(
      and(
        eq(topStoriesTopicArticles.topicId, topicId),
        eq(topStoriesTopicArticles.siteId, siteId),
      ),
    );
}

// ---------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------

export async function pruneBefore(cutoff: string): Promise<void> {
  await db
    .delete(topStoriesTopics)
    .where(lt(topStoriesTopics.createdAt, cutoff));
  await db
    .delete(topStoriesArticles)
    .where(
      sql`coalesce(${topStoriesArticles.publishedAt}, ${topStoriesArticles.createdAt}) < ${cutoff}`,
    );
}
