import { queryOptions, useQueryClient } from "@tanstack/react-query";
import {
  getTopStoriesOverview,
  getTopStoriesReport,
  getTopStoriesTopicSnapshots,
} from "@/serverFunctions/top-stories";

export function topStoriesOverviewQuery(projectId: string) {
  return queryOptions({
    queryKey: ["topStories", projectId, "overview"],
    queryFn: () => getTopStoriesOverview({ data: { projectId } }),
  });
}

export function topStoriesReportQuery(
  projectId: string,
  range: { from: string; to: string },
) {
  return queryOptions({
    queryKey: ["topStories", projectId, "report", range.from, range.to],
    queryFn: () => getTopStoriesReport({ data: { projectId, ...range } }),
    // Snapshots land every few minutes while topics are tracked.
    refetchInterval: 5 * 60_000,
  });
}

export function topStoriesSnapshotsQuery(projectId: string, topicId: string) {
  return queryOptions({
    queryKey: ["topStories", projectId, "snapshots", topicId],
    queryFn: () =>
      getTopStoriesTopicSnapshots({ data: { projectId, topicId } }),
  });
}

export type TopStoriesOverview = Awaited<
  ReturnType<typeof getTopStoriesOverview>
>;

/** Refetch everything Top Stories shows for a project after a change. */
export function useInvalidateTopStories(projectId: string) {
  const queryClient = useQueryClient();
  return () =>
    queryClient.invalidateQueries({ queryKey: ["topStories", projectId] });
}
