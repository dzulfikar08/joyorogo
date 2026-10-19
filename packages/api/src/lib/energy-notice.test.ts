import { describe, expect, test } from "bun:test";

import { ENERGY_NOTICE_BEFORE_MS, ENERGY_NOTICE_PREF_KEY, energyNotice, showEnergyNotice } from "./energy-notice";
import { computeTargets } from "./engine";
import type { ProfileInput } from "./engine";
import { isRogoPrefKey } from "./rogo-prefs";

describe("the one-time energy notice", () => {
  const before = ENERGY_NOTICE_BEFORE_MS - 1000;
  const after = ENERGY_NOTICE_BEFORE_MS + 1000;

  test("shows to an account made before the change, until it is closed", () => {
    expect(showEnergyNotice({ accountCreatedAtMs: before, dismissed: false })).toBe(true);
    expect(showEnergyNotice({ accountCreatedAtMs: before, dismissed: true })).toBe(false);
  });

  test("never shows to an account made after the change", () => {
    expect(showEnergyNotice({ accountCreatedAtMs: after, dismissed: false })).toBe(false);
  });

  test("an unknown creation time does not show it", () => {
    expect(showEnergyNotice({ accountCreatedAtMs: Number.NaN, dismissed: false })).toBe(false);
  });

  test("the dismissal is a synced pref", () => {
    expect(isRogoPrefKey(ENERGY_NOTICE_PREF_KEY)).toBe(true);
  });
});

describe("energyNotice: old target -> new target", () => {
  const profileInput: ProfileInput = {
    birthYear: 2000,
    gender: "male",
    heightCm: 171.5,
    weightKg: 107.7,
    targetWeightKg: 78,
    targetDate: "2027-06-04",
    activityLevel: "light",
  };
  const today = "2026-10-19";

  test("the old model is the bare BMR less the same deficit", () => {
    const targets = computeTargets(profileInput, { today });
    const notice = energyNotice({ profileInput, targets, weightNowKg: 107.7, maternal: null });
    // bmr 2023.9 - 1000 = 1023.9: under the floor, so the old target was the floor too
    expect(notice).toMatchObject({ oldKcal: 1500, newKcal: 1785, level: "light", factor: 1.375, bmrKcal: 2024, tdeeKcal: 2783 });
  });

  test("a heavier body above the floor: old = round5(bmr - deficit), new = round5(tdee - deficit)", () => {
    const heavy = { ...profileInput, weightKg: 160, targetWeightKg: 150 };
    const targets = computeTargets(heavy, { today });
    const notice = energyNotice({ profileInput: heavy, targets, weightNowKg: 160, maternal: null });
    expect(notice.newKcal).toBe(targets.eatKcal);
    // bmr 2546.9, deficit 10 kg * 7700 / 228 days = 338: old round5(2546.9 - 338) = 2210, new round5(3502 - 338) = 3165
    expect(notice.oldKcal).toBe(2210);
    expect(notice.newKcal).toBe(3165);
    expect(notice.newKcal).toBeGreaterThan(notice.oldKcal);
  });
});
