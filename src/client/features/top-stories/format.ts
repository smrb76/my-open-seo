import type {
  TopStoriesOutcome,
  TopStoriesTopicSource,
} from "@/types/schemas/top-stories";
import type { TopStoriesLossCause } from "@/shared/top-stories";

export const SOURCE_LABELS: Record<TopStoriesTopicSource, string> = {
  google_trends: "Trends",
  gsc: "Search Console",
  manual: "Manual",
};

export const OUTCOME_BADGES: Record<
  TopStoriesOutcome,
  { label: string; className: string }
> = {
  won: { label: "Won", className: "badge-success" },
  lost: { label: "Lost", className: "badge-error" },
  no_carousel: { label: "No carousel", className: "badge-ghost" },
  untracked_only: { label: "Others only", className: "badge-ghost" },
};

export const LOSS_CAUSE_LABELS: Record<TopStoriesLossCause, string> = {
  slowPublish: "Published late",
  slowCrawl: "Googlebot came late",
  other: "Fast on both",
  noCrawlData: "Published fast, no crawl data",
  notCovered: "No article of ours matched",
};

export function formatMinutes(minutes: number | null): string {
  if (minutes === null) return "—";
  const sign = minutes < 0 ? "−" : "";
  const absolute = Math.abs(minutes);
  if (absolute < 60) return `${sign}${absolute} min`;
  const hours = Math.floor(absolute / 60);
  const rest = absolute % 60;
  return rest === 0 ? `${sign}${hours} h` : `${sign}${hours} h ${rest} min`;
}

const clockFormat = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
});
const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatClock(iso: string | null): string {
  return iso ? clockFormat.format(new Date(iso)) : "—";
}

export function formatDateTime(iso: string | null): string {
  return iso ? dateTimeFormat.format(new Date(iso)) : "—";
}

export function formatShare(share: number | null): string {
  return share === null ? "—" : `${Math.round(share * 100)}%`;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** Today's date in the viewer's timezone, as YYYY-MM-DD. */
export function todayLocal(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function parseLocalDay(day: string): Date {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year, month - 1, date);
}

export function shiftDay(day: string, deltaDays: number): string {
  const date = parseLocalDay(day);
  date.setDate(date.getDate() + deltaDays);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** [local midnight, next local midnight) of a YYYY-MM-DD day, as ISO. */
export function localDayRange(day: string): { from: string; to: string } {
  const start = parseLocalDay(day);
  const end = parseLocalDay(shiftDay(day, 1));
  return { from: start.toISOString(), to: end.toISOString() };
}
