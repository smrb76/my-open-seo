import { isCrawlableUrl } from "@/server/lib/audit/url-policy";

const MAX_REDIRECTS = 3;

/**
 * fetch() for URLs that users or third parties control (sitemaps, article
 * pages): http(s) only, no private or internal hosts, and every redirect hop
 * re-checked so a 30x can't point the Worker inward. User-entered URLs also
 * pass the DNS-resolving normalizeAndValidateStartUrl check when saved.
 */
export async function fetchPublicUrl(
  url: string,
  init: Omit<RequestInit, "redirect">,
): Promise<Response> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!isCrawlableUrl(current)) {
      throw new Error(`Blocked URL: ${current}`);
    }
    const response = await fetch(current, { ...init, redirect: "manual" });
    const location =
      response.status >= 300 && response.status < 400
        ? response.headers.get("location")
        : null;
    if (!location) return response;
    current = new URL(location, current).toString();
  }
  throw new Error(`Too many redirects from ${url}`);
}
