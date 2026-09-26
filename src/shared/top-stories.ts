import type {
  TopStoriesAnalysis,
  TopStoriesTopicSite,
} from "@/types/schemas/top-stories";

// Pure helpers for Top Stories tracking, shared by the scheduler, the report
// builder and the UI. See specs/0015-top-stories-tracking.md.

/** Bounds for the per-project settings form and its server validation. */
export const TOP_STORIES_LIMITS = {
  snapshotIntervalMinutes: { min: 10, max: 120 },
  trackingWindowHours: { min: 1, max: 24 },
  maxAutoTopicsPerDay: { min: 0, max: 200 },
  maxCompetitors: 10,
  maxQueryLength: 200,
} as const;

// Arabic-script letter variants that Persian sites mix freely. Folding them is
// what lets a Trends query typed with Arabic yeh/kaf match a title typed with
// the Persian letters. Alef variants (including alef madda) fold to a plain
// alef for the same reason. Escapes, because the pairs look identical.
const LETTER_FOLDS: Record<string, string> = {
  "\u064A": "\u06CC", // Arabic yeh → Persian yeh
  "\u0649": "\u06CC", // alef maksura → Persian yeh
  "\u0643": "\u06A9", // Arabic kaf → Persian keheh
  "\u0629": "\u0647", // teh marbuta → heh
  "\u06C0": "\u0647", // heh with yeh above → heh
  "\u0623": "\u0627", // alef with hamza above → alef
  "\u0625": "\u0627", // alef with hamza below → alef
  "\u0622": "\u0627", // alef with madda → alef
  "\u0671": "\u0627", // alef wasla → alef
  "\u0624": "\u0648", // waw with hamza → waw
};

// Zero of the Extended Arabic-Indic (Persian) and Arabic-Indic digit blocks.
const DIGIT_ZERO_CODES = [0x06f0, 0x0660];

function foldChar(char: string): string {
  const folded = LETTER_FOLDS[char];
  if (folded) return folded;
  const code = char.charCodeAt(0);
  for (const zero of DIGIT_ZERO_CODES) {
    if (code >= zero && code <= zero + 9) return String(code - zero);
  }
  return char;
}

/**
 * Fold Persian text for matching and de-duplication: unify letter variants and
 * digits, drop diacritics and tatweel, turn ZWNJ and punctuation into spaces,
 * lowercase Latin, and collapse whitespace.
 */
export function normalizePersianText(text: string): string {
  return (
    Array.from(text.normalize("NFC"), foldChar)
      .join("")
      // Harakat, hamza marks, superscript alef, tatweel, and bidi marks.
      .replace(/[\u064B-\u065F\u0670\u0640\u200E\u200F\u061C]/g, "")
      .replace(/\u200D/g, "")
      // ZWNJ separates a word from its suffix; split there so the stem is its
      // own token.
      .replace(/\u200C/g, " ")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim()
  );
}

const STOPWORDS = new Set(
  [
    "و",
    "در",
    "به",
    "از",
    "که",
    "را",
    "با",
    "این",
    "آن",
    "برای",
    "تا",
    "یا",
    "هم",
    "اما",
    "است",
    "شد",
    "های",
    "ها",
  ].map(normalizePersianText),
);

function tokens(normalized: string): string[] {
  return normalized.split(" ").filter(Boolean);
}

/**
 * Whether an article title covers a topic query. Every meaningful query token
 * must appear in the title (one may be missing once the query has three or
 * more), either exactly or with a short suffix (ایران → ایرانی, ها-less
 * plurals). Both inputs are normalizePersianText output.
 */
export function titleMatchesQuery(
  normalizedQuery: string,
  normalizedTitle: string,
): boolean {
  const queryTokens = tokens(normalizedQuery);
  const meaningful = queryTokens.filter((token) => !STOPWORDS.has(token));
  const required = meaningful.length > 0 ? meaningful : queryTokens;
  if (required.length === 0) return false;

  const titleTokens = tokens(normalizedTitle);
  const matched = required.filter((q) =>
    titleTokens.some(
      (t) =>
        t === q ||
        (q.length >= 3 && t.startsWith(q) && t.length - q.length <= 3),
    ),
  ).length;
  const needed = required.length <= 2 ? required.length : required.length - 1;
  return matched >= needed;
}

/** The query token most selective for a SQL LIKE pre-filter (the longest). */
export function longestQueryToken(normalizedQuery: string): string | null {
  const all = tokens(normalizedQuery);
  const meaningful = all.filter((token) => !STOPWORDS.has(token));
  const pool = meaningful.length > 0 ? meaningful : all;
  return pool.reduce<string | null>(
    (longest, token) =>
      longest === null || token.length > longest.length ? token : longest,
    null,
  );
}

/** Bare host without www, lowercase. Null for unparseable input. */
export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** Whether a carousel card's host belongs to a tracked site's domain. */
export function hostMatchesDomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

function safeDecode(path: string): string {
  try {
    return decodeURI(path);
  } catch {
    return path;
  }
}

/**
 * Join key for article URLs from sitemaps, carousel cards and access logs:
 * host without www/amp, percent-decoded path without AMP segments or trailing
 * slash, no query or fragment. Null for unparseable input.
 */
export function normalizeArticleUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase().replace(/^(www|amp)\./, "");
  const segments = safeDecode(parsed.pathname).split("/").filter(Boolean);
  if (segments[0]?.toLowerCase() === "amp") segments.shift();
  if (segments.at(-1)?.toLowerCase() === "amp") segments.pop();
  return `${host}/${segments.join("/")}`;
}

/** Whole minutes from `from` to `to` (negative when `to` is earlier). */
export function minutesBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 60_000);
}

/** ISO string for a parseable date, else null. */
export function toIsoOrNull(value: string | null | undefined): string | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

/** Behind the first publisher by more than this counts as slow publishing. */
export const SLOW_PUBLISH_MINUTES = 5;
/** Googlebot arriving later than this after publication counts as slow. */
export const SLOW_CRAWL_MINUTES = 15;

export type TopStoriesLossCause = keyof TopStoriesAnalysis["lostCauses"];

/**
 * Why we likely lost a topic, in the order a newsroom would check: did we
 * cover it, did we publish late, did Googlebot arrive late. A loss with
 * neither delay points at the story itself: headline, image, topical
 * authority, or the competitor being the original source.
 */
export function classifyLoss(
  own: TopStoriesTopicSite | undefined,
): TopStoriesLossCause {
  if (!own?.article || own.publishDelayMinutes === null) return "notCovered";
  if (own.publishDelayMinutes > SLOW_PUBLISH_MINUTES) return "slowPublish";
  if (own.crawlDelayMinutes === null) return "noCrawlData";
  if (own.crawlDelayMinutes > SLOW_CRAWL_MINUTES) return "slowCrawl";
  return "other";
}

/** Next due time after a snapshot slot, or null once the window has closed. */
export function computeNextSnapshotAt(input: {
  dueAt: string;
  intervalMinutes: number;
  trackingEndsAt: string;
  now: Date;
}): string | null {
  const interval = input.intervalMinutes * 60_000;
  let next = Date.parse(input.dueAt) + interval;
  // Fell behind (outage, backlog): resume from now instead of bunching.
  if (next <= input.now.getTime()) next = input.now.getTime() + interval;
  return next > Date.parse(input.trackingEndsAt)
    ? null
    : new Date(next).toISOString();
}
