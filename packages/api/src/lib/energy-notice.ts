import { computeTargets } from "./engine";
import type { ActivityLevel } from "./engine";
import type { Plan } from "./plan";

// The one-time notice that the daily eat target is now built on TDEE (BMR x the activity factor of the chosen level)
// instead of the bare BMR. Shown to every account made before the change until it is closed (the synced pref
// `dismissed.energyModel`); accounts made after never see it. Contract for humans: docs/energy-model.md.

/** Accounts created before this moment (the deploy of the TDEE model) see the notice. */
export const ENERGY_NOTICE_BEFORE_MS = Date.UTC(2026, 9, 19, 7, 0, 0);

/** The synced preference that records the notice was closed. */
export const ENERGY_NOTICE_PREF_KEY = "dismissed.energyModel";

/** Whether the notice shows: an account made before the change, not yet closed. */
export function showEnergyNotice(input: { accountCreatedAtMs: number; dismissed: boolean }): boolean {
  return !input.dismissed && input.accountCreatedAtMs < ENERGY_NOTICE_BEFORE_MS;
}

export type EnergyNotice = {
  /** the base eat target before the change (BMR less the deficit, plus surplus), for today's weight */
  oldKcal: number;
  /** the base eat target now (TDEE less the deficit, plus surplus) */
  newKcal: number;
  level: ActivityLevel;
  factor: number;
  bmrKcal: number;
  tdeeKcal: number;
};

/**
 * Old target -> new target for this person. The old model is the same plan with a factor of 1 (the bare BMR). Hamil /
 * Menyusui targets did not change (their multipliers were kept), so both numbers are the same.
 */
export function energyNotice(
  plan: Pick<Plan, "profileInput" | "targets" | "weightNowKg" | "maternal">,
  today?: string,
): EnergyNotice {
  const { targets } = plan;
  // Same day as `targets` was computed for, so the deficit (kg to lose over the days left) is the same in both figures.
  const oldKcal =
    plan.maternal === null
      ? computeTargets(plan.profileInput, { weightNow: plan.weightNowKg, activityFactor: 1, today }).eatKcal
      : targets.eatKcal;
  return {
    oldKcal,
    newKcal: targets.eatKcal,
    level: targets.level,
    factor: targets.factor,
    bmrKcal: targets.bmr,
    tdeeKcal: targets.tdee,
  };
}
