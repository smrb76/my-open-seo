import { env } from "cloudflare:workers";
import { z } from "zod";
import { toIsoOrNull } from "@/shared/top-stories";

// Access-log parsing for "when did Googlebot first fetch our article". Accepts
// the nginx/Apache combined log format and JSON-lines logs with common field
// names; anything else is skipped and counted, never guessed at.

interface CrawlLogHit {
  ip: string;
  /** ISO time of the request. */
  time: string;
  /** Request path ("/news/1") or absolute URL, as logged. */
  target: string;
  userAgent: string;
  status: number | null;
}

const MONTHS: Record<string, string> = {
  jan: "01",
  feb: "02",
  mar: "03",
  apr: "04",
  may: "05",
  jun: "06",
  jul: "07",
  aug: "08",
  sep: "09",
  oct: "10",
  nov: "11",
  dec: "12",
};

// "24/Sep/2026:10:25:03 +0330"
const CLF_TIME_RE =
  /^(\d{2})\/([A-Za-z]{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2}) ([+-]\d{2})(\d{2})$/;

// ip ident user [time] "METHOD target PROTOCOL" status bytes "referer" "agent"
const COMBINED_LOG_RE =
  /^(\S+) \S+ \S+ \[([^\]]+)\] "[A-Z]+ (\S+)[^"]*" (\d{3}) \S+(?: "[^"]*" "([^"]*)")?/;

function parseClfTime(value: string): string | null {
  const match = CLF_TIME_RE.exec(value);
  if (!match) return null;
  const [, day, month, year, hh, mm, ss, offsetHours, offsetMinutes] = match;
  const monthNumber = MONTHS[month.toLowerCase()];
  if (!monthNumber) return null;
  return toIsoOrNull(
    `${year}-${monthNumber}-${day}T${hh}:${mm}:${ss}${offsetHours}:${offsetMinutes}`,
  );
}

function parseLogTime(value: unknown): string | null {
  if (typeof value === "number") {
    // Epoch seconds or milliseconds.
    const ms = value < 1e12 ? value * 1000 : value;
    return new Date(ms).toISOString();
  }
  if (typeof value !== "string") return null;
  return parseClfTime(value) ?? toIsoOrNull(value);
}

function parseCombinedLine(line: string): CrawlLogHit | null {
  const match = COMBINED_LOG_RE.exec(line);
  if (!match) return null;
  const [, ip, rawTime, target, status, userAgent] = match;
  const time = parseClfTime(rawTime);
  if (!time) return null;
  return {
    ip,
    time,
    target,
    userAgent: userAgent ?? "",
    status: Number(status),
  };
}

const JSON_KEYS = {
  time: ["time", "timestamp", "@timestamp", "time_iso8601", "time_local"],
  ip: ["remote_addr", "client_ip", "clientip", "ip", "remote_ip", "real_ip"],
  target: ["request_uri", "uri", "path", "url", "request"],
  userAgent: ["http_user_agent", "user_agent", "useragent", "ua", "agent"],
  status: ["status", "status_code"],
} as const;

function pick(record: Record<string, unknown>, keys: readonly string[]) {
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) return record[key];
  }
  return undefined;
}

const jsonRecordSchema = z.record(z.string(), z.unknown());

function parseJsonLine(line: string): CrawlLogHit | null {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return null;
  }
  const parsed = jsonRecordSchema.safeParse(raw);
  if (!parsed.success) return null;
  const record = Object.fromEntries(
    Object.entries(parsed.data).map(([key, value]) => [
      key.toLowerCase(),
      value,
    ]),
  );

  const time = parseLogTime(pick(record, JSON_KEYS.time));
  const ip = pick(record, JSON_KEYS.ip);
  const rawTarget = pick(record, JSON_KEYS.target);
  const userAgent = pick(record, JSON_KEYS.userAgent);
  const status = Number(pick(record, JSON_KEYS.status));
  if (!time || typeof ip !== "string" || typeof rawTarget !== "string") {
    return null;
  }
  // `request` holds the whole request line: "GET /news/1 HTTP/1.1".
  const target = rawTarget.includes(" ")
    ? (rawTarget.split(" ")[1] ?? "")
    : rawTarget;
  if (!target) return null;
  return {
    ip,
    time,
    target,
    userAgent: typeof userAgent === "string" ? userAgent : "",
    status: Number.isFinite(status) ? status : null,
  };
}

