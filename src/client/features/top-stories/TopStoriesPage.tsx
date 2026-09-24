import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2, Newspaper, PauseCircle } from "lucide-react";
import { toast } from "sonner";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { DailyReport } from "@/client/features/top-stories/DailyReport";
import { WeeklyAnalysis } from "@/client/features/top-stories/WeeklyAnalysis";
import { TopicsPanel } from "@/client/features/top-stories/TopicsPanel";
import { SetupPanel } from "@/client/features/top-stories/SetupPanel";
import {
  topStoriesOverviewQuery,
  useInvalidateTopStories,
} from "@/client/features/top-stories/queries";
import {
  enableTopStories,
  updateTopStoriesSettings,
} from "@/serverFunctions/top-stories";

type TopStoriesTab = "daily" | "weekly" | "topics" | "setup";

const TABS: Array<{ value: TopStoriesTab; label: string }> = [
  { value: "daily", label: "Daily report" },
  { value: "weekly", label: "Weekly analysis" },
  { value: "topics", label: "Topics" },
  { value: "setup", label: "Sites & settings" },
];

export function TopStoriesPage({
  projectId,
  tab,
  day,
  onTabChange,
  onDayChange,
}: {
  projectId: string;
  tab: TopStoriesTab;
  day: string;
  onTabChange: (tab: TopStoriesTab) => void;
  onDayChange: (day: string) => void;
}) {
  const overviewQuery = useQuery(topStoriesOverviewQuery(projectId));
  const overview = overviewQuery.data;

  return (
    <div className="px-4 py-4 pb-24 overflow-auto md:px-6 md:py-6 md:pb-8">
      <div className="mx-auto max-w-7xl space-y-4">
        <div>
          <h1 className="text-2xl font-semibold">Top Stories</h1>
          <p className="text-sm text-base-content/70">
            Who wins Google&apos;s Top Stories carousel for breaking news, how
            fast each publisher shipped the story, and when Googlebot arrived.
          </p>
        </div>

        {overviewQuery.isPending ? (
          <div className="flex justify-center py-16">
            <Loader2 className="size-6 animate-spin text-base-content/40" />
          </div>
        ) : overviewQuery.isError ? (
          <div className="alert alert-error">
            <span className="text-sm">
              {getStandardErrorMessage(overviewQuery.error)}
            </span>
          </div>
        ) : !overview?.settings ? (
          <EnableCard projectId={projectId} />
        ) : (
          <>
            {!overview.settings.isActive ? (
              <PausedBanner projectId={projectId} />
            ) : null}
            {!overview.sites.some((site) => site.isOwn) ||
            overview.sites.length < 2 ? (
              <div className="alert alert-info">
                <span className="text-sm">
                  Add your own site and at least one competitor, each with its
                  news sitemap, so publication times and the race can be
                  measured.
                </span>
                <button
                  className="btn btn-sm"
                  onClick={() => onTabChange("setup")}
                >
                  Open setup
                </button>
              </div>
            ) : null}

            <div role="tablist" className="tabs tabs-border w-fit">
              {TABS.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  role="tab"
                  aria-selected={tab === item.value}
                  className={`tab ${tab === item.value ? "tab-active" : ""}`}
                  onClick={() => onTabChange(item.value)}
                >
                  {item.label}
                </button>
              ))}
            </div>

            {tab === "daily" ? (
              <DailyReport
                projectId={projectId}
                day={day}
                onDayChange={onDayChange}
              />
            ) : tab === "weekly" ? (
              <WeeklyAnalysis projectId={projectId} />
            ) : tab === "topics" ? (
              <TopicsPanel projectId={projectId} overview={overview} />
            ) : (
              <SetupPanel projectId={projectId} overview={overview} />
            )}
          </>
        )}
      </div>
    </div>
  );
}

function EnableCard({ projectId }: { projectId: string }) {
  const invalidate = useInvalidateTopStories(projectId);
  const enableMutation = useMutation({
    mutationFn: () => enableTopStories({ data: { projectId } }),
    onSuccess: () => {
      void invalidate();
      toast.success("Top Stories tracking is on");
    },
    onError: (error) => toast.error(getStandardErrorMessage(error)),
  });

  return (
    <div className="card bg-base-100 border border-base-300 max-w-3xl">
      <div className="card-body gap-4">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-base-200">
            <Newspaper className="size-5 text-base-content/60" />
          </div>
          <h2 className="text-lg font-semibold">Track the Top Stories race</h2>
        </div>
        <ul className="list-disc space-y-1 pl-5 text-sm text-base-content/80">
          <li>
            Hot topics come from Google Trends and new Search Console queries,
            or you add them yourself. Each one is checked on Google every 30
            minutes for its first 6 hours.
          </li>
          <li>
            Your and your competitors&apos; news sitemaps are read every 5
            minutes for exact publication times, so every topic shows who
            published first and how far behind everyone else was.
          </li>
          <li>
            Googlebot&apos;s first visit to your articles comes from Search
            Console URL Inspection or your uploaded access logs.
          </li>
        </ul>
        <p className="text-sm text-base-content/60">
          Each check is one DataForSEO search request (about $0.002). At 40
          topics a day with 12 checks each, that is roughly $1 a day. Limits are
          adjustable in settings.
        </p>
        <div>
          <button
            className="btn btn-primary"
            disabled={enableMutation.isPending}
            onClick={() => enableMutation.mutate()}
          >
            {enableMutation.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : null}
            Turn on Top Stories tracking
          </button>
        </div>
      </div>
    </div>
  );
}

function PausedBanner({ projectId }: { projectId: string }) {
  const invalidate = useInvalidateTopStories(projectId);
  const resumeMutation = useMutation({
    mutationFn: () =>
      updateTopStoriesSettings({ data: { projectId, isActive: true } }),
    onSuccess: () => void invalidate(),
    onError: (error) => toast.error(getStandardErrorMessage(error)),
  });
  return (
    <div className="alert alert-warning">
      <PauseCircle className="size-5" />
      <span className="text-sm">
        Tracking is paused. No sitemaps are read and no searches are made.
      </span>
      <button
        className="btn btn-sm"
        disabled={resumeMutation.isPending}
        onClick={() => resumeMutation.mutate()}
      >
        Resume
      </button>
    </div>
  );
}
