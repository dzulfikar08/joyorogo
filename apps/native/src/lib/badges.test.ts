import { describe, expect, test } from "bun:test";

import { newlyEarned, nextThreshold, ringFor, shiftWeeks, starsFor, weekMonday, wibDate } from "./badges";

const three = { id: "konsisten", tiers: [7, 30, 100] };
const two = { id: "air-putih", tiers: [7, 30] };
const once = { id: "catatan-pertama", tiers: [1] };

describe("ringFor / starsFor", () => {
  test("locked has no ring or stars", () => {
    expect(ringFor({ ...three, tier: 0, awardedAt: null })).toBeNull();
    expect(starsFor({ ...three, tier: 0, awardedAt: null })).toBe(0);
  });
  test("three tiers: bronze, silver, gold", () => {
    expect([1, 2, 3].map((tier) => ringFor({ ...three, tier, awardedAt: 1 }))).toEqual(["bronze", "silver", "gold"]);
    expect(starsFor({ ...three, tier: 2, awardedAt: 1 })).toBe(2);
  });
  test("two tiers top out at gold", () => {
    expect([1, 2].map((tier) => ringFor({ ...two, tier, awardedAt: 1 }))).toEqual(["bronze", "gold"]);
  });
  test("one-time earned is gold without stars", () => {
    expect(ringFor({ ...once, tier: 1, awardedAt: 1 })).toBe("gold");
    expect(starsFor({ ...once, tier: 1, awardedAt: 1 })).toBe(0);
  });
});

describe("nextThreshold", () => {
  test("next tier, none when maxed, locked or one-time", () => {
    expect(nextThreshold({ ...three, tier: 1, awardedAt: 1 })).toBe(30);
    expect(nextThreshold({ ...three, tier: 3, awardedAt: 1 })).toBeNull();
    expect(nextThreshold({ ...three, tier: 0, awardedAt: null })).toBeNull();
    expect(nextThreshold({ ...once, tier: 1, awardedAt: 1 })).toBeNull();
  });
});

describe("newlyEarned", () => {
  const badges = [
    { ...three, tier: 2, awardedAt: 1 },
    { ...once, tier: 1, awardedAt: 1 },
    { ...two, tier: 0, awardedAt: null },
  ];
  test("first run records a baseline only", () => {
    expect(newlyEarned(null, badges)).toEqual([]);
  });
  test("new id or higher tier counts, locked never", () => {
    const fresh = newlyEarned(["konsisten:1"], badges).map((b) => b.id);
    expect(fresh).toEqual(["konsisten", "catatan-pertama"]);
    expect(newlyEarned(["konsisten:2", "catatan-pertama:1"], badges)).toEqual([]);
  });
});

describe("week helpers (WIB)", () => {
  test("Monday of the week and the previous one", () => {
    // Sunday 2026-10-25 20:00 UTC is Monday 2026-10-26 03:00 WIB.
    const ms = Date.UTC(2026, 9, 25, 20);
    expect(wibDate(ms)).toBe("2026-10-26");
    expect(weekMonday(ms)).toBe("2026-10-26");
    expect(weekMonday(Date.UTC(2026, 9, 27, 5))).toBe("2026-10-26");
    expect(weekMonday(Date.UTC(2026, 9, 25, 10))).toBe("2026-10-19");
    expect(shiftWeeks("2026-10-26", 1)).toBe("2026-10-19");
  });
});
