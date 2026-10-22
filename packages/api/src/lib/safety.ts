// "Pelan-pelan" safety note for people who are losing weight quickly, and the protein-per-kilo guide line of the
// day summary. Pure math shared by the server and both clients. Nothing here is medical advice: the note says "slow
// down a bit, eat enough protein, ask a doctor or dietitian if unsure", the guide line is a guide and not a
// prescription, and every threshold below is the app's product choice (named, with its reasoning), not a clinical cut-off.

import { PROTEIN_G_PER_KG } from "./gain";
import { daysBetween, emaTrendPoints, shiftDate } from "./engine";
import type { WeighIn } from "./engine";

/** A sustained fall faster than this (% of body weight per week) trips the note. 0.5-1% a week is the usual "steady" pace; past 1% the fall is mostly water and muscle. Gain plans keep their own, stricter 0.5% flag (gain.ts RAPID_LOSS_PCT_PER_WEEK). */
export const FAST_LOSS_PCT_PER_WEEK = 1;
/** The first days of a new weigh-in habit or plan drop water and glycogen (a kilo in the first week is normal), so nothing the weight says counts until this many days after the first weigh-in ... */
export const FAST_LOSS_SETTLE_DAYS = 14;
/** ... then the pace is the least-squares slope of the weigh-ins of the last 28 days (settled days only) ... */
export const FAST_LOSS_WINDOW_DAYS = 28;
/** ... from at least 4 weigh-ins, so one noisy reading (a heavy meal, a salty day) can never trip it ... */
export const FAST_LOSS_MIN_WEIGH_INS = 4;
/** ... that span at least 14 days, because a pace extrapolated from a few close readings is mostly noise. */
export const FAST_LOSS_MIN_SPAN_DAYS = 14;

/** A day this far under the body's resting energy (BMR, Mifflin-St Jeor) is "far below"; 0.8 x BMR is a larger gap than any deficit the plan itself asks for. */
export const LOW_INTAKE_BMR_FRACTION = 0.8;
/** Hard floor (kcal) for small bodies, where 0.8 x BMR drops under what any adult should eat day after day. */
export const LOW_INTAKE_FLOOR_KCAL = 1000;
/** The last 5 days before today are looked at; today is still being logged, so it never counts. */
export const LOW_INTAKE_WINDOW_DAYS = 5;
/** At least 3 of those 5 days must be far below, so one skipped day or a fast never trips it. */
export const LOW_INTAKE_MIN_DAYS = 3;
/** A day only counts when it looks fully logged: at least 3 different meal slots with food, ... */
export const FULL_DAY_MIN_MEALS = 3;
/** ... and at least this many kcal in total, so a day of three logged coffees is a skipped day, not a fast. */
export const FULL_DAY_MIN_KCAL = 300;

/** Days the note stays closed after "Tutup" (a device-local date stamp). */
export const FAST_LOSS_DISMISS_DAYS = 3;

export type FastLossReason = "weight" | "intake";

export type FastLossNote = {
  /** What tripped the note; one card, whichever reasons apply. */
  reasons: FastLossReason[];
  /** Smoothed fall in % of body weight per week (one decimal, positive); null unless the weight reason applies. */
  weeklyPct: number | null;
  /** How many of the last 5 days looked fully logged and far below; 0 unless the intake reason applies. */
  lowIntakeDays: number;
};

export type LoggedDay = {
  date: string;
  /** Total kcal logged that day. */
  kcal: number;
  /** Distinct meal slots with food that day. */
  meals: number;
};

/**
 * Weekly fall in % of body weight: the least-squares slope of the raw weigh-ins of the last 28 days, counting only
 * days at least 14 days after the first weigh-in (`weighIns` is the whole history the caller has, ascending, ~60 days;
 * a history cut short only makes this more cautious). Null when the weigh-ins cannot say.
 */
export function weeklyLossPct(weighIns: WeighIn[], today: string): number | null {
  const first = weighIns[0];
  if (!first) return null;
  const settled = shiftDate(first.date, FAST_LOSS_SETTLE_DAYS);
  const from = shiftDate(today, -(FAST_LOSS_WINDOW_DAYS - 1));
  const points = weighIns.filter((w) => w.date >= settled && w.date >= from && w.date <= today);
  const start = points[0];
  const end = points.at(-1);
  if (!start || !end || points.length < FAST_LOSS_MIN_WEIGH_INS) return null;
  if (daysBetween(start.date, end.date) < FAST_LOSS_MIN_SPAN_DAYS) return null;
  const xs = points.map((w) => daysBetween(start.date, w.date));
  const meanX = xs.reduce((a, b) => a + b, 0) / xs.length;
  const meanY = points.reduce((a, w) => a + w.weightKg, 0) / points.length;
  let num = 0;
  let den = 0;
  points.forEach((w, i) => {
    num += (xs[i]! - meanX) * (w.weightKg - meanY);
    den += (xs[i]! - meanX) ** 2;
  });
  if (den === 0 || meanY <= 0) return null;
  return (-((num / den) * 7) / meanY) * 100;
}

