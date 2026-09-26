import { Fragment, useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Loader2,
} from "lucide-react";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { TopicDetail } from "@/client/features/top-stories/TopicDetail";
import { topStoriesReportQuery } from "@/client/features/top-stories/queries";
import {
  formatMinutes,
  formatShare,
  localDayRange,
  OUTCOME_BADGES,
  shiftDay,
  SOURCE_LABELS,
  todayLocal,
} from "@/client/features/top-stories/format";
import { SLOW_CRAWL_MINUTES, SLOW_PUBLISH_MINUTES } from "@/shared/top-stories";
import type {
  TopStoriesReport,
  TopStoriesSiteRef,
  TopStoriesTopicRow,
} from "@/types/schemas/top-stories";

export function DailyReport({
  projectId,
  day,
  onDayChange,
}: {
  projectId: string;
  day: string;
  onDayChange: (day: string) => void;
}) {
  const range = useMemo(() => localDayRange(day), [day]);
  const reportQuery = useQuery({
    ...topStoriesReportQuery(projectId, range),
    placeholderData: keepPreviousData,
  });
  const report = reportQuery.data;
  const isToday = day === todayLocal();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          className="btn btn-sm btn-ghost btn-square"
          aria-label="Previous day"
          onClick={() => onDayChange(shiftDay(day, -1))}
        >
          <ChevronLeft className="size-4" />
        </button>
        <input
          type="date"
          className="input input-bordered input-sm w-40"
          value={day}
          max={todayLocal()}
          onChange={(event) => {
            if (event.target.value) onDayChange(event.target.value);
          }}
          aria-label="Report day"
        />
        <button
          className="btn btn-sm btn-ghost btn-square"
          aria-label="Next day"
          disabled={isToday}
          onClick={() => onDayChange(shiftDay(day, 1))}
        >
          <ChevronRight className="size-4" />
        </button>
        {!isToday ? (
          <button
            className="btn btn-sm btn-ghost"
            onClick={() => onDayChange(todayLocal())}
          >
            Today
          </button>
        ) : null}
        {reportQuery.isFetching ? (
          <Loader2 className="size-4 animate-spin text-base-content/40" />
        ) : null}
      </div>

      {reportQuery.isError ? (
        <div className="alert alert-error">
          <span className="text-sm">
            {getStandardErrorMessage(reportQuery.error)}
          </span>
        </div>
      ) : !report ? (
        <div className="skeleton h-40 w-full" />
      ) : (
        <>
          <PresenceTiles report={report} />
          <TopicsTable projectId={projectId} report={report} />
        </>
      )}
    </div>
  );
}

function siteLabel(site: TopStoriesSiteRef | undefined) {
  return site ? site.domain : "—";
}

