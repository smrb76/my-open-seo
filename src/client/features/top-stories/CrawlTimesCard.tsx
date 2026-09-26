import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  type TopStoriesOverview,
  useInvalidateTopStories,
} from "@/client/features/top-stories/queries";
import {
  type CrawlLogBatchResult,
  type CrawlLogUploadProgress,
  uploadCrawlLog,
} from "@/client/features/top-stories/crawlLogUpload";
import { importTopStoriesCrawlLog } from "@/serverFunctions/top-stories";

export function CrawlTimesCard({
  projectId,
  overview,
}: {
  projectId: string;
  overview: TopStoriesOverview;
}) {
  const invalidate = useInvalidateTopStories(projectId);
  const [verifyIps, setVerifyIps] = useState(true);
  const [progress, setProgress] = useState<CrawlLogUploadProgress | null>(null);
  const [result, setResult] = useState<CrawlLogBatchResult | null>(null);
  const uploadMutation = useMutation({
    mutationFn: (file: File) =>
      uploadCrawlLog({
        file,
        send: (lines) =>
          importTopStoriesCrawlLog({
            data: { projectId, lines, verifyGooglebotIps: verifyIps },
          }),
        onProgress: setProgress,
      }),
    onMutate: () => {
      setResult(null);
      setProgress(null);
    },
    onSuccess: (totals) => {
      setResult(totals);
      void invalidate();
    },
    onError: (error) => toast.error(getStandardErrorMessage(error)),
  });
  const hasOwnSite = overview.sites.some((site) => site.isOwn);

  return (
    <div className="card bg-base-100 border border-base-300">
      <div className="card-body gap-4">
        <div>
          <h2 className="text-sm font-semibold">Googlebot crawl times</h2>
          <p className="text-xs text-base-content/60">
            When Googlebot first fetched each of your tracked articles.
          </p>
        </div>

        <div className="space-y-1">
          <div className="text-sm font-medium">Search Console (automatic)</div>
          {overview.gscConnected ? (
            <p className="text-xs text-base-content/60">
              Connected. Your articles on tracked topics are checked with URL
              Inspection every 20 minutes during their first day, until a crawl
              shows up.
            </p>
          ) : (
            <p className="text-xs text-base-content/60">
              Not connected.{" "}
              <Link
                to="/p/$projectId/settings/integrations"
                params={{ projectId }}
                className="link"
              >
                Connect Search Console
              </Link>{" "}
              to record crawl times automatically.
            </p>
          )}
        </div>

        <div className="space-y-2">
          <div className="text-sm font-medium">Access log upload (exact)</div>
          <p className="text-xs text-base-content/60">
            Nginx/Apache combined format or JSON lines, plain or .gz. Only lines
            mentioning Googlebot leave your browser. Upload after your articles
            appear here; earlier crawl times always win.
          </p>
          <label className="label cursor-pointer justify-start gap-2 text-sm">
            <input
              type="checkbox"
              className="checkbox checkbox-sm"
              checked={verifyIps}
              onChange={(event) => setVerifyIps(event.target.checked)}
            />
            Only count Google&apos;s published Googlebot IPs
          </label>
          {verifyIps ? null : (
            <p className="text-xs text-warning">
              Without IP checks, anyone faking the Googlebot user agent counts
              as a crawl. Turn this off only if your log records a CDN&apos;s
              address instead of the visitor&apos;s.
            </p>
          )}
          <label
            className={`btn btn-sm w-fit ${!hasOwnSite || uploadMutation.isPending ? "btn-disabled" : ""}`}
          >
            {uploadMutation.isPending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Upload className="size-3.5" />
            )}
            Choose log file
            <input
              type="file"
              className="hidden"
              accept=".log,.txt,.gz,.json,.jsonl,text/plain"
              disabled={!hasOwnSite || uploadMutation.isPending}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) uploadMutation.mutate(file);
              }}
            />
          </label>
          {progress ? (
            <p className="text-xs text-base-content/60 tabular-nums">
              Scanned {progress.scannedLines.toLocaleString()} lines, sent{" "}
              {progress.sentLines.toLocaleString()} Googlebot lines
            </p>
          ) : null}
          {result ? (
            <p className="text-xs tabular-nums">
              {result.googlebotHits.toLocaleString()} Googlebot requests
              {verifyIps
                ? ` (${result.unverified.toLocaleString()} from non-Google IPs skipped)`
                : ""}
              ; {result.matchedArticles} tracked articles found,{" "}
              {result.updated} crawl times updated.
              {result.unparsed > 0
                ? ` ${result.unparsed.toLocaleString()} lines weren't in a recognized format.`
                : ""}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
