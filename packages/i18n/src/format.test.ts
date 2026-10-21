import { describe, expect, test } from "bun:test";

import {
  fmtClock,
  fmtDate,
  fmtIdr,
  fmtInt,
  fmtKcalLabel,
  fmtKg,
  fmtMyr,
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

describe("Bahasa Melayu (ms-MY)", () => {
  test("numbers use the Malaysian separators, energy is kcal, ringgit is RM", () => {
    expect(fmtInt(1234.6, "ms")).toBe("1,235");
    expect(fmtKg(68.46, "ms")).toBe("68.5");
    expect(kcalUnit("ms")).toBe("kcal");
    expect(fmtKcalLabel(2100, "ms")).toBe("2,100 kcal");
    expect(fmtMyr(49.9, "ms")).toBe("RM49.90");
    expect(fmtMyr(60, "ms")).toBe("RM60");
  });

  test("dates are Malay and day names are Malay, not Indonesian", () => {
    expect(fmtDate("2026-09-14", "long", "ms")).toBe("Isnin, 14 September 2026");
    expect(fmtDate("2026-10-10", "weekday", "ms")).toBe("Sabtu, 10 Okt");
    expect(fmtDate("2026-03-01", "medium", "ms")).toContain("Mac");
    expect(fmtDate("2026-08-31", "month", "ms")).toBe("Ogos 2026");
  });

  test("relative day labels and time ago are Malay", () => {
    expect(relativeDayLabel("2026-10-17", "2026-10-17", "ms")).toBe("Hari ini");
    expect(relativeDayLabel("2026-10-16", "2026-10-17", "ms")).toBe("Semalam");
    const now = Date.now();
    expect(timeAgo(new Date(now - 5 * 60_000), "ms")).toBe("5 minit lalu");
  });

  test("clock reads the zone it is given: 05:05 UTC is 13.05 in Kuala Lumpur and 12.05 in Jakarta", () => {
    const at = new Date("2026-10-20T05:05:00Z");
    expect(fmtClock(at, "en", "Asia/Kuala_Lumpur")).toBe("01:05 PM");
    expect(fmtClock(at, "id", "Asia/Kuala_Lumpur")).toBe("13.05");
    expect(fmtClock(at, "id")).toBe("12.05");
  });
});