export function PresenceTiles({ report }: { report: TopStoriesReport }) {
  if (report.sites.length === 0) return null;
  const { carouselTopicCount, topicCount } = report.analysis;
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        {report.presence.map((presence) => {
          const site = report.sites.find((s) => s.id === presence.siteId);
          return (
            <div
              key={presence.siteId}
              className={`rounded-lg border bg-base-100 p-4 ${site?.isOwn ? "border-primary/50" : "border-base-300"}`}
            >
              <div className="flex items-center gap-1.5 text-xs text-base-content/60">
                <span className="truncate">{siteLabel(site)}</span>
                {site?.isOwn ? (
                  <span className="badge badge-primary badge-xs">You</span>
                ) : null}
              </div>
              <div className="mt-1 text-2xl font-semibold">
                {formatShare(presence.share)}
              </div>
              <div className="text-xs text-base-content/50">
                in Top Stories for {presence.topics} of {carouselTopicCount}{" "}
                topics
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-base-content/50">
        Share of presence counts topics where the site appeared in the carousel
        at least once. {topicCount - carouselTopicCount} of {topicCount} topics
        never showed a Top Stories box and are left out.
      </p>
    </div>
  );
}

function fastestCompetitor(
  row: TopStoriesTopicRow,
  sites: TopStoriesSiteRef[],
) {
  let best: { site: TopStoriesSiteRef; delay: number } | null = null;
  for (const result of row.sites) {
    const site = sites.find((s) => s.id === result.siteId);
    if (!site || site.isOwn || result.publishDelayMinutes === null) continue;
    if (!best || result.publishDelayMinutes < best.delay) {
      best = { site, delay: result.publishDelayMinutes };
    }
  }
  return best;
}

function TopicsTable({
  projectId,
  report,
}: {
  projectId: string;
  report: TopStoriesReport;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const ownSite = report.sites.find((site) => site.isOwn);

  if (report.topics.length === 0) {
    return (
      <div className="rounded-xl border border-base-300 bg-base-100 px-5 py-10 text-center text-sm text-base-content/60">
        No topics were tracked on this day.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-base-300 bg-base-100">
      <table className="table table-sm">
        <thead>
          <tr>
            <th>Topic</th>
            <th>Result</th>
            <th>First to publish</th>
            <th>Our delay</th>
            <th>Fastest competitor</th>
            <th title="Minutes from our publication to Googlebot's first fetch">
              Googlebot after publish
            </th>
            <th>In Top Stories</th>
          </tr>
        </thead>
        <tbody>
          {report.topics.map((row) => {
            const own = row.sites.find((s) => s.siteId === ownSite?.id);
            const competitor = fastestCompetitor(row, report.sites);
            const expanded = expandedId === row.id;
            const badge = OUTCOME_BADGES[row.outcome];
            const present = row.sites
              .filter((s) => s.inTopStories)
              .map((s) => ({
                result: s,
                site: report.sites.find((site) => site.id === s.siteId),
              }));
            return (
              <Fragment key={row.id}>
                <tr
                  className="cursor-pointer hover:bg-base-200/60"
                  onClick={() => setExpandedId(expanded ? null : row.id)}
                  aria-expanded={expanded}
                >
                  <td className="max-w-xs">
                    <div className="flex items-start gap-1.5">
                      <ChevronDown
                        className={`mt-0.5 size-3.5 shrink-0 transition-transform ${expanded ? "" : "-rotate-90"}`}
                      />
                      <div className="min-w-0">
                        <div dir="auto" className="font-medium">
                          {row.query}
                        </div>
                        <div className="flex flex-wrap items-center gap-1 text-xs text-base-content/50">
                          <span>{SOURCE_LABELS[row.source]}</span>
                          <span>·</span>
                          <span>
                            {row.isTracking ? "Tracking" : "Done"},{" "}
                            {row.snapshotCount} checks
                          </span>
                          {row.lastError ? (
                            <span title={`Last check failed: ${row.lastError}`}>
                              <AlertTriangle className="size-3 text-warning" />
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span
                      className={`badge badge-sm whitespace-nowrap ${badge.className}`}
                    >
                      {badge.label}
                    </span>
                  </td>
                  <td className="text-sm">
                    {row.firstPublisherSiteIds.length > 0
                      ? row.firstPublisherSiteIds
                          .map((id) =>
                            siteLabel(report.sites.find((s) => s.id === id)),
                          )
                          .join(", ")
                      : "—"}
                  </td>
                  <td
                    className={`text-sm tabular-nums ${
                      (own?.publishDelayMinutes ?? 0) > SLOW_PUBLISH_MINUTES
                        ? "text-error"
                        : ""
                    }`}
                  >
                    {formatMinutes(own?.publishDelayMinutes ?? null)}
                  </td>
                  <td className="text-sm">
                    {competitor ? (
                      <span className="tabular-nums">
                        {competitor.site.domain} ·{" "}
                        {formatMinutes(competitor.delay)}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td
                    className={`text-sm tabular-nums ${
                      (own?.crawlDelayMinutes ?? 0) > SLOW_CRAWL_MINUTES
                        ? "text-error"
                        : ""
                    }`}
                  >
                    {formatMinutes(own?.crawlDelayMinutes ?? null)}
                  </td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      {present.length === 0 ? (
                        <span className="text-sm text-base-content/40">—</span>
                      ) : (
                        present.map(({ result, site }) => (
                          <span
                            key={result.siteId}
                            className={`badge badge-sm ${site?.isOwn ? "badge-primary" : "badge-outline"}`}
                          >
                            {siteLabel(site)} #{result.bestPosition}
                          </span>
                        ))
                      )}
                    </div>
                  </td>
                </tr>
                {expanded ? (
                  <tr>
                    <td colSpan={7} className="bg-base-200/40">
                      <TopicDetail
                        projectId={projectId}
                        row={row}
                        sites={report.sites}
                      />
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
