import { Parser } from "htmlparser2";
import { readBodyCapped } from "@/server/lib/audit/discovery";
import { fetchPublicUrl } from "@/server/features/top-stories/publicFetch";
import { TOP_STORIES_USER_AGENT } from "@/server/features/top-stories/newsSitemap";
import { toIsoOrNull } from "@/shared/top-stories";

// Publication time from an article page itself, for articles no sitemap
// listed: schema.org datePublished (JSON-LD), else the article:published_time
// meta tag.

const FETCH_TIMEOUT_MS = 10_000;
const MAX_PAGE_BYTES = 3 * 1024 * 1024;

const PUBLISHED_META_KEYS = new Set([
  "article:published_time",
  "datepublished",
  "pubdate",
  "publishdate",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function findDatePublished(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findDatePublished(entry);
      if (found) return found;
    }
    return null;
  }
  if (!isRecord(value)) return null;
  const direct = value["datePublished"];
  if (typeof direct === "string" && toIsoOrNull(direct)) {
    return toIsoOrNull(direct);
  }
  return findDatePublished(value["@graph"] ?? value["mainEntity"] ?? null);
}

interface ArticlePageMeta {
  publishedAt: string | null;
  title: string | null;
}

function extractArticlePageMeta(html: string): ArticlePageMeta {
  // Written from parser callbacks, so kept on an object: TypeScript doesn't
  // track assignments made inside closures.
  const meta: { published: string | null; ogTitle: string | null } = {
    published: null,
    ogTitle: null,
  };
  let title = "";
  let inTitle = false;
  let inJsonLd = false;
  let jsonLdText = "";
  const jsonLdBlocks: string[] = [];

  const parser = new Parser({
    onopentag(name, attribs) {
      if (name === "meta") {
        const key = (
          attribs["property"] ??
          attribs["name"] ??
          attribs["itemprop"] ??
          ""
        ).toLowerCase();
        if (PUBLISHED_META_KEYS.has(key) && attribs["content"]) {
          meta.published ??= toIsoOrNull(attribs["content"]);
        }
        if (key === "og:title" && attribs["content"]) {
          meta.ogTitle ??= attribs["content"];
        }
      } else if (name === "title") {
        inTitle = true;
      } else if (
        name === "script" &&
        attribs["type"]?.toLowerCase() === "application/ld+json"
      ) {
        inJsonLd = true;
        jsonLdText = "";
      }
    },
    ontext(text) {
      if (inTitle) title += text;
      if (inJsonLd) jsonLdText += text;
    },
    onclosetag(name) {
      if (name === "title") inTitle = false;
      if (name === "script" && inJsonLd) {
        inJsonLd = false;
        jsonLdBlocks.push(jsonLdText);
      }
    },
  });
  parser.write(html);
  parser.end();

  let schemaPublished: string | null = null;
  for (const block of jsonLdBlocks) {
    try {
      schemaPublished = findDatePublished(JSON.parse(block));
    } catch {
      // Malformed JSON-LD is common; fall through to the next block.
    }
    if (schemaPublished) break;
  }

  return {
    publishedAt: schemaPublished ?? meta.published,
    title: meta.ogTitle?.trim() || title.trim() || null,
  };
}

export async function fetchArticlePageMeta(
  url: string,
): Promise<ArticlePageMeta> {
  const response = await fetchPublicUrl(url, {
    headers: {
      "User-Agent": TOP_STORIES_USER_AGENT,
      Accept: "text/html,application/xhtml+xml",
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`);
  const html = await readBodyCapped(response, MAX_PAGE_BYTES);
  if (html === null) throw new Error(`Page is larger than 3 MB: ${url}`);
  return extractArticlePageMeta(html);
}
