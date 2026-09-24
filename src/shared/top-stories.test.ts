import { describe, expect, it } from "vitest";
import {
  computeNextSnapshotAt,
  normalizeArticleUrl,
  normalizePersianText,
  titleMatchesQuery,
} from "./top-stories";

describe("normalizePersianText", () => {
  it("folds the letter, digit, diacritic and ZWNJ variants Persian sites mix", () => {
    // Arabic kaf/yeh, a hamza-above diacritic, Persian digits, a ZWNJ suffix.
    const arabicKafYeh = "\u0643\u064A";
    expect(
      normalizePersianText(`زلزلهٔ ${arabicKafYeh} ۵.۲ ریشتری؛ خسارت\u200Cها`),
    ).toBe("زلزله کی 5 2 ریشتری خسارت ها");
  });
});

describe("titleMatchesQuery", () => {
  const matches = (query: string, title: string) =>
    titleMatchesQuery(normalizePersianText(query), normalizePersianText(title));

  it("matches a query typed with Arabic letters against a Persian title", () => {
    expect(matches("زلزله \u0643رمان", "وقوع زلزله ۵ ریشتری در کرمان")).toBe(
      true,
    );
  });

  it("requires every token of a short query and accepts short suffixes", () => {
    expect(matches("پرسپولیس استقلال", "پیروزی پرسپولیسی‌ها")).toBe(false);
    expect(matches("پرسپولیس", "پیروزی پرسپولیسی‌ها")).toBe(true);
    // Two-letter tokens never prefix-match: آب is not آبان.
    expect(matches("آب", "آبان ماه")).toBe(false);
  });

  it("lets one token of a longer query be missing", () => {
    expect(matches("قیمت دلار امروز", "قیمت دلار در بازار آزاد")).toBe(true);
    expect(matches("قیمت دلار امروز", "قیمت طلا در بازار")).toBe(false);
  });
});

describe("normalizeArticleUrl", () => {
  it("gives encoded, decoded, AMP and tracking variants one key", () => {
    const key = "isna.ir/news/1403/زلزله";
    expect(
      normalizeArticleUrl(
        "https://www.isna.ir/news/1403/%D8%B2%D9%84%D8%B2%D9%84%D9%87/?utm_source=x#top",
      ),
    ).toBe(key);
    expect(normalizeArticleUrl("https://amp.isna.ir/amp/news/1403/زلزله")).toBe(
      key,
    );
    expect(normalizeArticleUrl("https://isna.ir/news/1403/زلزله/amp")).toBe(
      key,
    );
  });

  it("keeps a malformed percent-escape instead of throwing", () => {
    expect(normalizeArticleUrl(`https://a.ir/news/%E0%A4%A`)).toBe(
      "a.ir/news/%E0%A4%A",
    );
  });
});

describe("computeNextSnapshotAt", () => {
  const base = {
    dueAt: "2026-09-24T10:00:00.000Z",
    intervalMinutes: 30,
    trackingEndsAt: "2026-09-24T16:00:00.000Z",
  };

  it("keeps the fixed cadence when on time", () => {
    expect(
      computeNextSnapshotAt({
        ...base,
        now: new Date("2026-09-24T10:02:00.000Z"),
      }),
    ).toBe("2026-09-24T10:30:00.000Z");
  });

  it("restarts from now after falling behind instead of bunching checks", () => {
    expect(
      computeNextSnapshotAt({
        ...base,
        now: new Date("2026-09-24T11:10:00.000Z"),
      }),
    ).toBe("2026-09-24T11:40:00.000Z");
  });

  it("includes a slot at the window's end and nothing after it", () => {
    expect(
      computeNextSnapshotAt({
        ...base,
        dueAt: "2026-09-24T15:30:00.000Z",
        now: new Date("2026-09-24T15:31:00.000Z"),
      }),
    ).toBe("2026-09-24T16:00:00.000Z");
    expect(
      computeNextSnapshotAt({
        ...base,
        dueAt: "2026-09-24T16:00:00.000Z",
        now: new Date("2026-09-24T16:01:00.000Z"),
      }),
    ).toBeNull();
  });
});
