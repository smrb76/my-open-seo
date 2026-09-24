import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ExternalLink, Pencil, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { getSafeExternalUrl } from "@/client/components/table/url";
import {
  topStoriesSnapshotsQuery,
  useInvalidateTopStories,
} from "@/client/features/top-stories/queries";
import {
  formatClock,
  formatDateTime,
  formatMinutes,
} from "@/client/features/top-stories/format";
import { setTopStoriesTopicArticle } from "@/serverFunctions/top-stories";
import { hostMatchesDomain } from "@/shared/top-stories";
import type {
  TopStoriesArticleView,
  TopStoriesSiteRef,
  TopStoriesTopicRow,
} from "@/types/schemas/top-stories";

const PUBLISHED_SOURCE_LABELS: Record<
  NonNullable<TopStoriesArticleView["publishedAtSource"]>,
  string
> = {
  sitemap: "news sitemap",
  page: "page schema",
  serp: "Google's card (approximate)",
};

const MATCH_LABELS: Record<TopStoriesArticleView["matchedBy"], string> = {
  carousel: "From the carousel",
  title: "Matched by title",
  manual: "Set manually",
};

export function TopicDetail({
  projectId,
  row,
  sites,
}: {
  projectId: string;
  row: TopStoriesTopicRow;
  sites: TopStoriesSiteRef[];
}) {
  return (
    <div className="space-y-4 py-2">
      <div className="text-xs text-base-content/60">
        Added {formatDateTime(row.createdAt)} · tracked until{" "}
        {formatDateTime(row.trackingEndsAt)} · Top Stories box in{" "}
        {row.carouselSnapshotCount} of {row.snapshotCount} checks
        {row.eventAt ? (
          <> · first publication {formatDateTime(row.eventAt)}</>
        ) : null}
        {row.lastError ? (
          <span className="text-warning">
            {" "}
            · last check failed: {row.lastError}
          </span>
        ) : null}
      </div>
      <SiteBreakdown projectId={projectId} row={row} sites={sites} />
      <SnapshotTimeline projectId={projectId} topicId={row.id} sites={sites} />
    </div>
  );
}

