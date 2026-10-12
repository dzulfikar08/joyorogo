import { describe, expect, test } from "bun:test";

import {
  addOneMonth,
  dailyScanQuota,
  effectiveTier,
  nextFounderUntil,
  paywallConfig,
  paywallEnabled,
  wibDayBounds,
} from "./tiers";

const PROD = paywallConfig({
  FREE_DAILY_SCANS: "3",
  FOUNDER_DAILY_CAP: "100",
  ANON_SCANS: "2",
  FOUNDER_PRICE_IDR: "15000",
});

describe("paywallConfig", () => {
  test("no config means no paywall: unlimited scans, default demo and price", () => {
    const config = paywallConfig({});
    expect(paywallEnabled(config)).toBe(false);
    expect(dailyScanQuota("free", config)).toBeNull();
    expect(dailyScanQuota("founder", config)).toBeNull();
    expect(config.anonScans).toBe(2);
    expect(config.founderPriceIdr).toBe(15_000);
  });

  test("empty strings (unset wrangler vars) count as unset", () => {
    expect(paywallEnabled(paywallConfig({ FREE_DAILY_SCANS: " " }))).toBe(false);
  });

  test("hosted config keeps today's limits", () => {
    expect(paywallEnabled(PROD)).toBe(true);
    expect(dailyScanQuota("free", PROD)).toBe(3);
    expect(dailyScanQuota("founder", PROD)).toBe(100);
  });

  test("zero is a real limit, not 'off'", () => {
    const config = paywallConfig({ FREE_DAILY_SCANS: "0", ANON_SCANS: "0" });
    expect(dailyScanQuota("free", config)).toBe(0);
    expect(config.anonScans).toBe(0);
  });

  test("typos fail loudly instead of meaning unlimited", () => {
    expect(() => paywallConfig({ FREE_DAILY_SCANS: "3x" })).toThrow("FREE_DAILY_SCANS");
    expect(() => paywallConfig({ FOUNDER_DAILY_CAP: "-1" })).toThrow("FOUNDER_DAILY_CAP");
    expect(() => paywallConfig({ FOUNDER_PRICE_IDR: "0" })).toThrow("FOUNDER_PRICE_IDR");
  });
});

describe("effectiveTier", () => {
  const now = new Date("2026-10-12T05:00:00Z");

  test("active paid period is founder, lapsed is free", () => {
    expect(
      effectiveTier({ tier: "free", founderUntil: new Date("2026-10-13T00:00:00Z") }, now),
    ).toBe("founder");
    expect(
      effectiveTier({ tier: "free", founderUntil: new Date("2026-10-12T04:59:59Z") }, now),
    ).toBe("free");
  });

  test("manual founder comp never expires", () => {
    expect(effectiveTier({ tier: "founder", founderUntil: null }, now)).toBe("founder");
    expect(effectiveTier({ tier: "founder", founderUntil: new Date("2020-01-01") }, now)).toBe(
      "founder",
    );
  });

  test("missing user row is free", () => {
    expect(effectiveTier(undefined, now)).toBe("free");
  });
});

describe("founder period math", () => {
  test("one month keeps the day, clamped to month end", () => {
    expect(addOneMonth(new Date("2026-01-31T10:00:00Z")).toISOString()).toBe(
      "2026-02-28T10:00:00.000Z",
    );
    expect(addOneMonth(new Date("2028-01-31T10:00:00Z")).toISOString()).toBe(
      "2028-02-29T10:00:00.000Z",
    );
    expect(addOneMonth(new Date("2026-12-15T00:00:00Z")).toISOString()).toBe(
      "2027-01-15T00:00:00.000Z",
    );
  });

  test("first payment or lapsed period starts from now", () => {
    const now = new Date("2026-10-12T05:00:00Z");
    expect(nextFounderUntil(null, now).toISOString()).toBe("2026-11-12T05:00:00.000Z");
    expect(nextFounderUntil(new Date("2026-09-01T00:00:00Z"), now).toISOString()).toBe(
      "2026-11-12T05:00:00.000Z",
    );
  });

  test("renewing early stacks on the remaining period", () => {
    const now = new Date("2026-10-12T05:00:00Z");
    expect(nextFounderUntil(new Date("2026-10-20T00:00:00Z"), now).toISOString()).toBe(
      "2026-11-20T00:00:00.000Z",
    );
  });
});

describe("wibDayBounds", () => {
  test("WIB midnight is 17:00 the previous UTC day", () => {
    const { startMs, endMs } = wibDayBounds("2026-09-15");
    expect(new Date(startMs).toISOString()).toBe("2026-09-14T17:00:00.000Z");
    expect(new Date(endMs).toISOString()).toBe("2026-09-15T17:00:00.000Z");
  });

  test("a scan at 06:59 WIB belongs to the previous day, 07:00 WIB to today", () => {
    const { startMs } = wibDayBounds("2026-09-15");
    // 2026-09-15T00:00+07:00 minus one minute is 2026-09-14 23:59 WIB.
    expect(Date.parse("2026-09-14T23:59:00+07:00")).toBeLessThan(startMs);
    expect(Date.parse("2026-09-15T00:01:00+07:00")).toBeGreaterThanOrEqual(startMs);
  });

  test("window is exactly 24 hours (WIB has no DST)", () => {
    const { startMs, endMs } = wibDayBounds("2026-01-01");
    expect(endMs - startMs).toBe(24 * 60 * 60 * 1000);
  });
});
