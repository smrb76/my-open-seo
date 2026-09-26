import { readFileSync } from "node:fs";
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { runBatch } from "@/db/runBatch";
import { normalizePersianText } from "@/shared/top-stories";
import type * as IngestModule from "./topStoriesIngest";
import type * as RepositoryModule from "../repositories/TopStoriesRepository";

// Real in-memory SQLite from the real migration, so the title pre-filter
// (LIKE on normalized Persian text), the match window and the link upserts run
// as generated SQL. Modules load after doMock because the mocks close over the
// database created here.

vi.mock("cloudflare:workers", () => ({
  env: { DATABASE_PROVIDER: "d1" },
}));

type Build = Parameters<typeof runBatch>[0];
type Executor = Parameters<Build>[0];

let client: Client;
let ingest: typeof IngestModule;
let repository: typeof RepositoryModule.TopStoriesRepository;

beforeAll(async () => {
  client = createClient({ url: "file::memory:" });
  const testDb = drizzle(client);
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the libsql client is the same Drizzle query surface runBatch passes in
  const executor = testDb as unknown as Executor;
  vi.doMock("@/db", () => ({ db: testDb }));
  vi.doMock("@/db/runBatch", () => ({
    DB_BATCH_SIZE: 100,
    runBatch: async (build: Build) => {
      for (const statement of build(executor)) await statement;
    },
    executeInBatches: async <T>(
      items: T[],
      buildStatement: (tx: Executor, item: T) => Promise<unknown>,
    ) => {
      for (const item of items) await buildStatement(executor, item);
    },
  }));

  await client.executeMultiple(
    [
      "CREATE TABLE projects (id text PRIMARY KEY, archived_at text);",
      "INSERT INTO projects (id) VALUES ('proj_1');",
      ...readFileSync("drizzle/0048_top_stories.sql", "utf8").split(
        "--> statement-breakpoint",
      ),
    ].join("\n"),
  );

  ingest = await import("./topStoriesIngest");
  ({ TopStoriesRepository: repository } =
    await import("../repositories/TopStoriesRepository"));
});

afterAll(() => {
  client.close();
});

beforeEach(async () => {
  await client.executeMultiple(`
    DELETE FROM top_stories_topic_articles;
    DELETE FROM top_stories_articles;
    DELETE FROM top_stories_topics;
    DELETE FROM top_stories_sites;
  `);
});

const NOW = new Date("2026-09-24T10:00:00.000Z");

