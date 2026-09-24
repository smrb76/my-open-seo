// Fires the Worker's cron triggers for Docker self-hosts. On Cloudflare the
// platform runs the `triggers.crons` in wrangler.jsonc; under `vite preview`
// nothing does, and Miniflare only exposes them at /cdn-cgi/handler/scheduled.
// This loop calls that endpoint on the same schedule: every 5 minutes, plus
// the daily 03:17 UTC job. Started in the background by docker-entrypoint.sh.

const port = process.env.PORT || "3001";
const endpoint = `http://127.0.0.1:${port}/cdn-cgi/handler/scheduled`;
const FIVE_MINUTES_MS = 5 * 60_000;
const FREQUENT_CRON = "*/5 * * * *";
const DAILY_CRON = "17 3 * * *";
const DAILY_MINUTE_UTC = 3 * 60 + 17;

let lastDailyRunDate = null;

async function fire(cron) {
  try {
    const response = await fetch(
      `${endpoint}?cron=${encodeURIComponent(cron)}`,
    );
    if (!response.ok) {
      console.error(`[selfhost-cron] "${cron}" returned ${response.status}`);
    }
  } catch (error) {
    // The server may still be starting; the next slot retries.
    console.error(`[selfhost-cron] "${cron}" failed: ${error.message}`);
  }
}

async function tick() {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const minuteOfDay = now.getUTCHours() * 60 + now.getUTCMinutes();
  if (minuteOfDay >= DAILY_MINUTE_UTC && lastDailyRunDate !== today) {
    lastDailyRunDate = today;
    await fire(DAILY_CRON);
  }
  await fire(FREQUENT_CRON);
}

// Align to wall-clock 5-minute boundaries, like Cloudflare's scheduler.
function scheduleNext() {
  const delay = FIVE_MINUTES_MS - (Date.now() % FIVE_MINUTES_MS);
  setTimeout(() => {
    void tick().finally(scheduleNext);
  }, delay);
}

scheduleNext();
