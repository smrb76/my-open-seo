import { useForm } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { Download, Loader2, Square, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { formatRelativeTime } from "@/client/lib/relative-time";
import {
  type TopStoriesOverview,
  useInvalidateTopStories,
} from "@/client/features/top-stories/queries";
import {
  formatDateTime,
  SOURCE_LABELS,
} from "@/client/features/top-stories/format";
import {
  addTopStoriesTopics,
  deleteTopStoriesTopic,
  importTopStoriesTopics,
  stopTopStoriesTopic,
} from "@/serverFunctions/top-stories";

export function TopicsPanel({
  projectId,
  overview,
}: {
  projectId: string;
  overview: TopStoriesOverview;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <ActiveTopics projectId={projectId} overview={overview} />
      <div className="space-y-4">
        <AddTopicsCard projectId={projectId} />
        <ImportCard projectId={projectId} overview={overview} />
      </div>
    </div>
  );
}

function ActiveTopics({
  projectId,
  overview,
}: {
  projectId: string;
  overview: TopStoriesOverview;
}) {
  const invalidate = useInvalidateTopStories(projectId);
  const stopMutation = useMutation({
    mutationFn: (topicId: string) =>
      stopTopStoriesTopic({ data: { projectId, topicId } }),
    onSuccess: () => void invalidate(),
    onError: (error) => toast.error(getStandardErrorMessage(error)),
  });
  const deleteMutation = useMutation({
    mutationFn: (topicId: string) =>
      deleteTopStoriesTopic({ data: { projectId, topicId } }),
    onSuccess: () => void invalidate(),
    onError: (error) => toast.error(getStandardErrorMessage(error)),
  });

  return (
    <div className="card bg-base-100 border border-base-300">
      <div className="card-body gap-3 p-0">
        <div className="px-5 pt-4">
          <h2 className="text-sm font-semibold">
            Tracking now ({overview.activeTopics.length})
          </h2>
          <p className="text-xs text-base-content/50">
            Finished topics stay in the daily report.
          </p>
        </div>
        {overview.activeTopics.length === 0 ? (
          <p className="px-5 pb-5 text-sm text-base-content/60">
            Nothing is being tracked right now. New topics arrive from the
            sources you turned on, or add some yourself.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table table-sm">
              <thead>
                <tr>
                  <th>Topic</th>
                  <th>Source</th>
                  <th>Checks</th>
                  <th>Next check</th>
                  <th>Ends</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {overview.activeTopics.map((topic) => (
                  <tr key={topic.id}>
                    <td dir="auto" className="font-medium">
                      {topic.query}
                      {topic.lastError ? (
                        <div className="text-xs font-normal text-warning">
                          {topic.lastError}
                        </div>
                      ) : null}
                    </td>
                    <td className="text-xs">{SOURCE_LABELS[topic.source]}</td>
                    <td className="tabular-nums">{topic.snapshotCount}</td>
                    <td className="text-xs">
                      {topic.nextSnapshotAt
                        ? formatRelativeTime(topic.nextSnapshotAt)
                        : "—"}
                    </td>
                    <td className="text-xs">
                      {formatDateTime(topic.trackingEndsAt)}
                    </td>
                    <td>
                      <div className="flex justify-end gap-1">
                        <button
                          className="btn btn-ghost btn-xs btn-square"
                          title="Stop tracking (keeps its data)"
                          disabled={stopMutation.isPending}
                          onClick={() => stopMutation.mutate(topic.id)}
                        >
                          <Square className="size-3" />
                        </button>
                        <button
                          className="btn btn-ghost btn-xs btn-square"
                          title="Delete topic and its data"
                          disabled={deleteMutation.isPending}
                          onClick={() => deleteMutation.mutate(topic.id)}
                        >
                          <Trash2 className="size-3" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function AddTopicsCard({ projectId }: { projectId: string }) {
  const invalidate = useInvalidateTopStories(projectId);
  const addMutation = useMutation({
    mutationFn: (queries: string[]) =>
      addTopStoriesTopics({ data: { projectId, queries } }),
    onSuccess: (result) => {
      void invalidate();
      form.reset();
      toast.success(
        result.skipped > 0
          ? `Added ${result.added}; ${result.skipped} already tracked`
          : `Added ${result.added} topics`,
      );
    },
    onError: (error) => toast.error(getStandardErrorMessage(error)),
  });
  const form = useForm({
    defaultValues: { text: "" },
    onSubmit: ({ value }) => {
      const queries = value.text
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      if (queries.length > 0) addMutation.mutate(queries.slice(0, 50));
    },
  });

  return (
    <div className="card bg-base-100 border border-base-300">
      <form
        className="card-body gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
      >
        <h2 className="text-sm font-semibold">Add topics</h2>
        <form.Field name="text">
          {(field) => (
            <textarea
              dir="auto"
              className="textarea textarea-bordered min-h-28 w-full text-sm"
              placeholder={"One search query per line, e.g.\nزلزله کرمان"}
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value)}
            />
          )}
        </form.Field>
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-base-content/50">
            Sent to Google exactly as written.
          </span>
          <button
            type="submit"
            className="btn btn-primary btn-sm"
            disabled={addMutation.isPending}
          >
            {addMutation.isPending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : null}
            Track
          </button>
        </div>
      </form>
    </div>
  );
}

function ImportCard({
  projectId,
  overview,
}: {
  projectId: string;
  overview: TopStoriesOverview;
}) {
  const settings = overview.settings;
  const invalidate = useInvalidateTopStories(projectId);
  const importMutation = useMutation({
    mutationFn: (source: "google_trends" | "gsc") =>
      importTopStoriesTopics({ data: { projectId, source } }),
    onSuccess: (result) => {
      void invalidate();
      toast.success(`Imported ${result.added} new topics`);
    },
    onError: (error) => {
      void invalidate();
      toast.error(getStandardErrorMessage(error));
    },
  });
  if (!settings) return null;

  const sources = [
    {
      source: "google_trends" as const,
      label: `Google Trends (${settings.trendsGeo})`,
      enabled: settings.trendsImportEnabled,
      lastRunAt: settings.lastTrendsImportAt,
      error: settings.lastTrendsError,
      note: "Checked hourly.",
    },
    {
      source: "gsc" as const,
      label: "New Search Console queries",
      enabled: settings.gscImportEnabled,
      lastRunAt: settings.lastGscImportAt,
      error: overview.gscConnected
        ? settings.lastGscError
        : "Search Console isn't connected for this project.",
      note: "Checked every 2 hours.",
    },
  ];

  return (
    <div className="card bg-base-100 border border-base-300">
      <div className="card-body gap-3">
        <h2 className="text-sm font-semibold">Automatic sources</h2>
        {sources.map((item) => (
          <div key={item.source} className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm">
                {item.label}
                {!item.enabled ? (
                  <span className="badge badge-ghost badge-xs ml-1">off</span>
                ) : null}
              </span>
              <button
                className="btn btn-xs"
                disabled={importMutation.isPending}
                onClick={() => importMutation.mutate(item.source)}
              >
                <Download className="size-3" />
                Import now
              </button>
            </div>
            <div className="text-xs text-base-content/50">
              {item.enabled ? item.note : "Turned off in settings."}{" "}
              {item.lastRunAt
                ? `Last run ${formatRelativeTime(item.lastRunAt)}.`
                : null}
            </div>
            {item.error ? (
              <div className="text-xs text-warning">{item.error}</div>
            ) : null}
          </div>
        ))}
        <p className="text-xs text-base-content/50">
          Automatic sources add at most {settings.maxAutoTopicsPerDay} topics in
          any 24 hours.
        </p>
      </div>
    </div>
  );
}
