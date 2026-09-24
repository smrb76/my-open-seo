import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { TopStoriesPage } from "@/client/features/top-stories/TopStoriesPage";
import { todayLocal } from "@/client/features/top-stories/format";

const topStoriesSearchSchema = z.object({
  tab: z.enum(["daily", "weekly", "topics", "setup"]).optional(),
  // YYYY-MM-DD in the viewer's timezone; omitted means today.
  day: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export const Route = createFileRoute("/_project/p/$projectId/top-stories")({
  validateSearch: topStoriesSearchSchema,
  component: TopStoriesRoute,
});

function TopStoriesRoute() {
  const { projectId } = Route.useParams();
  const { tab = "daily", day } = Route.useSearch();
  const navigate = Route.useNavigate();

  return (
    <TopStoriesPage
      projectId={projectId}
      tab={tab}
      day={day ?? todayLocal()}
      onTabChange={(next) =>
        void navigate({ search: (prev) => ({ ...prev, tab: next }) })
      }
      onDayChange={(next) =>
        void navigate({
          search: (prev) => ({
            ...prev,
            day: next === todayLocal() ? undefined : next,
          }),
        })
      }
    />
  );
}
