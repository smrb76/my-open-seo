import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { db } from "@/db";
import {
  projects,
  type topStoriesArticles,
  topStoriesSettings,
  topStoriesSites,
  topStoriesTopics,
} from "@/db/schema";
import * as articleQueries from "@/server/features/top-stories/repositories/articleQueries";

export type TopStoriesSettings = typeof topStoriesSettings.$inferSelect;
export type TopStoriesSite = typeof topStoriesSites.$inferSelect;
export type TopStoriesTopic = typeof topStoriesTopics.$inferSelect;
type TopicInsert = typeof topStoriesTopics.$inferInsert;
export type TopStoriesArticle = typeof topStoriesArticles.$inferSelect;

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

async function getSettings(
  projectId: string,
): Promise<TopStoriesSettings | null> {
  const rows = await db
    .select()
    .from(topStoriesSettings)
    .where(eq(topStoriesSettings.projectId, projectId))
    .limit(1);
  return rows[0] ?? null;
}

async function upsertSettings(
  projectId: string,
  patch: Partial<Omit<TopStoriesSettings, "projectId" | "createdAt">>,
): Promise<void> {
  const updatedAt = new Date().toISOString();
  await db
    .insert(topStoriesSettings)
    .values({ projectId, ...patch, updatedAt })
    .onConflictDoUpdate({
      target: topStoriesSettings.projectId,
      set: { ...patch, updatedAt },
    });
}

/** Projects the scheduler should work on, with their billing organization. */
async function getActiveProjects() {
  return db
    .select({
      settings: topStoriesSettings,
      organizationId: projects.organizationId,
    })
    .from(topStoriesSettings)
    .innerJoin(projects, eq(projects.id, topStoriesSettings.projectId))
    .where(
      and(eq(topStoriesSettings.isActive, true), isNull(projects.archivedAt)),
    );
}

// ---------------------------------------------------------------------------
// Sites
// ---------------------------------------------------------------------------

async function listSites(projectId: string): Promise<TopStoriesSite[]> {
  return db
    .select()
    .from(topStoriesSites)
    .where(eq(topStoriesSites.projectId, projectId))
    .orderBy(desc(topStoriesSites.isOwn), asc(topStoriesSites.domain));
}

