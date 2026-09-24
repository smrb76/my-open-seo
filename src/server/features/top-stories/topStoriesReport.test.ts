import { describe, expect, it } from "vitest";
import {
  buildTopStoriesReport,
  type ReportAppearanceInput,
  type ReportLinkInput,
} from "@/server/features/top-stories/topStoriesReport";
import type { TopStoriesArticleView } from "@/types/schemas/top-stories";

const sites = [
  { id: "own", domain: "ours.ir", isOwn: true },
  { id: "rival", domain: "rival.ir", isOwn: false },
];

function topic(id: string) {
  return {
    id,
    query: id,
    source: "google_trends" as const,
    createdAt: "2026-09-24T09:00:00.000Z",
    trackingEndsAt: "2026-09-24T15:00:00.000Z",
    nextSnapshotAt: null,
    snapshotCount: 12,
    lastError: null,
  };
}

function link(
  topicId: string,
  siteId: string,
  article: Partial<TopStoriesArticleView>,
): ReportLinkInput {
  return {
    topicId,
    siteId,
    article: {
      id: `${topicId}-${siteId}`,
      url: `https://${siteId}.ir/${topicId}`,
      title: null,
      publishedAt: null,
      publishedAtSource: "sitemap",
      firstSeenInSitemapAt: null,
      firstCrawledAt: null,
      crawlSource: null,
      matchedBy: "title",
      ...article,
    },
  };
}

function seen(
  topicId: string,
  domain: string,
  firstSeenAt: string,
  bestPosition: number,
): ReportAppearanceInput {
  return { topicId, domain, firstSeenAt, bestPosition };
}

describe("buildTopStoriesReport", () => {
  it("times each site against the first tracked publisher", () => {
    const report = buildTopStoriesReport({
      sites,
      topics: [topic("won")],
      appearances: [
        seen("won", "ours.ir", "2026-09-24T10:30:00.000Z", 2),
        // A subdomain card counts for its site.
        seen("won", "sport.rival.ir", "2026-09-24T10:30:00.000Z", 1),
      ],
      carouselSnapshotCounts: new Map([["won", 4]]),
      links: [
        link("won", "own", {
          publishedAt: "2026-09-24T10:00:00.000Z",
          firstSeenInSitemapAt: "2026-09-24T10:04:00.000Z",
          firstCrawledAt: "2026-09-24T10:03:00.000Z",
        }),
        link("won", "rival", { publishedAt: "2026-09-24T10:06:00.000Z" }),
      ],
    });

    const [row] = report.topics;
    expect(row.outcome).toBe("won");
    expect(row.firstPublisherSiteIds).toEqual(["own"]);
    expect(row.sites).toMatchObject([
      {
        siteId: "own",
        inTopStories: true,
        bestPosition: 2,
        publishDelayMinutes: 0,
        sitemapDelayMinutes: 4,
        crawlDelayMinutes: 3,
        carouselDelayMinutes: 30,
      },
      { siteId: "rival", inTopStories: true, publishDelayMinutes: 6 },
    ]);
  });

  it("measures presence over carousel topics and attributes each loss", () => {
    const report = buildTopStoriesReport({
      sites,
      topics: [
        topic("won"),
        topic("lateNewsroom"),
        topic("lateCrawl"),
        topic("noBox"),
      ],
      appearances: [
        seen("won", "ours.ir", "2026-09-24T10:30:00.000Z", 1),
        seen("won", "rival.ir", "2026-09-24T10:30:00.000Z", 2),
        seen("lateNewsroom", "rival.ir", "2026-09-24T09:30:00.000Z", 1),
        seen("lateCrawl", "rival.ir", "2026-09-24T12:30:00.000Z", 1),
      ],
      carouselSnapshotCounts: new Map([
        ["won", 4],
        ["lateNewsroom", 3],
        ["lateCrawl", 2],
      ]),
      links: [
        link("won", "own", {
          publishedAt: "2026-09-24T10:00:00.000Z",
          firstCrawledAt: "2026-09-24T10:03:00.000Z",
        }),
        link("lateNewsroom", "rival", {
          publishedAt: "2026-09-24T09:00:00.000Z",
        }),
        link("lateNewsroom", "own", {
          publishedAt: "2026-09-24T09:14:00.000Z",
        }),
        link("lateCrawl", "own", {
          publishedAt: "2026-09-24T12:00:00.000Z",
          firstCrawledAt: "2026-09-24T12:25:00.000Z",
        }),
        link("lateCrawl", "rival", {
          publishedAt: "2026-09-24T12:02:00.000Z",
        }),
      ],
    });

    expect(report.topics.map((row) => row.outcome)).toEqual([
      "won",
      "lost",
      "lost",
      "no_carousel",
    ]);
    // The topic without a Top Stories box is left out of every share.
    expect(report.presence).toEqual([
      { siteId: "own", topics: 1, share: 1 / 3 },
      { siteId: "rival", topics: 3, share: 1 },
    ]);
    expect(report.analysis).toMatchObject({
      topicCount: 4,
      carouselTopicCount: 3,
      won: { count: 1, medianPublishDelayMinutes: 0 },
      lost: {
        count: 2,
        medianPublishDelayMinutes: 7,
        medianCrawlDelayMinutes: 25,
      },
      lostCauses: {
        slowPublish: 1,
        slowCrawl: 1,
        other: 0,
        noCrawlData: 0,
        notCovered: 0,
      },
    });
  });
});
