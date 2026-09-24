import { useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { PresenceTiles } from "@/client/features/top-stories/DailyReport";
import { topStoriesReportQuery } from "@/client/features/top-stories/queries";
import {
  formatMinutes,
  localDayRange,
  LOSS_CAUSE_LABELS,
  shiftDay,
  todayLocal,
} from "@/client/features/top-stories/format";
import {
  SLOW_CRAWL_MINUTES,
  SLOW_PUBLISH_MINUTES,
  type TopStoriesLossCause,
} from "@/shared/top-stories";
import type { TopStoriesAnalysis } from "@/types/schemas/top-stories";

const RANGE_DAYS = [7, 14, 28] as const;
type RangeDays = (typeof RANGE_DAYS)[number];

// Below this many lost topics a "main cause" is anecdote, not a pattern.
const MIN_LOSSES_FOR_FINDING = 5;

export function WeeklyAnalysis({ projectId }: { projectId: string }) {
  const [days, setDays] = useState<RangeDays>(7);
  const range = useMemo(() => {
    const today = todayLocal();
    return {
      from: localDayRange(shiftDay(today, -(days - 1))).from,
      to: localDayRange(today).to,
    };
  }, [days]);
  const reportQuery = useQuery({
    ...topStoriesReportQuery(projectId, range),
    placeholderData: keepPreviousData,
  });
  const report = reportQuery.data;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <select
          className="select select-bordered select-sm w-40"
          value={days}
          onChange={(event) => {
            const next = RANGE_DAYS.find(
              (value) => value === Number(event.target.value),
            );
            if (next) setDays(next);
          }}
          aria-label="Analysis period"
        >
          {RANGE_DAYS.map((value) => (
            <option key={value} value={value}>
              Last {value} days
            </option>
          ))}
        </select>
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
          <WinLossCard analysis={report.analysis} />
        </>
      )}
    </div>
  );
}

function mainCause(analysis: TopStoriesAnalysis): TopStoriesLossCause | null {
  const { slowPublish, slowCrawl, other } = analysis.lostCauses;
  const ranked: Array<[TopStoriesLossCause, number]> = [
    ["slowPublish", slowPublish],
    ["slowCrawl", slowCrawl],
    ["other", other],
  ];
  const [cause, count] = ranked.reduce((best, entry) =>
    entry[1] > best[1] ? entry : best,
  );
  return count > 0 ? cause : null;
}

function Finding({ analysis }: { analysis: TopStoriesAnalysis }) {
  const { won, lost } = analysis;
  if (lost.count === 0) {
    return (
      <p className="text-sm">
        No lost topics in this period: whenever a competitor made the carousel,
        so did you.
      </p>
    );
  }
  if (lost.count < MIN_LOSSES_FOR_FINDING) {
    return (
      <p className="text-sm text-base-content/70">
        Only {lost.count} lost topics so far. Patterns become reliable after a
        few dozen; keep tracking.
      </p>
    );
  }
  switch (mainCause(analysis)) {
    case "slowPublish":
      return (
        <p className="text-sm">
          <strong>Newsroom speed is the main gap.</strong> Most losses came
          after publishing more than {SLOW_PUBLISH_MINUTES} minutes behind the
          first publisher: a median of{" "}
          {formatMinutes(lost.medianPublishDelayMinutes)} behind on lost topics,
          against {formatMinutes(won.medianPublishDelayMinutes)} on won ones.
        </p>
      );
    case "slowCrawl":
      return (
        <p className="text-sm">
          <strong>The gap is technical: discovery.</strong> Most losses came
          despite publishing quickly, with Googlebot arriving more than{" "}
          {SLOW_CRAWL_MINUTES} minutes after publication. Check how fast the
          news sitemap updates, caching in front of it, and internal links to
          new articles.
        </p>
      );
    case "other":
      return (
        <p className="text-sm">
          <strong>The gap is in the story itself.</strong> Most losses came
          despite publishing quickly and being crawled quickly. Look at the
          headline, the lead image, topical authority, and whether the
          competitor was the original source.
        </p>
      );
    default:
      return (
        <p className="text-sm text-base-content/70">
          Not enough publication or crawl data on lost topics to name a cause.
          Check that your news sitemap is set up and Search Console is
          connected.
        </p>
      );
  }
}

const CAUSE_ORDER: TopStoriesLossCause[] = [
  "slowPublish",
  "slowCrawl",
  "other",
  "noCrawlData",
  "notCovered",
];

function WinLossCard({ analysis }: { analysis: TopStoriesAnalysis }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="card bg-base-100 border border-base-300">
        <div className="card-body gap-3">
          <h2 className="text-sm font-semibold">Won vs lost topics</h2>
          <table className="table table-sm">
            <thead>
              <tr>
                <th />
                <th>Won</th>
                <th>Lost</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Topics</td>
                <td className="tabular-nums">{analysis.won.count}</td>
                <td className="tabular-nums">{analysis.lost.count}</td>
              </tr>
              <tr>
                <td>Median publish delay</td>
                <td className="tabular-nums">
                  {formatMinutes(analysis.won.medianPublishDelayMinutes)}
                </td>
                <td className="tabular-nums">
                  {formatMinutes(analysis.lost.medianPublishDelayMinutes)}
                </td>
              </tr>
              <tr>
                <td>Median Googlebot delay</td>
                <td className="tabular-nums">
                  {formatMinutes(analysis.won.medianCrawlDelayMinutes)}
                </td>
                <td className="tabular-nums">
                  {formatMinutes(analysis.lost.medianCrawlDelayMinutes)}
                </td>
              </tr>
            </tbody>
          </table>
          <p className="text-xs text-base-content/50">
            Won: you appeared in the carousel. Lost: you didn&apos;t but a
            tracked competitor did. {analysis.topicCount} topics in total,{" "}
            {analysis.carouselTopicCount} with a Top Stories box.
          </p>
        </div>
      </div>

      <div className="card bg-base-100 border border-base-300">
        <div className="card-body gap-3">
          <h2 className="text-sm font-semibold">Why topics were lost</h2>
          <ul className="space-y-1 text-sm">
            {CAUSE_ORDER.map((cause) => (
              <li key={cause} className="flex justify-between gap-4">
                <span>{LOSS_CAUSE_LABELS[cause]}</span>
                <span className="tabular-nums font-medium">
                  {analysis.lostCauses[cause]}
                </span>
              </li>
            ))}
          </ul>
          <Finding analysis={analysis} />
          <p className="text-xs text-base-content/50">
            This shows correlation, not proof. When the same pattern repeats
            across dozens of topics, it is a sound basis for a decision.
          </p>
        </div>
      </div>
    </div>
  );
}