async function getSite(
  siteId: string,
  projectId: string,
): Promise<TopStoriesSite | null> {
  const rows = await db
    .select()
    .from(topStoriesSites)
    .where(
      and(
        eq(topStoriesSites.id, siteId),
        eq(topStoriesSites.projectId, projectId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/** Returns the new site's id, or null when the domain is already tracked. */
async function insertSite(input: {
  projectId: string;
  domain: string;
  isOwn: boolean;
  newsSitemapUrl: string | null;
}): Promise<string | null> {
  const [inserted] = await db
    .insert(topStoriesSites)
    .values({ id: crypto.randomUUID(), ...input })
    .onConflictDoNothing()
    .returning({ id: topStoriesSites.id });
  return inserted?.id ?? null;
}

async function updateSite(
  siteId: string,
  projectId: string,
  patch: Partial<
    Pick<
      TopStoriesSite,
      | "isOwn"
      | "newsSitemapUrl"
      | "lastFetchedAt"
      | "lastSuccessAt"
      | "lastFetchError"
    >
  >,
): Promise<void> {
  await db
    .update(topStoriesSites)
    .set(patch)
    .where(
      and(
        eq(topStoriesSites.id, siteId),
        eq(topStoriesSites.projectId, projectId),
      ),
    );
}

/** Demote every other own site of the project (one own site per project). */
async function clearOtherOwnSites(
  projectId: string,
  keepSiteId: string,
): Promise<void> {
  await db
    .update(topStoriesSites)
    .set({ isOwn: false })
    .where(
      and(
        eq(topStoriesSites.projectId, projectId),
        ne(topStoriesSites.id, keepSiteId),
      ),
    );
}

async function deleteSite(siteId: string, projectId: string): Promise<void> {
  await db
    .delete(topStoriesSites)
    .where(
      and(
        eq(topStoriesSites.id, siteId),
        eq(topStoriesSites.projectId, projectId),
      ),
    );
}

/** Sites with a sitemap whose last fetch is older than `fetchedBefore`. */
async function getSitesDueForFetch(fetchedBefore: string, limit: number) {
  return (
    db
      .select({ site: topStoriesSites })
      .from(topStoriesSites)
      .innerJoin(
        topStoriesSettings,
        eq(topStoriesSettings.projectId, topStoriesSites.projectId),
      )
      .innerJoin(projects, eq(projects.id, topStoriesSites.projectId))
      .where(
        and(
          isNotNull(topStoriesSites.newsSitemapUrl),
          eq(topStoriesSettings.isActive, true),
          isNull(projects.archivedAt),
          or(
            isNull(topStoriesSites.lastFetchedAt),
            lt(topStoriesSites.lastFetchedAt, fetchedBefore),
          ),
        ),
      )
      // Never-fetched sites first (portable: NULLs sort differently per backend).
      .orderBy(
        sql`${topStoriesSites.lastFetchedAt} is not null`,
        asc(topStoriesSites.lastFetchedAt),
      )
      .limit(limit)
  );
}

// ---------------------------------------------------------------------------
// Topics
// ---------------------------------------------------------------------------

async function insertTopics(rows: TopicInsert[]): Promise<number> {
  let inserted = 0;
  for (const row of rows) {
    // Row by row: the conflict target is a partial unique index, and a skipped
    // duplicate must not abort the rest of the batch.
    const result = await db
      .insert(topStoriesTopics)
      .values(row)
      .onConflictDoNothing()
      .returning({ id: topStoriesTopics.id });
    inserted += result.length;
  }
  return inserted;
}

async function getTopicKeysSince(
  projectId: string,
  since: string,
): Promise<Set<string>> {
  const rows = await db
    .select({ key: topStoriesTopics.normalizedQuery })
    .from(topStoriesTopics)
    .where(
      and(
        eq(topStoriesTopics.projectId, projectId),
        or(
          gte(topStoriesTopics.createdAt, since),
          isNotNull(topStoriesTopics.nextSnapshotAt),
        ),
      ),
    );
  return new Set(rows.map((row) => row.key));
}

async function countAutoTopicsSince(
  projectId: string,
  since: string,
): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(topStoriesTopics)
    .where(
      and(
        eq(topStoriesTopics.projectId, projectId),
        ne(topStoriesTopics.source, "manual"),
        gte(topStoriesTopics.createdAt, since),
      ),
    );
  return row?.value ?? 0;
}

async function getTopic(
  topicId: string,
  projectId: string,
): Promise<TopStoriesTopic | null> {
  const rows = await db
    .select()
    .from(topStoriesTopics)
    .where(
      and(
        eq(topStoriesTopics.id, topicId),
        eq(topStoriesTopics.projectId, projectId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

async function listTopics(projectId: string, from: string, to: string) {
  return db
    .select()
    .from(topStoriesTopics)
    .where(
      and(
        eq(topStoriesTopics.projectId, projectId),
        gte(topStoriesTopics.createdAt, from),
        lt(topStoriesTopics.createdAt, to),
      ),
    )
    .orderBy(desc(topStoriesTopics.createdAt));
}

async function listActiveTopics(projectId: string) {
  return db
    .select()
    .from(topStoriesTopics)
    .where(
      and(
        eq(topStoriesTopics.projectId, projectId),
        isNotNull(topStoriesTopics.nextSnapshotAt),
      ),
    )
    .orderBy(asc(topStoriesTopics.nextSnapshotAt));
}

/** Topics due for a snapshot, oldest due first, with their project context. */
async function getDueTopics(now: string, limit: number) {
  return db
    .select({
      topic: topStoriesTopics,
      settings: topStoriesSettings,
      organizationId: projects.organizationId,
    })
    .from(topStoriesTopics)
    .innerJoin(
      topStoriesSettings,
      eq(topStoriesSettings.projectId, topStoriesTopics.projectId),
    )
    .innerJoin(projects, eq(projects.id, topStoriesTopics.projectId))
    .where(
      and(
        isNotNull(topStoriesTopics.nextSnapshotAt),
        lte(topStoriesTopics.nextSnapshotAt, now),
        eq(topStoriesSettings.isActive, true),
        isNull(projects.archivedAt),
      ),
    )
    .orderBy(asc(topStoriesTopics.nextSnapshotAt))
    .limit(limit);
}

/**
 * Move a due topic's schedule forward, only if nobody else already did
 * (compare-and-set on the observed due time). Returns whether this caller won.
 */
async function claimTopicSnapshot(input: {
  topicId: string;
  observedNextSnapshotAt: string;
  nextSnapshotAt: string | null;
}): Promise<boolean> {
  const claimed = await db
    .update(topStoriesTopics)
    .set({ nextSnapshotAt: input.nextSnapshotAt })
    .where(
      and(
        eq(topStoriesTopics.id, input.topicId),
        eq(topStoriesTopics.nextSnapshotAt, input.observedNextSnapshotAt),
      ),
    )
    .returning({ id: topStoriesTopics.id });
  return claimed.length > 0;
}

async function recordTopicError(topicId: string, message: string) {
  await db
    .update(topStoriesTopics)
    .set({ lastError: message.slice(0, 500) })
    .where(eq(topStoriesTopics.id, topicId));
}

async function stopTopic(topicId: string, projectId: string): Promise<void> {
  await db
    .update(topStoriesTopics)
    .set({ nextSnapshotAt: null })
    .where(
      and(
        eq(topStoriesTopics.id, topicId),
        eq(topStoriesTopics.projectId, projectId),
      ),
    );
}

async function deleteTopic(topicId: string, projectId: string): Promise<void> {
  await db
    .delete(topStoriesTopics)
    .where(
      and(
        eq(topStoriesTopics.id, topicId),
        eq(topStoriesTopics.projectId, projectId),
      ),
    );
}

export const TopStoriesRepository = {
  getSettings,
  upsertSettings,
  getActiveProjects,
  listSites,
  getSite,
  insertSite,
  updateSite,
  clearOtherOwnSites,
  deleteSite,
  getSitesDueForFetch,
  insertTopics,
  getTopicKeysSince,
  countAutoTopicsSince,
  getTopic,
  listTopics,
  listActiveTopics,
  getDueTopics,
  claimTopicSnapshot,
  recordTopicError,
  stopTopic,
  deleteTopic,
  ...articleQueries,
};
