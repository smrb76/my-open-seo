import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import {
  CheckCircle2,
  Loader2,
  Plus,
  RefreshCw,
  Star,
  Trash2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { formatRelativeTime } from "@/client/lib/relative-time";
import {
  type TopStoriesOverview,
  useInvalidateTopStories,
} from "@/client/features/top-stories/queries";
import { CrawlTimesCard } from "@/client/features/top-stories/CrawlTimesCard";
import { TopStoriesSettingsForm } from "@/client/features/top-stories/TopStoriesSettingsForm";
import {
  addTopStoriesSite,
  deleteTopStoriesSite,
  fetchTopStoriesSiteNow,
  updateTopStoriesSite,
} from "@/serverFunctions/top-stories";
import { TOP_STORIES_LIMITS } from "@/shared/top-stories";

type Site = TopStoriesOverview["sites"][number];

export function SetupPanel({
  projectId,
  overview,
}: {
  projectId: string;
  overview: TopStoriesOverview;
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_26rem]">
      <div className="space-y-4">
        <SitesCard projectId={projectId} overview={overview} />
        <CrawlTimesCard projectId={projectId} overview={overview} />
      </div>
      {overview.settings ? (
        <TopStoriesSettingsForm
          projectId={projectId}
          settings={overview.settings}
          gscConnected={overview.gscConnected}
        />
      ) : null}
    </div>
  );
}

function SitesCard({
  projectId,
  overview,
}: {
  projectId: string;
  overview: TopStoriesOverview;
}) {
  const competitors = overview.sites.filter((site) => !site.isOwn).length;
  return (
    <div className="card bg-base-100 border border-base-300">
      <div className="card-body gap-4">
        <div>
          <h2 className="text-sm font-semibold">Sites in the race</h2>
          <p className="text-xs text-base-content/60">
            Your site and up to {TOP_STORIES_LIMITS.maxCompetitors} competitors.
            Each news sitemap is read every 5 minutes; publication times come
            from its <code>publication_date</code>. Leave the sitemap empty to
            look it up in robots.txt.
          </p>
        </div>
        {overview.sites.length === 0 ? (
          <p className="text-sm text-base-content/60">No sites yet.</p>
        ) : (
          <ul className="divide-y divide-base-300 rounded-lg border border-base-300">
            {overview.sites.map((site) => (
              <SiteRow key={site.id} projectId={projectId} site={site} />
            ))}
          </ul>
        )}
        <AddSiteForm
          projectId={projectId}
          suggestOwn={!overview.sites.some((site) => site.isOwn)}
          ownDomain={overview.projectDomain}
          canAddCompetitor={competitors < TOP_STORIES_LIMITS.maxCompetitors}
        />
      </div>
    </div>
  );
}

function SiteRow({ projectId, site }: { projectId: string; site: Site }) {
  const invalidate = useInvalidateTopStories(projectId);
  const [editing, setEditing] = useState(false);
  const [sitemapUrl, setSitemapUrl] = useState(site.newsSitemapUrl ?? "");
  const onError = (error: unknown) =>
    toast.error(getStandardErrorMessage(error));

  const updateMutation = useMutation({
    mutationFn: (patch: { isOwn?: boolean; newsSitemapUrl?: string | null }) =>
      updateTopStoriesSite({
        data: { projectId, siteId: site.id, ...patch },
      }),
    onSuccess: () => {
      setEditing(false);
      void invalidate();
    },
    onError,
  });
  const fetchMutation = useMutation({
    mutationFn: () =>
      fetchTopStoriesSiteNow({ data: { projectId, siteId: site.id } }),
    onSuccess: (result) => {
      void invalidate();
      toast.success(
        `${result.entries} articles in the sitemap (${result.withPublicationDate} with a publication date), ${result.inserted} new`,
      );
    },
    onError: (error) => {
      void invalidate();
      onError(error);
    },
  });
  const deleteMutation = useMutation({
    mutationFn: () =>
      deleteTopStoriesSite({ data: { projectId, siteId: site.id } }),
    onSuccess: () => void invalidate(),
    onError,
  });

  return (
    <li className="space-y-2 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-medium">{site.domain}</span>
          {site.isOwn ? (
            <span className="badge badge-primary badge-sm">Your site</span>
          ) : null}
        </div>
        <div className="flex gap-1">
          {!site.isOwn ? (
            <button
              className="btn btn-ghost btn-xs"
              title="Mark as your own site"
              disabled={updateMutation.isPending}
              onClick={() => updateMutation.mutate({ isOwn: true })}
            >
              <Star className="size-3" />
              Mine
            </button>
          ) : null}
          <button
            className="btn btn-ghost btn-xs"
            title="Read the sitemap now"
            disabled={!site.newsSitemapUrl || fetchMutation.isPending}
            onClick={() => fetchMutation.mutate()}
          >
            {fetchMutation.isPending ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <RefreshCw className="size-3" />
            )}
            Test
          </button>
          <button
            className="btn btn-ghost btn-xs btn-square"
            title="Remove site and its articles"
            disabled={deleteMutation.isPending}
            onClick={() => deleteMutation.mutate()}
          >
            <Trash2 className="size-3" />
          </button>
        </div>
      </div>
      {editing ? (
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            updateMutation.mutate({
              newsSitemapUrl: sitemapUrl.trim() || null,
            });
          }}
        >
          <input
            className="input input-bordered input-sm w-full"
            placeholder="https://example.com/news-sitemap.xml"
            value={sitemapUrl}
            onChange={(event) => setSitemapUrl(event.target.value)}
            autoFocus
          />
          <button
            className="btn btn-primary btn-sm"
            disabled={updateMutation.isPending}
          >
            Save
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setEditing(false)}
          >
            Cancel
          </button>
        </form>
      ) : (
        <button
          className="link link-hover block max-w-full truncate text-left text-xs text-base-content/70"
          onClick={() => {
            setSitemapUrl(site.newsSitemapUrl ?? "");
            setEditing(true);
          }}
        >
          {site.newsSitemapUrl ?? "No news sitemap: click to add one"}
        </button>
      )}
      <SitemapStatus site={site} />
    </li>
  );
}

