# Top Stories tracking

## Status

Accepted. Built for news publishers competing in Google's Top Stories carousel, with defaults for Google Iran in Persian.

## What it does

A news desk wants three numbers for every breaking topic, side by side:

- **Share of presence.** In how many of the day's hot topics did we, and each competitor, appear in the Top Stories carousel?
- **Publication time.** When did we and each competitor publish the story, and how far behind the first publisher was everyone else?
- **Crawl and display time.** When did Googlebot first fetch our article, and when did it first show up in the carousel?

The Top Stories page in each project answers them:

- **Daily report.** One row per topic: result (won, lost, no carousel, only untracked publishers), first publisher, our delay, the fastest competitor's delay, minutes from our publication to Googlebot's first fetch, and who was in the carousel at which best position. Expanding a row shows every tracked site's article, its publication time and where that time came from, sitemap and crawl delays, when it first appeared in the carousel, and the carousel at every check.
- **Weekly analysis.** Share of presence per site over 7, 14 or 28 days; median publication and crawl delays on won versus lost topics; and a likely cause for each lost topic: published late (more than 5 minutes behind the first publisher), Googlebot came late (more than 15 minutes after publication), fast on both, missing crawl data, or no article of ours matched. The page names the dominant cause once there are enough losses and states that this is correlation, not proof.
- **Topics.** Topics being tracked, a box to add queries by hand, and import-now buttons for the automatic sources.
- **Sites and settings.** Our site and up to ten competitors with their news sitemaps, a sitemap test button, the tracking settings, and access-log upload.

Nothing runs until a project turns tracking on. It can be paused at any time.

## How it works

**Topics.** A topic is a search query tracked for a window (default 6 hours) from when it is added, with a SERP check at a fixed interval (default 30 minutes). Topics come from three places: the Google Trends "Trending now" RSS feed for a country (hourly), queries that brought the site Search Console impressions in the last two days but none in the two weeks before (every two hours), and manual entry. Automatic sources share a rolling 24-hour cap; manual topics are not capped. Queries are de-duplicated on a folded form of the text, so the same story arriving from Trends and Search Console, or typed with Arabic rather than Persian letters, is tracked once. A partial unique index allows one actively tracked topic per query.

**SERP checks.** Each check is one Google organic SERP request through DataForSEO (depth 10, since the carousel only renders on page one), for the configured location, language and device. Every card in every `top_stories` block is stored with its position, host, URL, title, source name and the publication time Google displayed. A check with no carousel is stored too, so share of presence can leave out topics where Google showed no carousel at all. A due check is claimed with a compare-and-set on its due time before the request is made, so overlapping cron runs cannot pay for the same slot twice. A failed request still uses up its slot rather than retrying every five minutes. After a backlog, the schedule restarts from the current time instead of running the missed checks back to back.

**Publication times.** Each tracked site's Google News sitemap is read every five minutes and every entry with a `<news:news>` block is stored with its `publication_date`. Our own publication times come from our sitemap rather than from a CMS integration, which works for any CMS. A sitemap index is followed one level, preferring children whose URL mentions news; `.xml.gz` files are decompressed. A publication date that does not parse, or falls outside a plausible range (a Jalali year typed into the field, for example), is dropped rather than kept as a wildly wrong time. The time an article first appeared in the sitemap is recorded only while polling is continuous, so the first poll does not mark a backlog of old articles as just published. For our own site, that gives the delay between publication and the sitemap listing the article.

**Which article each site ran.** Every topic records one article per tracked site:

1. A carousel card from the site's host (or a subdomain) is authoritative. If no sitemap listed that URL, the article is stored from the card, and the page's schema.org `datePublished` or `article:published_time` replaces the card's approximate time when available.
2. Otherwise the site's earliest article whose title covers the query, published from three hours before the earliest carousel story (or a day before the topic was added, when there is no carousel yet) to the end of the tracking window. Titles and queries are compared in a folded form: Arabic and Persian letter variants, Persian and Arabic-Indic digits, diacritics, tatweel and ZWNJ are unified, and a token may carry a short suffix. Every token of a one- or two-word query must appear, and one may be missing from longer queries. A SQL `LIKE` on the longest token filters candidates before the full rule runs.
3. A user can pin an article for a site, and automatic matching never replaces a pinned article. Clearing the pin runs matching again.

The event time for a topic is the earliest publication among the tracked sites' articles, and every site's delay is measured from it. Article URLs from sitemaps, cards and access logs are joined on a key that drops `www.` and `amp.`, AMP path segments, the query string and the trailing slash, and decodes percent-escapes, so Persian slugs match whether or not they are encoded.

**Crawl times.** The first Googlebot fetch of our articles comes from two places, and the earliest time wins:

- Search Console URL Inspection, for our articles tied to topics from the last day, every 20 minutes until a crawl time appears. The first `lastCrawlTime` observed is the estimate of the first crawl, since later inspections only report recrawls.
- Uploaded access logs in the combined log format or as JSON lines, plain or gzipped. The browser streams the file and sends only lines that mention Googlebot, in batches. By default a hit counts only if its IP is in Google's published Googlebot ranges, because anyone can send a Googlebot user agent. Verification can be turned off for logs that record a CDN's address instead of the client's.

**Scheduling.** Everything runs on the existing five-minute cron, alongside rank checks and in its own `waitUntil`, so neither can delay or fail the other. Each stage (sitemaps, topic imports, SERP checks, crawl checks) is capped per run and whatever is left waits for the next run. The daily cron removes topics and articles older than 90 days. Docker self-hosts, where nothing runs the Worker's cron triggers, get a small background loop that calls the local scheduled-handler endpoint on the same schedule, which also makes scheduled rank tracking work there.

**Outbound requests.** Sitemaps, robots.txt and article pages are fetched only over http(s), never from private or internal hosts, and with each redirect checked again. User-entered URLs also pass the DNS-resolving check the site audit uses before they are saved.

## Alternatives considered

- **Reading publication times from the CMS database.** It needs a connector per CMS and database access, and it only covers our own site. The news sitemap has the same time for every publisher and is already published for Google.
- **Taking publication times only from the carousel card.** Google displays relative times ("3 hours ago"), which are too coarse to measure delays of a few minutes. Card times are kept as a last resort and marked as approximate.
- **Matching topics to articles by title only.** The carousel says which article Google actually associated with the query, so it wins whenever it exists.
- **Server logs as the only crawl-time source.** Many news sites sit behind a CDN, logs are large, and uploads are manual. URL Inspection is automatic once Search Console is connected. Logs stay available as the more exact source.
- **The DataForSEO task queue for checks.** It is cheaper per request, but results arrive minutes later and need task polling. Live requests keep a check's time close to its slot, which is what the first-seen measurements depend on.
- **Reusing the project's competitor list.** That list is context for AI agents and has no sitemap URLs; the Top Stories sites carry per-site polling state.
- **A Workflow per topic.** Each check is a single request, so the cron tick with per-stage caps is enough.

## Not in scope

An API endpoint for pushing log lines from a server, reverse-DNS verification of Googlebot, Discover and Google News tab tracking, alerts when a competitor enters the carousel, and a Persian-language interface.
