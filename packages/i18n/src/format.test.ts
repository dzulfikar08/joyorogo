import { describe, expect, test } from "bun:test";

import {
  fmtDate,
  fmtIdr,
  fmtInt,
  fmtKcalLabel,
  fmtKg,
  kcalUnit,
  relativeDayLabel,
  setActiveLocale,
  timeAgo,
} from "./format";

describe("numbers", () => {
  test("separators follow the locale", () => {
    expect(fmtInt(1234.6, "id")).toBe("1.235");
    expect(fmtInt(1234.6, "en")).toBe("1,235");
    expect(fmtKg(68.46, "id")).toBe("68,5");
    expect(fmtKg(68.46, "en")).toBe("68.5");
    expect(fmtIdr(15000, "id")).toBe("Rp15.000");
    expect(fmtIdr(15000, "en")).toBe("Rp15,000");
    expect(fmtKcalLabel(2100, "en")).toBe("2,100 kcal");
    expect(fmtKcalLabel(2100, "id")).toBe("2.100 kkal");
    expect(kcalUnit("id")).toBe("kkal");
    expect(kcalUnit("en")).toBe("kcal");
  });
});

describe("dates", () => {
  test("calendar days format in UTC, never shifting", () => {
    expect(fmtDate("2026-09-14", "long", "id")).toBe("Senin, 14 September 2026");
    expect(fmtDate("2026-09-14", "long", "en")).toBe("Monday, September 14, 2026");
    expect(fmtDate("2026-09-14", "medium", "id")).toBe("14 Sep 2026");
  });

  test("relative day labels", () => {
    expect(relativeDayLabel("2026-10-17", "2026-10-17", "id")).toBe("Hari ini");
    expect(relativeDayLabel("2026-10-16", "2026-10-17", "id")).toBe("Kemarin");
    expect(relativeDayLabel("2026-10-17", "2026-10-17", "en")).toBe("Today");
    expect(relativeDayLabel("2026-10-16", "2026-10-17", "en")).toBe("Yesterday");
    expect(relativeDayLabel("2026-10-10", "2026-10-17", "en")).toBe("Saturday, Oct 10");
  });

  test("the active locale is the default", () => {
    setActiveLocale("en");
    expect(relativeDayLabel("2026-10-17", "2026-10-17")).toBe("Today");
    setActiveLocale("id");
    expect(relativeDayLabel("2026-10-17", "2026-10-17")).toBe("Hari ini");
  });
});

describe("timeAgo", () => {
  test("pluralises per language", () => {
    const now = Date.now();
    expect(timeAgo(new Date(now - 60_000), "en")).toBe("1 minute ago");
    expect(timeAgo(new Date(now - 5 * 60_000), "en")).toBe("5 minutes ago");
    expect(timeAgo(new Date(now - 5 * 60_000), "id")).toBe("5 menit lalu");
    expect(timeAgo(new Date(now - 1000), "en")).toBe("just now");
  });
});
