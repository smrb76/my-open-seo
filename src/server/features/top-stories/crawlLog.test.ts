import { describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ env: {} }));

import {
  isIpInRanges,
  parseAccessLogLine,
} from "@/server/features/top-stories/crawlLog";

const GOOGLEBOT_UA =
  "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";

describe("parseAccessLogLine", () => {
  it("reads combined-format lines with Iran's +0330 offset as UTC", () => {
    expect(
      parseAccessLogLine(
        `66.249.66.1 - - [24/Sep/2026:10:25:03 +0330] "GET /news/123?amp=1 HTTP/1.1" 200 5123 "-" "${GOOGLEBOT_UA}" 0.012`,
      ),
    ).toEqual({
      ip: "66.249.66.1",
      time: "2026-09-24T06:55:03.000Z",
      target: "/news/123?amp=1",
      userAgent: GOOGLEBOT_UA,
      status: 200,
    });
  });

  it("reads JSON lines, including a whole request line and epoch seconds", () => {
    expect(
      parseAccessLogLine(
        JSON.stringify({
          Time: 1790232303,
          remote_addr: "66.249.66.1",
          request: "GET /news/123 HTTP/2.0",
          http_user_agent: GOOGLEBOT_UA,
          status: "304",
        }),
      ),
    ).toEqual({
      ip: "66.249.66.1",
      time: new Date(1790232303 * 1000).toISOString(),
      target: "/news/123",
      userAgent: GOOGLEBOT_UA,
      status: 304,
    });
  });

  it("skips lines it can't read instead of guessing", () => {
    expect(parseAccessLogLine("GET /news/123 from 66.249.66.1")).toBeNull();
    expect(parseAccessLogLine('{"message":"no fields"}')).toBeNull();
  });
});

describe("isIpInRanges", () => {
  const ranges = ["66.249.64.0/27", "2001:4860:4801:10::/64"];

  it("matches IPv4, compressed IPv6 and IPv4-mapped IPv6 addresses", () => {
    expect(isIpInRanges("66.249.64.31", ranges)).toBe(true);
    expect(isIpInRanges("66.249.64.32", ranges)).toBe(false);
    expect(isIpInRanges("2001:4860:4801:10::1", ranges)).toBe(true);
    expect(isIpInRanges("2001:4860:4801:11::1", ranges)).toBe(false);
    expect(isIpInRanges("::ffff:66.249.64.1", ranges)).toBe(true);
    expect(isIpInRanges("not-an-ip", ranges)).toBe(false);
  });
});
