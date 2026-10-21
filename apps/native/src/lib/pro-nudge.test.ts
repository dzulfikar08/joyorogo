import { describe, expect, test } from "bun:test";

import { BENEFIT_KEYS, PAYWALL_MOMENTS, benefitOrder, paywallMoment, showScanAllowance, streakNudge } from "./pro-nudge";

describe("streakNudge", () => {
  test("shows the milestone the streak just reached", () => {
    expect(streakNudge(7, 0)).toBe(7);
    expect(streakNudge(9, 0)).toBe(7);
    expect(streakNudge(14, 7)).toBe(14);
    expect(streakNudge(100, 60)).toBe(100);
  });

  test("below the first milestone there is nothing to show", () => {
    expect(streakNudge(0, 0)).toBeNull();
    expect(streakNudge(6, 0)).toBeNull();
  });

  test("once shown (or dismissed), a milestone never comes back", () => {
    expect(streakNudge(7, 7)).toBeNull();
    expect(streakNudge(8, 7)).toBeNull();
    expect(streakNudge(14, 14)).toBeNull();
  });

  test("a streak well past its milestone is not nudged late", () => {
    expect(streakNudge(10, 0)).toBeNull();
    expect(streakNudge(45, 0)).toBeNull();
    expect(streakNudge(365, 0)).toBeNull();
  });

  test("the latest milestone wins when two are in reach", () => {
    expect(streakNudge(30, 7)).toBe(30);
  });
});

describe("showScanAllowance", () => {
  test("only a free account with a real limit sees its allowance", () => {
    expect(showScanAllowance({ tier: "free", quota: 3, left: 2 })).toBe(true);
    expect(showScanAllowance({ tier: "free", quota: 3, left: 0 })).toBe(true);
    expect(showScanAllowance({ tier: "founder", quota: 100, left: 90 })).toBe(false);
    expect(showScanAllowance({ tier: "free", quota: null, left: null })).toBe(false);
    expect(showScanAllowance(null)).toBe(false);
    expect(showScanAllowance(undefined)).toBe(false);
  });
});

describe("paywallMoment", () => {
  test("known moments pass through, anything else is the banner", () => {
    for (const moment of PAYWALL_MOMENTS) expect(paywallMoment(moment)).toBe(moment);
    expect(paywallMoment("nope")).toBe("banner");
    expect(paywallMoment(undefined)).toBe("banner");
    expect(paywallMoment(["quota"])).toBe("banner");
  });
});

describe("benefitOrder", () => {
  test("every moment lists every benefit once, led by the one it is about", () => {
    for (const moment of PAYWALL_MOMENTS) {
      const order = benefitOrder(moment);
      expect([...order].sort()).toEqual([...BENEFIT_KEYS].sort());
    }
    expect(benefitOrder("mealplan")[0]).toBe("mealPlan");
    expect(benefitOrder("sleep")[0]).toBe("sleep");
    expect(benefitOrder("recap")[0]).toBe("sleep");
    expect(benefitOrder("workout")[0]).toBe("cloud");
    expect(benefitOrder("quota")[0]).toBe("scans");
    expect(benefitOrder("challenge")[0]).toBe("challenge");
  });
});
