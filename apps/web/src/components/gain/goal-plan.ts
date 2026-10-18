import { idealWeightRange, MAX_TARGET_DAYS } from "@joyorogo/api/lib/engine";
import {
  bmiOf,
  GAIN_MIN_GAP_KG,
  goalTargetError,
  suggestedDays,
  suggestGainTarget,
  UNDERWEIGHT_BMI,
} from "@joyorogo/api/lib/gain";
import type { Goal } from "@joyorogo/api/lib/gain";

/** Inline message (gain namespace) for an explicit goal that sits on the wrong side of the target. */
export const GOAL_ERROR_KEY = {
  goalGainTarget: "gain:goal.hint.gain",
  goalLoseTarget: "gain:goal.hint.lose",
} as const;

/** What the chooser follows while the user types a target: above the weight is gain, otherwise lose. */
export function typedGoal(weightNowKg: number | null, targetKg: number | null): Goal {
  if (weightNowKg === null || targetKg === null) return "lose";
  return targetKg >= weightNowKg + GAIN_MIN_GAP_KG ? "gain" : "lose";
}

/** Days from today of the date that reaches `targetKg` at the lean pace (a gainOk date). */
export function leanPaceDays(weightNowKg: number, targetKg: number, heightCm: number): number {
  const gapKg = Math.max(GAIN_MIN_GAP_KG, targetKg - weightNowKg);
  const underweight = bmiOf(weightNowKg, heightCm) < UNDERWEIGHT_BMI;
  return Math.min(MAX_TARGET_DAYS, Math.max(1, suggestedDays(gapKg, weightNowKg, underweight)));
}

/**
 * The target and date the app offers when the chooser switches to `goal`: a suggested gain
 * at the lean pace, or a modest loss over 90 days (today's default flow). Jaga BB has none.
 */
export function planForGoal(
  goal: Goal,
  weightNowKg: number,
  heightCm: number | null,
): { targetKg: number; days: number } | null {
  if (goal === "gain" && heightCm !== null) {
    const ideal = idealWeightRange(heightCm);
    const targetKg = suggestGainTarget(weightNowKg, heightCm, ideal.minKg, ideal.maxKg);
    return { targetKg, days: leanPaceDays(weightNowKg, targetKg, heightCm) };
  }
  if (goal === "lose") {
    return { targetKg: Math.max(25, Math.round((weightNowKg - 5) * 10) / 10), days: 90 };
  }
  return null;
}

/**
 * The goal to send with a target edit: the plan's goal while it still sits on the right side
 * of the target, else nothing (the server then keeps the stored goal or derives it). A reached
 * loss target must not be sent as an explicit "lose".
 */
export function settleableGoal(goal: Goal, weightNowKg: number, targetKg: number): Goal | undefined {
  return goalTargetError(goal, weightNowKg, targetKg) === null ? goal : undefined;
}