function SitemapStatus({ site }: { site: Site }) {
  if (!site.newsSitemapUrl || !site.lastFetchedAt) return null;
  if (site.lastFetchError) {
    return (
      <div className="flex items-start gap-1 text-xs text-error">
        <XCircle className="mt-0.5 size-3 shrink-0" />
        <span>
          {site.lastFetchError} ({formatRelativeTime(site.lastFetchedAt)})
        </span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1 text-xs text-success">
      <CheckCircle2 className="size-3" />
      Read {formatRelativeTime(site.lastFetchedAt)}
    </div>
  );
}

function AddSiteForm({
  projectId,
  suggestOwn,
  ownDomain,
  canAddCompetitor,
}: {
  projectId: string;
  suggestOwn: boolean;
  ownDomain: string | null;
  canAddCompetitor: boolean;
}) {
  const invalidate = useInvalidateTopStories(projectId);
  const addMutation = useMutation({
    mutationFn: (value: {
      domain: string;
      newsSitemapUrl: string;
      isOwn: boolean;
    }) =>
      addTopStoriesSite({
        data: {
          projectId,
          domain: value.domain.trim(),
          isOwn: value.isOwn,
          newsSitemapUrl: value.newsSitemapUrl.trim() || null,
        },
      }),
    onSuccess: (result) => {
      void invalidate();
      form.reset();
      toast.success(
        result.newsSitemapUrl
          ? "Site added"
          : "Site added. No news sitemap was found in robots.txt; add its URL.",
      );
    },
    onError: (error) => toast.error(getStandardErrorMessage(error)),
  });
  const form = useForm({
    defaultValues: {
      domain: suggestOwn ? (ownDomain ?? "") : "",
      newsSitemapUrl: "",
      isOwn: suggestOwn,
    },
    onSubmit: ({ value }) => {
      if (value.domain.trim()) addMutation.mutate(value);
    },
  });

  return (
    <form
      className="space-y-2 rounded-lg border border-dashed border-base-300 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <div className="grid gap-2 md:grid-cols-2">
        <form.Field name="domain">
          {(field) => (
            <input
              className="input input-bordered input-sm w-full"
              placeholder="Domain, e.g. example.ir"
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value)}
            />
          )}
        </form.Field>
        <form.Field name="newsSitemapUrl">
          {(field) => (
            <input
              className="input input-bordered input-sm w-full"
              placeholder="News sitemap URL (optional)"
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value)}
            />
          )}
        </form.Field>
      </div>
      <div className="flex items-center justify-between gap-2">
        <form.Field name="isOwn">
          {(field) => (
            <label className="label cursor-pointer gap-2 text-sm">
              <input
                type="checkbox"
                className="checkbox checkbox-sm"
                checked={field.state.value}
                onChange={(event) => field.handleChange(event.target.checked)}
              />
              This is my site
            </label>
          )}
        </form.Field>
        <form.Subscribe selector={(state) => state.values.isOwn}>
          {(isOwn) => (
            <button
              type="submit"
              className="btn btn-sm btn-primary"
              disabled={addMutation.isPending || (!isOwn && !canAddCompetitor)}
            >
              {addMutation.isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Plus className="size-3.5" />
              )}
              Add site
            </button>
          )}
        </form.Subscribe>
      </div>
    </form>
  );
}
