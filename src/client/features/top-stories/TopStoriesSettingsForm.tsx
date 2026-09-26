import { Link } from "@tanstack/react-router";
import { useForm } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  type TopStoriesOverview,
  useInvalidateTopStories,
} from "@/client/features/top-stories/queries";
import { updateTopStoriesSettings } from "@/serverFunctions/top-stories";
import { TOP_STORIES_LIMITS } from "@/shared/top-stories";

type Settings = NonNullable<TopStoriesOverview["settings"]>;

// DataForSEO live SERP, first page. Matches rank tracking's live pricing.
const COST_PER_CHECK_USD = 0.002;

function NumberField({
  label,
  hint,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="form-control w-full">
      <span className="label-text text-sm">{label}</span>
      <input
        type="number"
        className="input input-bordered input-sm w-full"
        value={Number.isFinite(value) ? value : ""}
        min={min}
        max={max}
        onChange={(event) => onChange(event.target.valueAsNumber)}
      />
      {hint ? (
        <span className="text-xs text-base-content/50">{hint}</span>
      ) : null}
    </label>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="label cursor-pointer justify-start gap-2 text-sm">
      <input
        type="checkbox"
        className="toggle toggle-sm"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      {label}
    </label>
  );
}

export function TopStoriesSettingsForm({
  projectId,
  settings,
  gscConnected,
}: {
  projectId: string;
  settings: Settings;
  gscConnected: boolean;
}) {
  const invalidate = useInvalidateTopStories(projectId);
  const defaultValues = {
    isActive: settings.isActive,
    device: settings.device,
    locationCode: settings.locationCode,
    languageCode: settings.languageCode,
    snapshotIntervalMinutes: settings.snapshotIntervalMinutes,
    trackingWindowHours: settings.trackingWindowHours,
    maxAutoTopicsPerDay: settings.maxAutoTopicsPerDay,
    trendsImportEnabled: settings.trendsImportEnabled,
    trendsGeo: settings.trendsGeo,
    gscImportEnabled: settings.gscImportEnabled,
  };
  const saveMutation = useMutation({
    mutationFn: (value: typeof defaultValues) =>
      updateTopStoriesSettings({ data: { projectId, ...value } }),
    onSuccess: () => {
      void invalidate();
      toast.success("Settings saved");
    },
    onError: (error) => toast.error(getStandardErrorMessage(error)),
  });
  const form = useForm({
    defaultValues,
    onSubmit: ({ value }) => saveMutation.mutate(value),
  });
  const limits = TOP_STORIES_LIMITS;

  return (
    <div className="card bg-base-100 border border-base-300 h-fit">
      <form
        className="card-body gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
      >
        <h2 className="text-sm font-semibold">Settings</h2>
        <form.Field name="isActive">
          {(field) => (
            <Toggle
              label="Tracking is on"
              checked={field.state.value}
              onChange={field.handleChange}
            />
          )}
        </form.Field>

        <div className="grid grid-cols-2 gap-3">
          <form.Field name="locationCode">
            {(field) => (
              <NumberField
                label="Google location code"
                hint="2364 is Iran"
                value={field.state.value}
                min={1}
                max={99_999_999}
                onChange={field.handleChange}
              />
            )}
          </form.Field>
          <form.Field name="languageCode">
            {(field) => (
              <label className="form-control w-full">
                <span className="label-text text-sm">Language code</span>
                <input
                  className="input input-bordered input-sm w-full"
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
                <span className="text-xs text-base-content/50">
                  fa is Persian
                </span>
              </label>
            )}
          </form.Field>
          <form.Field name="device">
            {(field) => (
              <label className="form-control w-full">
                <span className="label-text text-sm">Device</span>
                <select
                  className="select select-bordered select-sm w-full"
                  value={field.state.value}
                  onChange={(event) =>
                    field.handleChange(
                      event.target.value === "desktop" ? "desktop" : "mobile",
                    )
                  }
                >
                  <option value="mobile">Mobile</option>
                  <option value="desktop">Desktop</option>
                </select>
              </label>
            )}
          </form.Field>
          <form.Field name="snapshotIntervalMinutes">
            {(field) => (
              <NumberField
                label="Check every (minutes)"
                value={field.state.value}
                min={limits.snapshotIntervalMinutes.min}
                max={limits.snapshotIntervalMinutes.max}
                onChange={field.handleChange}
              />
            )}
          </form.Field>
          <form.Field name="trackingWindowHours">
            {(field) => (
              <NumberField
                label="For (hours)"
                value={field.state.value}
                min={limits.trackingWindowHours.min}
                max={limits.trackingWindowHours.max}
                onChange={field.handleChange}
              />
            )}
          </form.Field>
          <form.Field name="maxAutoTopicsPerDay">
            {(field) => (
              <NumberField
                label="Auto topics per day"
                value={field.state.value}
                min={limits.maxAutoTopicsPerDay.min}
                max={limits.maxAutoTopicsPerDay.max}
                onChange={field.handleChange}
              />
            )}
          </form.Field>
        </div>

        <form.Subscribe
          selector={(state) => ({
            interval: state.values.snapshotIntervalMinutes,
            hours: state.values.trackingWindowHours,
            topics: state.values.maxAutoTopicsPerDay,
          })}
        >
          {({ interval, hours, topics }) => {
            const checks =
              interval > 0 ? Math.floor((hours * 60) / interval) + 1 : 0;
            const cost = topics * checks * COST_PER_CHECK_USD;
            return (
              <p className="text-xs text-base-content/60">
                {checks} checks per topic. At {topics} automatic topics a day,
                about ${cost.toFixed(2)} a day in DataForSEO requests, plus any
                topics you add by hand.
              </p>
            );
          }}
        </form.Subscribe>

        <div className="divider my-0" />
        <form.Field name="trendsImportEnabled">
          {(field) => (
            <Toggle
              label="Import Google Trends topics"
              checked={field.state.value}
              onChange={field.handleChange}
            />
          )}
        </form.Field>
        <form.Field name="trendsGeo">
          {(field) => (
            <label className="form-control w-32">
              <span className="label-text text-sm">Trends country</span>
              <input
                className="input input-bordered input-sm w-full uppercase"
                maxLength={2}
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
              />
            </label>
          )}
        </form.Field>
        <form.Field name="gscImportEnabled">
          {(field) => (
            <Toggle
              label="Import new Search Console queries"
              checked={field.state.value}
              onChange={field.handleChange}
            />
          )}
        </form.Field>
        {!gscConnected ? (
          <p className="text-xs text-base-content/60">
            Search Console isn&apos;t connected.{" "}
            <Link
              to="/p/$projectId/settings/integrations"
              params={{ projectId }}
              className="link"
            >
              Connect it
            </Link>{" "}
            for new-query topics and automatic crawl times.
          </p>
        ) : null}

        <button
          type="submit"
          className="btn btn-primary btn-sm w-fit"
          disabled={saveMutation.isPending}
        >
          {saveMutation.isPending ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : null}
          Save settings
        </button>
      </form>
    </div>
  );
}
