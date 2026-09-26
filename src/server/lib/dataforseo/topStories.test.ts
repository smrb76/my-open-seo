import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/lib/runtime-env", () => ({
  getRequiredEnvValue: vi.fn(async () => "test-api-key"),
}));

import { fetchTopStoriesSerp } from "@/server/lib/dataforseo/topStories";

describe("fetchTopStoriesSerp", () => {
  it("numbers cards across Top Stories boxes and converts DataForSEO times", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          status_code: 20000,
          tasks: [
            {
              status_code: 20000,
              path: ["v3", "serp", "google", "organic", "live", "advanced"],
              cost: 0.002,
              result: [
                {
                  datetime: "2026-09-24 07:30:05 +00:00",
                  items: [
                    // An unrelated feature with its own nested shape must not
                    // fail the snapshot.
                    { type: "people_also_ask", items: [{ title: 42 }] },
                    {
                      type: "top_stories",
                      items: [
                        {
                          type: "top_stories_element",
                          source: "Rival",
                          domain: "www.rival.ir",
                          title: "زلزله کرمان",
                          url: "https://www.rival.ir/news/1",
                          timestamp: "2026-09-24 07:12:00 +00:00",
                        },
                        { type: "top_stories_element", url: null },
                      ],
                    },
                    { type: "organic", url: "https://example.com" },
                    {
                      type: "top_stories",
                      items: [
                        {
                          url: "https://ours.ir/news/2",
                          timestamp: null,
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        }),
      ),
    );

    await expect(
      fetchTopStoriesSerp({
        keyword: "زلزله کرمان",
        locationCode: 2364,
        languageCode: "fa",
        device: "mobile",
      }),
    ).resolves.toEqual({
      data: {
        checkedAt: "2026-09-24T07:30:05.000Z",
        cards: [
          {
            position: 1,
            url: "https://www.rival.ir/news/1",
            title: "زلزله کرمان",
            sourceName: "Rival",
            publishedAt: "2026-09-24T07:12:00.000Z",
          },
          {
            position: 2,
            url: "https://ours.ir/news/2",
            title: null,
            sourceName: null,
            publishedAt: null,
          },
        ],
      },
      billing: {
        path: ["v3", "serp", "google", "organic", "live", "advanced"],
        costUsd: 0.002,
      },
    });
  });
});