async function addSite(domain: string, isOwn = false) {
  await repository.insertSite({
    projectId: "proj_1",
    domain,
    isOwn,
    newsSitemapUrl: `https://${domain}/news.xml`,
  });
  const site = (await repository.listSites("proj_1")).find(
    (candidate) => candidate.domain === domain,
  );
  if (!site) throw new Error("site not stored");
  return site;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** siteId → "<matchedBy> <article url>" for a topic. */
async function links(topicId: string) {
  const result = await client.execute({
    sql: `SELECT l.site_id, l.matched_by, a.url
      FROM top_stories_topic_articles l
      JOIN top_stories_articles a ON a.id = l.article_id
      WHERE l.topic_id = ?`,
    args: [topicId],
  });
  return new Map(
    result.rows.map((row) => [
      text(row.site_id),
      `${text(row.matched_by)} ${text(row.url)}`,
    ]),
  );
}

describe("linkTopicArticles", () => {
  it("prefers the carousel card, keeps manual picks, and title-matches the rest", async () => {
    const own = await addSite("ours.ir", true);
    const rival = await addSite("rival.ir");
    const other = await addSite("other.ir");
    await ingest.ingestSitemapEntries(
      own,
      [
        {
          url: "https://ours.ir/news/last-year",
          title: "زلزله کرمان در سال گذشته",
          publishedAt: "2026-09-20T09:00:00.000Z",
        },
        {
          url: "https://ours.ir/news/today",
          title: "زلزله ۵ ریشتری کرمان را لرزاند",
          publishedAt: "2026-09-24T09:40:00.000Z",
        },
      ],
      NOW,
    );
    await ingest.ingestSitemapEntries(
      rival,
      [
        {
          url: "https://rival.ir/news/first",
          title: "زلزله در کرمان",
          publishedAt: "2026-09-24T09:35:00.000Z",
        },
        {
          url: "https://rival.ir/news/card",
          title: "گزارش تصویری",
          publishedAt: "2026-09-24T09:45:00.000Z",
        },
      ],
      NOW,
    );
    await ingest.ingestSitemapEntries(
      other,
      [
        {
          url: "https://other.ir/news/match",
          title: "زلزله کرمان",
          publishedAt: "2026-09-24T09:30:00.000Z",
        },
        {
          url: "https://other.ir/news/picked",
          title: "یک خبر دیگر",
          publishedAt: "2026-09-24T09:50:00.000Z",
        },
      ],
      NOW,
    );

    // The query arrives with an Arabic kaf, as Trends often sends it.
    const query = "زلزله \u0643رمان";
    await ingest.createTopics({
      projectId: "proj_1",
      queries: [query],
      source: "google_trends",
      settings: { trackingWindowHours: 6 },
      dedupeSince: NOW.toISOString(),
      now: NOW,
    });
    const [topic] = await repository.listActiveTopics("proj_1");
    expect(topic.normalizedQuery).toBe(normalizePersianText("زلزله کرمان"));

    const picked = await repository.findArticleByKey(
      other.id,
      "other.ir/news/picked",
    );
    if (!picked) throw new Error("article not stored");
    await repository.setTopicLink({
      topicId: topic.id,
      siteId: other.id,
      articleId: picked.id,
      matchedBy: "manual",
    });
    const sites = await repository.listSites("proj_1");
    const budget = { remaining: 0 };

    await ingest.linkTopicArticles({ topic, sites, cards: [], budget });
    expect(await links(topic.id)).toEqual(
      new Map([
        [own.id, "title https://ours.ir/news/today"],
        [rival.id, "title https://rival.ir/news/first"],
        [other.id, "manual https://other.ir/news/picked"],
      ]),
    );

    // Google then shows a different rival article (www, trailing slash).
    await ingest.linkTopicArticles({
      topic,
      sites,
      cards: [
        {
          domain: "rival.ir",
          url: "https://www.rival.ir/news/card/",
          title: null,
          publishedAt: null,
        },
        {
          domain: "other.ir",
          url: "https://other.ir/news/match",
          title: null,
          publishedAt: null,
        },
      ],
      budget,
    });
    expect(await links(topic.id)).toEqual(
      new Map([
        [own.id, "title https://ours.ir/news/today"],
        [rival.id, "carousel https://rival.ir/news/card"],
        [other.id, "manual https://other.ir/news/picked"],
      ]),
    );
  });
});

describe("ingestSitemapEntries", () => {
  it("stores articles once, stamps first-seen only while polling, and upgrades card times", async () => {
    const rival = await addSite("rival.ir");
    const entry = {
      url: "https://rival.ir/news/1",
      title: "خبر اول",
      publishedAt: "2026-09-24T09:00:00.000Z",
    };

    // First poll: a backlog, so nothing is stamped as just seen.
    await expect(
      ingest.ingestSitemapEntries(rival, [entry], NOW),
    ).resolves.toEqual({ inserted: 1, updated: 0 });

    // A card found the next article before the sitemap listed it.
    await ingest.ensureArticle({
      site: rival,
      url: "https://rival.ir/news/2",
      title: "خبر دوم",
      publishedAt: "2026-09-24T09:50:00.000Z",
      budget: { remaining: 0 },
    });

    const polling = { ...rival, lastSuccessAt: "2026-09-24T09:56:00.000Z" };
    const later = new Date("2026-09-24T10:01:00.000Z");
    await expect(
      ingest.ingestSitemapEntries(
        polling,
        [
          entry,
          {
            url: "https://rival.ir/news/2",
            title: "خبر دوم",
            publishedAt: "2026-09-24T09:48:30.000Z",
          },
          {
            url: "https://rival.ir/news/3",
            title: "خبر سوم",
            publishedAt: "2026-09-24T09:59:00.000Z",
          },
        ],
        later,
      ),
    ).resolves.toEqual({ inserted: 1, updated: 1 });

    const rows = await client.execute(
      "SELECT url, published_at, published_at_source, first_seen_in_sitemap_at FROM top_stories_articles ORDER BY url",
    );
    expect(rows.rows.map((row) => ({ ...row }))).toEqual([
      {
        url: "https://rival.ir/news/1",
        published_at: "2026-09-24T09:00:00.000Z",
        published_at_source: "sitemap",
        first_seen_in_sitemap_at: null,
      },
      {
        url: "https://rival.ir/news/2",
        published_at: "2026-09-24T09:48:30.000Z",
        published_at_source: "sitemap",
        first_seen_in_sitemap_at: later.toISOString(),
      },
      {
        url: "https://rival.ir/news/3",
        published_at: "2026-09-24T09:59:00.000Z",
        published_at_source: "sitemap",
        first_seen_in_sitemap_at: later.toISOString(),
      },
    ]);
  });
});