/** Days among the last 5 before `today` that look fully logged and sit far below the body's resting energy. */
export function lowIntakeDays(days: LoggedDay[], bmrKcal: number, today: string): number {
  const from = shiftDate(today, -LOW_INTAKE_WINDOW_DAYS);
  const limit = Math.max(LOW_INTAKE_BMR_FRACTION * bmrKcal, LOW_INTAKE_FLOOR_KCAL);
  return days.filter(
    (d) =>
      d.date >= from &&
      d.date < today &&
      d.meals >= FULL_DAY_MIN_MEALS &&
      d.kcal >= FULL_DAY_MIN_KCAL &&
      d.kcal < limit,
  ).length;
}

/**
 * The note for today, or null. Hamil / Menyusui never get weight-loss messaging, and a gain plan has its own flag, so
 * both return null before anything is measured. No weigh-ins, no note from the weight reason; no complete days, none
 * from the intake reason.
 */
export function fastLossNote(input: {
  today: string;
  /** Weigh-ins ascending, on or before today, ~60 days. */
  weighIns: WeighIn[];
  /** Per-day intake of the recent days (excluding imported history), ~10 days is enough. */
  days: LoggedDay[];
  bmrKcal: number;
  maternal: boolean;
  gaining: boolean;
}): FastLossNote | null {
  if (input.maternal || input.gaining) return null;
  const reasons: FastLossReason[] = [];
  const pct = weeklyLossPct(input.weighIns, input.today);
  const weight = pct !== null && pct >= FAST_LOSS_PCT_PER_WEEK;
  if (weight) reasons.push("weight");
  const lowDays = lowIntakeDays(input.days, input.bmrKcal, input.today);
  const intake = lowDays >= LOW_INTAKE_MIN_DAYS;
  if (intake) reasons.push("intake");
  if (reasons.length === 0) return null;
  return {
    reasons,
    weeklyPct: weight && pct !== null ? Math.round(pct * 10) / 10 : null,
    lowIntakeDays: intake ? lowDays : 0,
  };
}

/** Whether a stored "Tutup" date stamp (YYYY-MM-DD) still hides the note on `today`. A malformed stamp hides nothing. */
export function isFastLossDismissed(stamp: string | null | undefined, today: string): boolean {
  if (!stamp || !/^\d{4}-\d{2}-\d{2}$/.test(stamp)) return false;
  const elapsed = daysBetween(stamp, today);
  return elapsed >= 0 && elapsed < FAST_LOSS_DISMISS_DAYS;
}

/**
 * The protein guide of the day summary, g per kg of body weight. Gain plans keep the gain range (gain.ts
 * PROTEIN_G_PER_KG, unchanged). Everyone else sees 1.2-1.6: a product guide for adults eating in a deficit and for
 * generally active adults, above the 0.8 g/kg minimum and below the 1.6-2.2 range of a deliberate gain.
 */
export const PROTEIN_GUIDE_G_PER_KG = { min: 1.2, max: 1.6 } as const;

export type ProteinPerKg = {
  /** Eaten protein per kg, one decimal. */
  gPerKg: number;
  guide: { min: number; max: number };
};

/**
 * Eaten protein against the latest weigh-in. Null when there is nothing honest to say: no weight, or no row with a
 * protein figure (`proteinKnown` false: unknown is not zero), and never for Hamil / Menyusui, who keep the AKG target
 * and no weight-loss framing.
 */
export function proteinPerKg(input: {
  proteinG: number;
  proteinKnown: boolean;
  weightKg: number | null;
  gaining: boolean;
  maternal: boolean;
}): ProteinPerKg | null {
  if (input.maternal || !input.proteinKnown) return null;
  if (input.weightKg === null || !(input.weightKg > 0)) return null;
  return {
    gPerKg: Math.round((input.proteinG / input.weightKg) * 10) / 10,
    guide: input.gaining
      ? { min: PROTEIN_G_PER_KG.min, max: PROTEIN_G_PER_KG.max }
      : { min: PROTEIN_GUIDE_G_PER_KG.min, max: PROTEIN_GUIDE_G_PER_KG.max },
  };
}
