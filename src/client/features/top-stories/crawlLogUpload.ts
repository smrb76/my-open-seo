import { CRAWL_LOG_LINES_PER_REQUEST } from "@/types/schemas/top-stories";

// Streams an access log (plain or .gz) through the browser, keeping only lines
// that mention Googlebot, and sends them to the server in batches. A day of a
// busy news site's log is gigabytes; the Googlebot lines are a sliver of it.

export interface CrawlLogBatchResult {
  lines: number;
  unparsed: number;
  googlebotHits: number;
  unverified: number;
  matchedArticles: number;
  updated: number;
}

export interface CrawlLogUploadProgress {
  scannedLines: number;
  sentLines: number;
}

export async function uploadCrawlLog(input: {
  file: File;
  send: (lines: string[]) => Promise<CrawlLogBatchResult>;
  onProgress: (progress: CrawlLogUploadProgress) => void;
}): Promise<CrawlLogBatchResult> {
  const totals: CrawlLogBatchResult = {
    lines: 0,
    unparsed: 0,
    googlebotHits: 0,
    unverified: 0,
    matchedArticles: 0,
    updated: 0,
  };
  const progress: CrawlLogUploadProgress = { scannedLines: 0, sentLines: 0 };
  let batch: string[] = [];

  const flush = async () => {
    if (batch.length === 0) return;
    const result = await input.send(batch);
    totals.lines += result.lines;
    totals.unparsed += result.unparsed;
    totals.googlebotHits += result.googlebotHits;
    totals.unverified += result.unverified;
    totals.matchedArticles += result.matchedArticles;
    totals.updated += result.updated;
    progress.sentLines += batch.length;
    batch = [];
    input.onProgress({ ...progress });
  };

  const bytes = input.file.name.toLowerCase().endsWith(".gz")
    ? input.file.stream().pipeThrough(new DecompressionStream("gzip"))
    : input.file.stream();
  const reader = bytes.pipeThrough(new TextDecoderStream()).getReader();
  let carry = "";
  let lastReportAt = 0;
  for (;;) {
    const { done, value } = await reader.read();
    const text = carry + (value ?? "");
    const lines = text.split("\n");
    carry = done ? "" : (lines.pop() ?? "");
    for (const line of lines) {
      progress.scannedLines++;
      if (!/googlebot/i.test(line)) continue;
      // The server caps line length; a log line is never legitimately longer.
      batch.push(line.slice(0, 8000));
      if (batch.length >= CRAWL_LOG_LINES_PER_REQUEST) await flush();
    }
    if (done) break;
    // Throttled: a multi-GB file is tens of thousands of chunks.
    if (Date.now() - lastReportAt > 250) {
      lastReportAt = Date.now();
      input.onProgress({ ...progress });
    }
  }
  await flush();
  input.onProgress({ ...progress });
  return totals;
}
