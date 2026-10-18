import { describe, expect, test } from "bun:test";

import {
  formatCompact,
  formatDate,
  formatDuration,
  formatDurationHM,
  formatKm,
  formatNumber,
  formatPercent,
  formatSigned,
  parseDate,
  roundTo,
} from "./format";

describe("numbers", () => {
  test("locale separators and grouping", () => {
    expect(formatNumber(1234567.891, "id", 2)).toBe("1.234.567,89");
    expect(formatNumber(1234567.891, "en", 2)).toBe("1,234,567.89");
    expect(formatNumber(999, "id")).toBe("999");
    expect(formatNumber(1000, "id")).toBe("1.000");
    expect(formatNumber(-1500.5, "en", 1)).toBe("-1,500.5");
  });

  test("rounds half away from zero without float noise", () => {
    expect(roundTo(1.005, 2)).toBe(1.01);
    expect(roundTo(-1.005, 2)).toBe(-1.01);
    expect(formatNumber(2.5, "en")).toBe("3");
    expect(formatNumber(-2.5, "en")).toBe("-3");
    expect(formatNumber(0.49, "en")).toBe("0");
  });

  test("negative zero prints as zero; non-finite prints nothing", () => {
    expect(formatNumber(-0.2, "en")).toBe("0");
    expect(formatNumber(NaN, "en")).toBe("");
    expect(formatNumber(Infinity, "id")).toBe("");
  });

  test("signed, percent, compact", () => {
    expect(formatSigned(3.4, "id", 1)).toBe("+3,4");
    expect(formatSigned(-3.4, "id", 1)).toBe("-3,4");
    expect(formatSigned(0.01, "id", 1)).toBe("0,0");
    expect(formatPercent(0.734, "id")).toBe("73%");
    expect(formatPercent(1.5, "en", 1)).toBe("150.0%");
    expect(formatCompact(12500, "id")).toBe("12,5 rb");
    expect(formatCompact(12500, "en")).toBe("12.5K");
    expect(formatCompact(1000, "en")).toBe("1K");
    expect(formatCompact(2_400_000, "id")).toBe("2,4 jt");
    expect(formatCompact(480, "en")).toBe("480");
  });
});

describe("durations and distance", () => {
  test("mm:ss and h:mm:ss", () => {
    expect(formatDuration(342)).toBe("5:42");
    expect(formatDuration(59.6)).toBe("1:00");
    expect(formatDuration(3725)).toBe("1:02:05");
    expect(formatDuration(-1)).toBe("");
  });

  test("hours and minutes by locale", () => {
    expect(formatDurationHM(3900, "id")).toBe("1j 05m");
    expect(formatDurationHM(3900, "en")).toBe("1h 05m");
    expect(formatDurationHM(1500, "id")).toBe("25m");
  });

  test("km", () => {
    expect(formatKm(5230, "id")).toBe("5,23");
    expect(formatKm(5230, "en", 1)).toBe("5.2");
  });
});

describe("dates", () => {
  test("ISO calendar dates do not shift with the timezone", () => {
    expect(parseDate("2026-10-18")).toEqual({ y: 2026, m: 10, d: 18, wd: 0 });
    expect(formatDate("2026-10-18", "short", "id")).toBe("18 Okt");
    expect(formatDate("2026-10-18", "medium", "en")).toBe("18 Oct 2026");
    expect(formatDate("2026-10-18", "weekday", "id")).toBe("Minggu");
    expect(formatDate("2026-10-19T08:00:00+07:00", "weekdayShort", "en")).toBe("Mon");
    expect(formatDate("2026-05-02", "long", "id")).toBe("2 Mei 2026");
  });

  test("garbage is empty", () => {
    for (const bad of ["", "nope", "2026-13-01", "2026-00-10", null, undefined, {}, NaN]) {
      expect(formatDate(bad, "short", "id")).toBe("");
    }
  });
});

describe("time", () => {
  const at = (h: number, m: number) => new Date(2026, 9, 18, h, m).getTime();

  test("24 h with a dot in id, 12 h in en", async () => {
    const { formatTime } = await import("./format");
    expect(formatTime(at(22, 30), "id")).toBe("22.30");
    expect(formatTime(at(7, 5), "id")).toBe("07.05");
    expect(formatTime(at(22, 30), "en")).toBe("10:30 PM");
    expect(formatTime(at(0, 5), "en")).toBe("12:05 AM");
    expect(formatTime(at(12, 0), "en")).toBe("12:00 PM");
  });

  test("ISO timestamps use local fields; dates, small numbers and garbage are empty", async () => {
    const { formatTime } = await import("./format");
    const iso = new Date(2026, 9, 18, 23, 15).toISOString();
    expect(formatTime(iso, "id")).toBe("23.15");
    for (const bad of ["2026-10-18", "x", 5, null, undefined, {}, "2026-10-18T99:99:00"]) expect(formatTime(bad, "id")).toBe("");
  });
});