function SiteBreakdown({
  projectId,
  row,
  sites,
}: {
  projectId: string;
  row: TopStoriesTopicRow;
  sites: TopStoriesSiteRef[];
}) {
  const [editingSiteId, setEditingSiteId] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const invalidate = useInvalidateTopStories(projectId);
  const setArticleMutation = useMutation({
    mutationFn: (input: { siteId: string; url: string | null }) =>
      setTopStoriesTopicArticle({
        data: { projectId, topicId: row.id, ...input },
      }),
    onSuccess: () => {
      setEditingSiteId(null);
      void invalidate();
    },
    onError: (error) => toast.error(getStandardErrorMessage(error)),
  });

  return (
    <div className="overflow-x-auto rounded-lg border border-base-300 bg-base-100">
      <table className="table table-xs">
        <thead>
          <tr>
            <th>Site</th>
            <th>Article</th>
            <th>Published</th>
            <th>Behind first</th>
            <th title="Minutes from publication to first appearing in the site's news sitemap">
              In sitemap after
            </th>
            <th title="Minutes from publication to Googlebot's first fetch">
              Googlebot after
            </th>
            <th>Top Stories</th>
          </tr>
        </thead>
        <tbody>
          {row.sites.map((result) => {
            const site = sites.find((s) => s.id === result.siteId);
            const article = result.article;
            const editing = editingSiteId === result.siteId;
            return (
              <tr key={result.siteId}>
                <td className="whitespace-nowrap">
                  {site?.domain}
                  {site?.isOwn ? (
                    <span className="badge badge-primary badge-xs ml-1">
                      You
                    </span>
                  ) : null}
                </td>
                <td className="min-w-64">
                  {editing ? (
                    <form
                      className="flex gap-1"
                      onSubmit={(event) => {
                        event.preventDefault();
                        const trimmed = url.trim();
                        if (!trimmed) return;
                        setArticleMutation.mutate({
                          siteId: result.siteId,
                          url: trimmed,
                        });
                      }}
                    >
                      <input
                        className="input input-bordered input-xs w-full"
                        placeholder={`https://${site?.domain ?? ""}/...`}
                        value={url}
                        onChange={(event) => setUrl(event.target.value)}
                        autoFocus
                      />
                      <button
                        className="btn btn-xs btn-primary"
                        disabled={setArticleMutation.isPending}
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        className="btn btn-xs btn-ghost"
                        onClick={() => setEditingSiteId(null)}
                      >
                        Cancel
                      </button>
                    </form>
                  ) : (
                    <div className="flex items-start gap-1">
                      {article ? (
                        <a
                          href={getSafeExternalUrl(article.url) ?? undefined}
                          target="_blank"
                          rel="noreferrer"
                          className="link link-hover min-w-0"
                          title={MATCH_LABELS[article.matchedBy]}
                        >
                          <span dir="auto" className="line-clamp-2">
                            {article.title ?? article.url}
                          </span>
                        </a>
                      ) : (
                        <span className="text-base-content/40">
                          No matching article
                        </span>
                      )}
                      <button
                        className="btn btn-ghost btn-xs btn-square shrink-0"
                        title="Set the article for this site"
                        onClick={() => {
                          setUrl(article?.url ?? "");
                          setEditingSiteId(result.siteId);
                        }}
                      >
                        <Pencil className="size-3" />
                      </button>
                      {article?.matchedBy === "manual" ? (
                        <button
                          className="btn btn-ghost btn-xs btn-square shrink-0"
                          title="Back to automatic matching"
                          disabled={setArticleMutation.isPending}
                          onClick={() =>
                            setArticleMutation.mutate({
                              siteId: result.siteId,
                              url: null,
                            })
                          }
                        >
                          <RotateCcw className="size-3" />
                        </button>
                      ) : null}
                    </div>
                  )}
                </td>
                <td className="whitespace-nowrap tabular-nums">
                  {article?.publishedAt ? (
                    <span
                      title={
                        article.publishedAtSource
                          ? `From the ${PUBLISHED_SOURCE_LABELS[article.publishedAtSource]}`
                          : undefined
                      }
                    >
                      {formatClock(article.publishedAt)}
                      {article.publishedAtSource === "serp" ? " ≈" : ""}
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="tabular-nums">
                  {formatMinutes(result.publishDelayMinutes)}
                </td>
                <td className="tabular-nums">
                  {formatMinutes(result.sitemapDelayMinutes)}
                </td>
                <td
                  className="tabular-nums"
                  title={
                    article?.crawlSource === "log"
                      ? "From your access log"
                      : article?.crawlSource === "gsc"
                        ? "From Search Console URL Inspection"
                        : undefined
                  }
                >
                  {formatMinutes(result.crawlDelayMinutes)}
                </td>
                <td className="whitespace-nowrap">
                  {result.inTopStories ? (
                    <span>
                      #{result.bestPosition}, first seen{" "}
                      {formatClock(result.firstSeenAt)}
                      {result.carouselDelayMinutes !== null ? (
                        <span className="text-base-content/50">
                          {" "}
                          ({formatMinutes(result.carouselDelayMinutes)} after
                          publish)
                        </span>
                      ) : null}
                    </span>
                  ) : (
                    <span className="text-base-content/40">Not seen</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SnapshotTimeline({
  projectId,
  topicId,
  sites,
}: {
  projectId: string;
  topicId: string;
  sites: TopStoriesSiteRef[];
}) {
  const snapshotsQuery = useQuery(topStoriesSnapshotsQuery(projectId, topicId));
  if (snapshotsQuery.isPending) {
    return <div className="skeleton h-16 w-full" />;
  }
  if (snapshotsQuery.isError) {
    return (
      <p className="text-xs text-error">
        {getStandardErrorMessage(snapshotsQuery.error)}
      </p>
    );
  }
  const snapshots = snapshotsQuery.data;
  if (snapshots.length === 0) {
    return (
      <p className="text-xs text-base-content/50">
        No checks yet. The first one runs within 5 minutes of adding a topic.
      </p>
    );
  }
  return (
    <div className="space-y-1.5">
      <div className="text-xs font-medium text-base-content/60">
        Carousel at each check
      </div>
      {snapshots.map((snapshot) => (
        <div key={snapshot.id} className="flex items-start gap-3 text-xs">
          <span className="w-16 shrink-0 whitespace-nowrap tabular-nums text-base-content/60">
            {formatClock(snapshot.checkedAt)}
          </span>
          {snapshot.results.length === 0 ? (
            <span className="text-base-content/40">No Top Stories box</span>
          ) : (
            <div className="flex flex-wrap gap-1">
              {snapshot.results.map((result) => {
                const site = sites.find((s) =>
                  hostMatchesDomain(result.domain, s.domain),
                );
                return (
                  <a
                    key={result.position}
                    href={getSafeExternalUrl(result.url) ?? undefined}
                    target="_blank"
                    rel="noreferrer"
                    title={result.title ?? result.url}
                    className={`badge badge-sm gap-1 ${
                      site?.isOwn
                        ? "badge-primary"
                        : site
                          ? "badge-secondary badge-outline"
                          : "badge-ghost"
                    }`}
                  >
                    {result.position}. {result.domain}
                    <ExternalLink className="size-2.5" />
                  </a>
                );
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
