import { XMLParser } from "fast-xml-parser";
import { z } from "zod";
import { readBodyCapped } from "@/server/lib/audit/discovery";
import { fetchPublicUrl } from "@/server/features/top-stories/publicFetch";
import { toIsoOrNull } from "@/shared/top-stories";

// Reads a Google News sitemap: every <url> with a <news:news> block, carrying
// the exact publication time publishers declare to Google.

export const TOP_STORIES_USER_AGENT =
  "Mozilla/5.0 (compatible; OpenSEO-TopStories/1.0; +https://openseo.so)";

const FETCH_TIMEOUT_MS = 15_000;
// Google caps a news sitemap at 1,000 URLs, a few hundred KB. The cap keeps a
// misconfigured URL (a full archive sitemap) from exhausting Worker memory.
const MAX_SITEMAP_BYTES = 5 * 1024 * 1024;
const MAX_CHILD_SITEMAPS = 3;

const xmlParser = new XMLParser({
  removeNSPrefix: true,
  // Titles like "1403" must stay strings.
  parseTagValue: false,
  isArray: (name) => name === "url" || name === "sitemap",
});

const locSchema = z.object({ loc: z.string() }).passthrough();

const newsUrlSchema = z.object({
  loc: z.string(),
  news: z
    .object({
      publication_date: z.string().optional(),
      title: z.string().optional(),
    })
    .passthrough(),
});

const documentSchema = z
  .object({
    urlset: z
      .union([
        z.object({ url: z.array(z.unknown()).optional() }).passthrough(),
        z.literal(""),
      ])
      .optional(),
    sitemapindex: z
      .object({ sitemap: z.array(z.unknown()).optional() })
      .passthrough()
      .optional(),
  })
  .passthrough();

export interface NewsSitemapEntry {
  url: string;
  title: string | null;
  publishedAt: string | null;
}

type SitemapDocument =
  | { kind: "urlset"; entries: NewsSitemapEntry[] }
  | { kind: "index"; children: string[] };

// A Jalali year typed into publication_date ("1403-07-02") parses as a real but
// absurd date; anything outside this range is treated as missing.
function plausiblePublishedAt(value: string | undefined): string | null {
  const iso = toIsoOrNull(value);
  if (!iso) return null;
  const time = Date.parse(iso);
  const earliest = Date.parse("2000-01-01T00:00:00Z");
  return time >= earliest && time <= Date.now() + 24 * 3600_000 ? iso : null;
}

function isAbsoluteHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function parseSitemapDocument(xml: string, url: string): SitemapDocument {
  let raw: unknown;
  try {
    raw = xmlParser.parse(xml);
  } catch {
    throw new Error(`Not valid XML: ${url}`);
  }
  const parsed = documentSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`Not a sitemap: ${url}`);

  const { urlset, sitemapindex } = parsed.data;
  if (sitemapindex) {
    const children = (sitemapindex.sitemap ?? []).flatMap((entry) => {
      const result = locSchema.safeParse(entry);
      return result.success && isAbsoluteHttpUrl(result.data.loc.trim())
        ? [result.data.loc.trim()]
        : [];
    });
    return { kind: "index", children };
  }
  if (urlset === undefined) throw new Error(`Not a sitemap: ${url}`);

  const urls = urlset === "" ? [] : (urlset.url ?? []);
  const entries = urls.flatMap((entry) => {
    const result = newsUrlSchema.safeParse(entry);
    if (!result.success) return [];
    const loc = result.data.loc.trim();
    if (!isAbsoluteHttpUrl(loc)) return [];
    return [
      {
        url: loc,
        title: result.data.news.title?.trim() || null,
        publishedAt: plausiblePublishedAt(result.data.news.publication_date),
      },
    ];
  });
  if (urls.length > 0 && entries.length === 0) {
    throw new Error(
      `No <news:news> entries in ${urls.length} URLs. Use the site's Google News sitemap: ${url}`,
    );
  }
  return { kind: "urlset", entries };
}

async function fetchSitemapText(url: string): Promise<string> {
  const response = await fetchPublicUrl(url, {
    headers: {
      "User-Agent": TOP_STORIES_USER_AGENT,
      Accept: "application/xml,text/xml;q=0.9,*/*;q=0.8",
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${url}`);
  }
  // .xml.gz files are usually served as a gzip file, not with
  // Content-Encoding (which fetch would already have decoded).
  const isGzipFile =
    (/\.gz$/i.test(new URL(response.url || url).pathname) ||
      /gzip/i.test(response.headers.get("content-type") ?? "")) &&
    !/gzip/i.test(response.headers.get("content-encoding") ?? "");
  const body =
    isGzipFile && response.body
      ? new Response(response.body.pipeThrough(new DecompressionStream("gzip")))
      : response;
  const text = await readBodyCapped(body, MAX_SITEMAP_BYTES);
  if (text === null) {
    throw new Error(`Sitemap is larger than 5 MB: ${url}`);
  }
  return text;
}

async function fetchSitemapDocument(url: string): Promise<SitemapDocument> {
  return parseSitemapDocument(await fetchSitemapText(url), url);
}

/**
 * Fetch a news sitemap's entries. A sitemap index is followed one level,
 * preferring children whose URL mentions "news".
 */
export async function fetchNewsSitemap(
  sitemapUrl: string,
): Promise<NewsSitemapEntry[]> {
  const document = await fetchSitemapDocument(sitemapUrl);
  if (document.kind === "urlset") return document.entries;

  const newsChildren = document.children.filter((child) => /news/i.test(child));
  const children = (
    newsChildren.length > 0 ? newsChildren : document.children
  ).slice(0, MAX_CHILD_SITEMAPS);
  if (children.length === 0) {
    throw new Error(`Sitemap index lists no sitemaps: ${sitemapUrl}`);
  }
  const documents = await Promise.all(children.map(fetchSitemapDocument));
  return documents.flatMap((child) =>
    child.kind === "urlset" ? child.entries : [],
  );
}
