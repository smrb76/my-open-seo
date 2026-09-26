import { describe, expect, it, vi } from "vitest";
import { fetchNewsSitemap } from "@/server/features/top-stories/newsSitemap";

function stubFetch(documents: Record<string, string>) {
  const fetchMock = vi.fn<typeof fetch>(async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    const body = documents[url];
    return body === undefined
      ? new Response("not found", { status: 404 })
      : new Response(body, { headers: { "content-type": "application/xml" } });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const NEWS_SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
  <url>
    <loc>https://rival.ir/news/1</loc>
    <news:news>
      <news:publication><news:name>Rival</news:name><news:language>fa</news:language></news:publication>
      <news:publication_date>2026-09-24T10:14:00+03:30</news:publication_date>
      <news:title><![CDATA[زلزله ۵ ریشتری در کرمان]]></news:title>
    </news:news>
  </url>
  <url>
    <loc>https://rival.ir/news/2</loc>
    <news:news>
      <news:publication_date>1405-07-02T10:00:00+03:30</news:publication_date>
      <news:title>1405</news:title>
    </news:news>
  </url>
  <url><loc>https://rival.ir/about</loc></url>
</urlset>`;

describe("fetchNewsSitemap", () => {
  it("reads exact publication times and titles, dropping non-news entries", async () => {
    stubFetch({ "https://rival.ir/news-sitemap.xml": NEWS_SITEMAP });

    await expect(
      fetchNewsSitemap("https://rival.ir/news-sitemap.xml"),
    ).resolves.toEqual([
      {
        url: "https://rival.ir/news/1",
        title: "زلزله ۵ ریشتری در کرمان",
        publishedAt: "2026-09-24T06:44:00.000Z",
      },
      // A Jalali year in publication_date is kept as an article without a
      // time, never as a date centuries off. A numeric title stays a string.
      { url: "https://rival.ir/news/2", title: "1405", publishedAt: null },
    ]);
  });

  it("explains when the URL is a regular sitemap, not a news sitemap", async () => {
    stubFetch({
      "https://rival.ir/sitemap.xml": `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://rival.ir/a</loc><lastmod>2026-09-24</lastmod></url></urlset>`,
    });

    await expect(
      fetchNewsSitemap("https://rival.ir/sitemap.xml"),
    ).rejects.toThrow(/Google News sitemap/);
  });

  it("follows a sitemap index to its news sitemap only", async () => {
    const fetchMock = stubFetch({
      "https://rival.ir/sitemap_index.xml": `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <sitemap><loc>https://rival.ir/post-sitemap.xml</loc></sitemap>
        <sitemap><loc>https://rival.ir/news-sitemap.xml</loc></sitemap>
      </sitemapindex>`,
      "https://rival.ir/news-sitemap.xml": NEWS_SITEMAP,
    });

    const entries = await fetchNewsSitemap(
      "https://rival.ir/sitemap_index.xml",
    );

    expect(entries.map((entry) => entry.url)).toEqual([
      "https://rival.ir/news/1",
      "https://rival.ir/news/2",
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("refuses internal addresses, including behind a redirect", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(
        async () =>
          new Response(null, {
            status: 302,
            headers: { location: "http://169.254.169.254/latest/meta-data" },
          }),
      ),
    );

    await expect(fetchNewsSitemap("http://127.0.0.1/news.xml")).rejects.toThrow(
      /Blocked URL/,
    );
    await expect(fetchNewsSitemap("https://rival.ir/news.xml")).rejects.toThrow(
      /Blocked URL/,
    );
  });
});