export function parseAccessLogLine(line: string): CrawlLogHit | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  return trimmed.startsWith("{")
    ? parseJsonLine(trimmed)
    : parseCombinedLine(trimmed);
}

export function isGooglebotUserAgent(userAgent: string): boolean {
  return /googlebot/i.test(userAgent);
}

// ---------------------------------------------------------------------------
// Googlebot IP verification against Google's published ranges. Anyone can
// send a Googlebot user agent; only these ranges are Google's crawler.
// ---------------------------------------------------------------------------

const GOOGLEBOT_RANGES_URL =
  "https://developers.google.com/static/search/apis/ipranges/googlebot.json";
const RANGES_KV_KEY = "top-stories:googlebot-ip-ranges";
const RANGES_TTL_SECONDS = 24 * 60 * 60;

const rangesFileSchema = z.object({
  prefixes: z.array(
    z.object({
      ipv4Prefix: z.string().optional(),
      ipv6Prefix: z.string().optional(),
    }),
  ),
});
const cachedRangesSchema = z.array(z.string());

/** Googlebot CIDR ranges (KV-cached for a day); null when unavailable. */
export async function loadGooglebotRanges(): Promise<string[] | null> {
  const cached = cachedRangesSchema.safeParse(
    await env.KV.get(RANGES_KV_KEY, "json"),
  );
  if (cached.success && cached.data.length > 0) return cached.data;

  try {
    const response = await fetch(GOOGLEBOT_RANGES_URL, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    const file = rangesFileSchema.safeParse(await response.json());
    if (!file.success) return null;
    const ranges = file.data.prefixes.flatMap((prefix) =>
      [prefix.ipv4Prefix, prefix.ipv6Prefix].filter((value): value is string =>
        Boolean(value),
      ),
    );
    if (ranges.length === 0) return null;
    await env.KV.put(RANGES_KV_KEY, JSON.stringify(ranges), {
      expirationTtl: RANGES_TTL_SECONDS,
    });
    return ranges;
  } catch (error) {
    console.warn("[top-stories] Could not load Googlebot IP ranges:", error);
    return null;
  }
}

type ParsedIp = { value: bigint; bits: 32 | 128 };

function parseIpv4(ip: string): bigint | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let value = 0n;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part) || Number(part) > 255) return null;
    value = (value << 8n) | BigInt(part);
  }
  return value;
}

function parseIpv6(ip: string): bigint | null {
  let text = ip.replace(/^\[|\]$/g, "").split("%")[0] ?? "";
  // Embedded IPv4 tail ("::ffff:66.249.66.1") becomes two hex groups.
  const v4Tail = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(text);
  if (v4Tail) {
    const v4 = parseIpv4(v4Tail[1]);
    if (v4 === null) return null;
    text = `${text.slice(0, v4Tail.index)}${(v4 >> 16n).toString(16)}:${(v4 & 0xffffn).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 0) return null;
  const groups = [...head, ...Array<string>(missing).fill("0"), ...tail];
  let value = 0n;
  for (const group of groups) {
    if (!/^[\da-f]{1,4}$/i.test(group)) return null;
    value = (value << 16n) | BigInt(`0x${group}`);
  }
  return value;
}

function parseIp(ip: string): ParsedIp | null {
  const v4 = parseIpv4(ip);
  if (v4 !== null) return { value: v4, bits: 32 };
  const v6 = parseIpv6(ip);
  if (v6 === null) return null;
  // IPv4-mapped IPv6 (::ffff:a.b.c.d) is an IPv4 client.
  if (v6 >> 32n === 0xffffn) return { value: v6 & 0xffffffffn, bits: 32 };
  return { value: v6, bits: 128 };
}

function inCidr(ip: ParsedIp, cidr: string): boolean {
  const [network, prefixText] = cidr.split("/");
  const net = parseIp(network ?? "");
  const prefix = Number(prefixText);
  if (!net || net.bits !== ip.bits || !Number.isInteger(prefix)) return false;
  const shift = BigInt(ip.bits - prefix);
  return ip.value >> shift === net.value >> shift;
}

export function isIpInRanges(ip: string, ranges: string[]): boolean {
  const parsed = parseIp(ip);
  return parsed !== null && ranges.some((cidr) => inCidr(parsed, cidr));
}
