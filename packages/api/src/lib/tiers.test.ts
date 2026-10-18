import { describe, expect, test } from "bun:test";

import {
  addMonths,
  checkoutAmountIdr,
  appleFounderGrant,
  dailyScanQuota,
  effectiveTier,
  grandfatheredMonthlyIdr,
  ladderStep,
  nextFounderUntil,
  parseLadder,
  paywallConfig,
  paywallEnabled,
  promoFor,
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
    expect(addMonths(new Date("2026-01-31T10:00:00Z"), 1).toISOString()).toBe(
      "2026-02-28T10:00:00.000Z",
    );
    expect(addMonths(new Date("2028-01-31T10:00:00Z"), 1).toISOString()).toBe(
      "2028-02-29T10:00:00.000Z",
    );
    expect(addMonths(new Date("2026-12-15T00:00:00Z"), 1).toISOString()).toBe(
      "2027-01-15T00:00:00.000Z",
    );
  });

  test("a yearly order adds twelve months, clamping leap day", () => {
    expect(addMonths(new Date("2028-02-29T10:00:00Z"), 12).toISOString()).toBe(
      "2029-02-28T10:00:00.000Z",
    );
    const now = new Date("2026-10-12T05:00:00Z");
    expect(nextFounderUntil(new Date("2026-11-01T00:00:00Z"), now, 12).toISOString()).toBe(
      "2027-11-01T00:00:00.000Z",
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

describe("apple founder grant", () => {
  const now = new Date("2026-10-12T05:00:00Z");
  const allow = "Owner@joyo.id, review@joyo.id";

  test("production grants the full month at the paid price", () => {
    const grant = appleFounderGrant("Production", "x@y.z", allow, 15000, null, now);
    expect(grant.until.toISOString()).toBe("2026-11-12T05:00:00.000Z");
    expect(grant.amountIdr).toBe(15000);
  });

  test("allowlisted sandbox buyer (case-insensitive) keeps the month", () => {
    const grant = appleFounderGrant("Sandbox", "OWNER@joyo.id", allow, 15000, null, now);
    expect(grant.until.toISOString()).toBe("2026-11-12T05:00:00.000Z");
    expect(grant.amountIdr).toBe(15000);
  });

  test("other sandbox buyers get 24h at zero revenue", () => {
    const grant = appleFounderGrant("Sandbox", "abc@privaterelay.appleid.com", allow, 15000, null, now);
    expect(grant.until.toISOString()).toBe("2026-10-13T05:00:00.000Z");
    expect(grant.amountIdr).toBe(0);
    expect(appleFounderGrant("Sandbox", "a@b.c", undefined, 15000, null, now).amountIdr).toBe(0);
  });

  test("the day stacks on an active period", () => {
    const active = new Date("2026-10-20T00:00:00Z");
    const first = appleFounderGrant("Sandbox", "a@b.c", allow, 0, active, now);
    expect(first.until.toISOString()).toBe("2026-10-21T00:00:00.000Z");
  });

  test("yearly grants 12 months in production and allowlisted sandbox", () => {
    const prod = appleFounderGrant("Production", "x@y.z", allow, 290000, null, now, 12);
    expect(prod.until.toISOString()).toBe("2027-10-12T05:00:00.000Z");
    expect(prod.amountIdr).toBe(290000);
    const sb = appleFounderGrant("Sandbox", "owner@joyo.id", allow, 290000, null, now, 12);
    expect(sb.until.toISOString()).toBe("2027-10-12T05:00:00.000Z");
  });

  test("non-allowlisted sandbox yearly is still 24h at zero revenue", () => {
    const grant = appleFounderGrant("Sandbox", "a@b.c", allow, 290000, null, now, 12);
    expect(grant.until.toISOString()).toBe("2026-10-13T05:00:00.000Z");
    expect(grant.amountIdr).toBe(0);
  });
});

describe("founder price ladder", () => {
  const LADDER = parseLadder("10:15000,110:29000,:49000")!;
  const LADDER_OVERRIDE = parseLadder("10:15000,110:29000,:49000", 250_000)!;
  const YEARLY_LADDER = "10:15000/149000,110:29000/199000,:49000/349000";

  test("empty var means flat pricing", () => {
    expect(parseLadder(undefined)).toBeNull();
    expect(parseLadder("")).toBeNull();
    expect(parseLadder("  ")).toBeNull();
  });

  test("malformed ladders fail loudly", () => {
    expect(() => parseLadder("abc:15000")).toThrow("FOUNDER_PRICE_LADDER");
    expect(() => parseLadder("10:")).toThrow("FOUNDER_PRICE_LADDER");
    expect(() => parseLadder("10:0")).toThrow("FOUNDER_PRICE_LADDER");
    expect(() => parseLadder("10:15000,5:29000")).toThrow("strictly increase");
    expect(() => parseLadder("10:15000,:29000,:49000")).toThrow("open-ended");
  });

  test("current rung respects buyer boundaries", () => {
    expect(ladderStep(LADDER, 0).monthlyIdr).toBe(15_000);
    expect(ladderStep(LADDER, 9).monthlyIdr).toBe(15_000);
    expect(ladderStep(LADDER, 10).monthlyIdr).toBe(29_000);
    expect(ladderStep(LADDER, 109).monthlyIdr).toBe(29_000);
    expect(ladderStep(LADDER, 110).monthlyIdr).toBe(49_000);
    expect(ladderStep(LADDER, 111).monthlyIdr).toBe(49_000);
  });

  test("promo advertises the next step and stops on the open rung", () => {
    expect(promoFor(LADDER, 5)).toEqual({ slots: 10, taken: 5, nextPriceIdr: 29_000 });
    expect(promoFor(LADDER, 10)).toEqual({ slots: 110, taken: 10, nextPriceIdr: 49_000 });
    expect(promoFor(LADDER, 110)).toBeNull();
    expect(promoFor(null, 5)).toBeNull();
  });

  test("grandfathering keeps the lowest monthly-equivalent ever paid", () => {
    expect(grandfatheredMonthlyIdr([])).toBeNull();
    expect(grandfatheredMonthlyIdr([{ amountIdr: 29_000, months: 1 }])).toBe(29_000);
    // A yearly order counts as amount/10 per month.
    expect(grandfatheredMonthlyIdr([{ amountIdr: 290_000, months: 12 }])).toBe(29_000);
    expect(
      grandfatheredMonthlyIdr([
        { amountIdr: 29_000, months: 1 },
        { amountIdr: 150_000, months: 12 },
      ]),
    ).toBe(15_000);
  });

  test("paywallConfig parses the ladder and honours the yearly override", () => {
    const config = paywallConfig({
      FOUNDER_PRICE_LADDER: "10:15000,110:29000,:49000",
      FOUNDER_YEARLY_PRICE_IDR: "250000",
    });
    expect(config.founderLadder).toEqual(LADDER_OVERRIDE);
    expect(ladderStep(config.founderLadder!, 0).monthlyIdr).toBe(15_000);
    expect(promoFor(config.founderLadder, 0)?.nextPriceIdr).toBe(29_000);
    expect(config.founderPriceIdr).toBe(15_000);
    expect(config.founderYearlyPriceIdr).toBe(250_000);
  });

  test("explicit per-step yearly prices", () => {
    const ladder = parseLadder(YEARLY_LADDER)!;
    expect(ladder).toEqual([
      { upToBuyers: 10, monthlyIdr: 15_000, yearlyIdr: 149_000 },
      { upToBuyers: 110, monthlyIdr: 29_000, yearlyIdr: 199_000 },
      { upToBuyers: null, monthlyIdr: 49_000, yearlyIdr: 349_000 },
    ]);
    expect(ladderStep(ladder, 9).yearlyIdr).toBe(149_000);
    expect(ladderStep(ladder, 12).yearlyIdr).toBe(199_000);
    expect(ladderStep(ladder, 110).yearlyIdr).toBe(349_000);
  });

  test("legacy syntax: yearly is 10x monthly, or the override capped at 10x", () => {
    expect(LADDER.map((s) => s.yearlyIdr)).toEqual([150_000, 290_000, 490_000]);
    expect(LADDER_OVERRIDE.map((s) => s.yearlyIdr)).toEqual([150_000, 250_000, 250_000]);
  });

  test("steps may mix explicit and implicit yearly", () => {
    const ladder = parseLadder("10:15000/149000,:29000", 199_000)!;
    expect(ladder.map((s) => s.yearlyIdr)).toEqual([149_000, 199_000]);
  });

  test("malformed yearly parts fail loudly", () => {
    expect(() => parseLadder("10:15000/")).toThrow("FOUNDER_PRICE_LADDER");
    expect(() => parseLadder("10:15000/abc")).toThrow("FOUNDER_PRICE_LADDER");
    expect(() => parseLadder("10:15000/0")).toThrow("FOUNDER_PRICE_LADDER");
    expect(() => parseLadder("10:15000/-5")).toThrow("FOUNDER_PRICE_LADDER");
    expect(() => parseLadder("10:15000/1/2")).toThrow("FOUNDER_PRICE_LADDER");
    expect(() => parseLadder("10:15000.5")).toThrow("FOUNDER_PRICE_LADDER");
    expect(() => parseLadder("10:15000/149000,5:29000/199000")).toThrow("strictly increase");
    expect(() => parseLadder("10:15000", 0)).toThrow("FOUNDER_YEARLY_PRICE_IDR");
  });

  test("checkout amounts follow the current step", () => {
    const ladder = parseLadder(YEARLY_LADDER)!;
    const first = ladderStep(ladder, 0);
    const current = ladderStep(ladder, 12);
    const open = ladderStep(ladder, 200);
    expect(checkoutAmountIdr(first, "monthly", null)).toBe(15_000);
    expect(checkoutAmountIdr(first, "yearly", null)).toBe(149_000);
    expect(checkoutAmountIdr(current, "monthly", null)).toBe(29_000);
    expect(checkoutAmountIdr(current, "yearly", null)).toBe(199_000);
    expect(checkoutAmountIdr(open, "monthly", null)).toBe(49_000);
    expect(checkoutAmountIdr(open, "yearly", null)).toBe(349_000);
  });

  test("grandfathered buyers never pay above their locked price", () => {
    const ladder = parseLadder(YEARLY_LADDER)!;
    const step3 = ladderStep(ladder, 200);
    // Paid a Rp149k yearly before: monthly-equivalent 14.9k.
    const locked = grandfatheredMonthlyIdr([{ amountIdr: 149_000, months: 12 }]);
    expect(checkoutAmountIdr(step3, "yearly", locked)).toBe(149_000);
    expect(checkoutAmountIdr(step3, "monthly", locked)).toBe(14_900);
    // A locked price above the rung is ignored.
    expect(checkoutAmountIdr(ladderStep(ladder, 0), "yearly", 29_000)).toBe(149_000);
    expect(checkoutAmountIdr(ladderStep(ladder, 0), "monthly", 29_000)).toBe(15_000);
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
