import { describe, expect, test } from "bun:test";

import { canHostChallenge } from "./challenge-host";
import { paywallConfig } from "./tiers";

const HOSTED = paywallConfig({ FREE_DAILY_SCANS: "3", FOUNDER_DAILY_CAP: "100" });
const SELF_HOST = paywallConfig({});
const now = new Date("2026-10-15T05:00:00Z");
const later = new Date("2026-11-15T05:00:00Z");
const earlier = new Date("2026-09-15T05:00:00Z");

describe("canHostChallenge", () => {
  test("a free user cannot host on a hosted paywall", () => {
    expect(canHostChallenge({ tier: "free", founderUntil: null }, HOSTED, now)).toBe(false);
    expect(canHostChallenge(undefined, HOSTED, now)).toBe(false);
  });

  test("a paid Founder hosts while the period runs, not after it lapsed", () => {
    expect(canHostChallenge({ tier: "free", founderUntil: later }, HOSTED, now)).toBe(true);
    expect(canHostChallenge({ tier: "free", founderUntil: earlier }, HOSTED, now)).toBe(false);
  });

  test("a comped Founder always hosts", () => {
    expect(canHostChallenge({ tier: "founder", founderUntil: null }, HOSTED, now)).toBe(true);
  });

  test("without a paywall everyone hosts", () => {
    expect(canHostChallenge({ tier: "free", founderUntil: null }, SELF_HOST, now)).toBe(true);
  });
});
