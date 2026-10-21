// Naikin BB (weight gain / lean bulk): pure math shared by the server and both
// clients. The plan is the usual TDEE plus a daily surplus that follows from the
// pace the target date asks for, clamped to a window that keeps the gain mostly
// lean. Nothing here is medical advice; it names numbers from the cited sources
// and flags where the app made a product decision.
//
// This file has no runtime import from ./engine on purpose: engine builds on it.
//
// Sources (full notes and caveats in docs/gain-mode.md):
//   Iraki 2019    Iraki, Fitschen, Espinar, Helms. Nutrition Recommendations for
//                 Bodybuilders in the Off-Season: A Narrative Review. Sports 7(7):154.
//                 Table 1: +10-20% above maintenance, ~0.25-0.5% BW/week
//                 (novice/intermediate), protein 1.6-2.2 g/kg, fat 0.5-1.5 g/kg.
//   ISSN 2017     Aragon et al., diets and body composition position stand (JISSN 14:16):
//                 gaining lean mass is driven by a sustained surplus whose size and
//                 the trainee's experience shape what is gained. Jager et al., protein
//                 and exercise position stand (JISSN 14:20): 1.4-2.0 g/kg/day.
//   Morton 2018   Br J Sports Med 52:376: no further training-induced fat-free mass
//                 gain beyond 1.62 g/kg/day of protein (upper 95% CI 2.2).
//   Wishnofsky    Am J Clin Nutr 6(5):542, 1958: 3500 kcal per pound = 7700 kcal per kg of
//   1958          body weight gained or lost. An approximation: gained mass is partly lean
//                 and the real cost per kg moves with the mix and with the person.
//   WHO           BMI cut-offs: underweight < 18.5, moderate thinness 16.0-16.99, healthy
//                 upper limit 24.9.

/** What the user is working toward. Stored on the profile (db `profile.goal`). */
export const GOALS = ["lose", "maintain", "gain"] as const;
export type Goal = (typeof GOALS)[number];

/** Energy of one kg of body weight change, the usual approximation (Wishnofsky 1958). */
export const KCAL_PER_KG = 7700;

/** Daily surplus window (kcal): below the floor it is noise, above the cap it is mostly fat. */
export const MIN_SURPLUS_KCAL = 200;
export const MAX_SURPLUS_KCAL = 700;

/** A target this close above the weight is the same weight: the scale is noisier than that. */
export const GAIN_MIN_GAP_KG = 0.1;

/** Whether a target-minus-weight gap (kg) is a real gain; compared at 0.01 kg so float noise never decides it. */
export function isGainGap(gapKg: number): boolean {
  return Math.round(gapKg * 100) / 100 >= GAIN_MIN_GAP_KG;
}

/**
 * Pace in percent of body weight per week. Iraki 2019: 0.25-0.5 for novice and
 * intermediate lifters. The 1.0 ceiling is a product choice: past it the app warns and
 * suggests a later date. Beginners and underweight people may sit between 0.5 and 1
 * without a note (larger surpluses suit novices, and a faster early gain is reasonable
 * when restoring weight, both said in Iraki 2019); that band is the app's reading,
 * not a number the review states.
 */
export const PACE_PCT = { leanMin: 0.25, leanMax: 0.5, ceiling: 1 } as const;
/** The pace a suggested later date aims for: top of the lean band; midway to the ceiling when underweight. */
const SUGGESTED_PACE_PCT = { normal: PACE_PCT.leanMax, underweight: 0.75 } as const;

export const UNDERWEIGHT_BMI = 18.5;
/** Below this BMI (WHO moderate thinness) the app shows a gentle see-a-doctor note. */
export const CONSULT_BMI = 17;
/** Above this BMI the target is past the healthy range: noted, never blocked. */
export const HEALTHY_BMI_MAX = 25;

/** Protein, g per kg: Iraki 2019 range 1.6-2.2; the target sits above Morton's 1.62 breakpoint and inside ISSN's 2.0. */
export const PROTEIN_G_PER_KG = { min: 1.6, target: 1.8, max: 2.2 } as const;

/** Eating this much over the target still reads as "Target tercapai": the width of the surplus cap step. */
export const REACHED_MARGIN_KCAL = 300;
/** A day counts toward the gain streak from this share of the target. */
export const STREAK_FRACTION = 0.9;
/** A smoothed trend falling faster than this (% of body weight per week) while gaining is a see-a-doctor note. */
export const RAPID_LOSS_PCT_PER_WEEK = 0.5;

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;
const round5 = (n: number) => Math.round(n / 5) * 5;

export function bmiOf(weightKg: number, heightCm: number): number {
  const m = heightCm / 100;
  return weightKg / (m * m);
}

/**
 * The goal a weight and a target imply: above the weight is gain, below is lose, the
 * same weight (within the scale's noise above it) is maintain. Loss compares raw, as the
 * plan always has.
 */
export function goalOf(weightNowKg: number, targetKg: number): Goal {
  if (weightNowKg > targetKg) return "lose";
  return isGainGap(targetKg - weightNowKg) ? "gain" : "maintain";
}

/**
 * The goal to store when a target is edited. An explicit choice wins; an unchanged target
 * keeps the stored goal (a date-only edit must not turn a reached loss target into a
 * gain); a changed target is re-derived.
 */
export function resolveGoal(input: {
  explicit?: Goal | null;
  stored: Goal;
  weightNowKg: number;
  currentTargetKg: number;
  nextTargetKg: number;
}): Goal {
  if (input.explicit) return input.explicit;
  if (input.nextTargetKg === input.currentTargetKg) return input.stored;
  return goalOf(input.weightNowKg, input.nextTargetKg);
}

/**
 * An explicit goal has to sit on the right side of the target. "maintain" has no target
 * of its own: the plan holds the current weight.
 */
export function goalTargetError(
  goal: Goal,
  weightNowKg: number,
  targetKg: number,
): "goalGainTarget" | "goalLoseTarget" | null {
  if (goal === "gain" && !isGainGap(targetKg - weightNowKg)) return "goalGainTarget";
  if (goal === "lose" && targetKg >= weightNowKg) return "goalLoseTarget";
  return null;
}

/** Hamil / Menyusui take precedence over any goal: gain is off while they are on. */
export type PlanGoal = Goal | "maternal";
export function planGoal(input: { maternalMode: string; goal: Goal }): PlanGoal {
  return input.maternalMode === "none" ? input.goal : "maternal";
}

// --- Pace and surplus --------------------------------------------------------

export type GainBand = "lean" | "brisk" | "fast";

/** lean: inside the band; brisk: above 0.5% but inside 1% (beginner pace, a note); fast: above 1%. Underweight has no brisk band. */
export function paceBand(pacePct: number, underweight: boolean): GainBand {
  if (pacePct > PACE_PCT.ceiling) return "fast";
  if (!underweight && pacePct > PACE_PCT.leanMax) return "brisk";
  return "lean";
}

/** kg per week that a daily surplus delivers. */
export function paceKgPerWeek(surplusKcal: number): number {
  return (surplusKcal * 7) / KCAL_PER_KG;
}

/**
 * The weekly gain band drawn on the weight chart, kg/week: 0.25-0.5% of body weight, or
 * 0.5-1% when underweight (BMI under 18.5).
 */
export function paceBandKgPerWeek(weightKg: number, heightCm: number): { minKg: number; maxKg: number } {
  const [lowPct, highPct] =
    bmiOf(weightKg, heightCm) < UNDERWEIGHT_BMI
      ? [PACE_PCT.leanMax, PACE_PCT.ceiling]
      : [PACE_PCT.leanMin, PACE_PCT.leanMax];
  return { minKg: round2((lowPct / 100) * weightKg), maxKg: round2((highPct / 100) * weightKg) };
}

/** The daily surplus a date asks for, before the clamp. */
export function rawSurplusKcal(gapKg: number, days: number): number {
  return (gapKg * KCAL_PER_KG) / Math.max(1, days);
}

export function clampSurplus(raw: number): number {
  return Math.min(MAX_SURPLUS_KCAL, Math.max(MIN_SURPLUS_KCAL, round5(raw)));
}

/** Days to cover `gapKg` at a daily surplus. */
export function daysAtSurplus(gapKg: number, surplusKcal: number): number {
  return Math.ceil((gapKg * KCAL_PER_KG) / Math.max(1, surplusKcal));
}

/** Percent of body weight per week that covering `gapKg` in `days` days asks for. */
export function pacePctOf(gapKg: number, days: number, weightNowKg: number): number {
  return ((gapKg / (Math.max(1, days) / 7)) / weightNowKg) * 100;
}

/**
 * Days of the later date offered when a pace is too fast: the suggested pace of
 * the body (top of the lean band; 0.75% underweight), never faster than the surplus cap allows.
 */
export function suggestedDays(gapKg: number, weightNowKg: number, underweight: boolean): number {
  const pct = underweight ? SUGGESTED_PACE_PCT.underweight : SUGGESTED_PACE_PCT.normal;
  const kgPerWeek = Math.min((pct / 100) * weightNowKg, paceKgPerWeek(MAX_SURPLUS_KCAL));
  return Math.ceil((gapKg / kgPerWeek) * 7);
}

// --- The plan numbers --------------------------------------------------------

export type GainFlag = "BMI_LOW" | "TARGET_ABOVE_HEALTHY" | "RAPID_LOSS";

/**
 * Things the clients explain next to the numbers. They never block anything.
 *  BMI_LOW               BMI under 17: a gentle see-a-doctor note
 *  TARGET_ABOVE_HEALTHY  the target BMI is over 25: the target is above the healthy range
 *  RAPID_LOSS            the trend is falling fast while the plan is to gain: see-a-doctor note
 */
export type GainInfo = {
  /** the daily surplus on top of the TDEE (clamped) */
  surplusKcal: number;
  /** what the target date asks for before the clamp */
  rawSurplusKcal: number;
  /** target minus current weight, kg */
  gapKg: number;
  /** kg/week the applied surplus delivers */
  paceKgPerWeek: number;
  /** the same pace as percent of current body weight per week */
  pacePct: number;
  band: GainBand;
  /** whole days to the target at the applied surplus */
  daysToTarget: number;
  /** Day the target is reached at the applied surplus */
  reachDate: string;
  /** daily protein, g: the ISSN / Iraki range and the target inside it */
  protein: { minG: number; targetG: number; maxG: number };
  bmi: number;
  targetBmi: number;
  flags: GainFlag[];
};

/** The part of GainInfo that needs no calendar. */
export type GainNumbers = Omit<GainInfo, "reachDate">;

export function gainNumbers(input: {
  weightNowKg: number;
  targetKg: number;
  heightCm: number;
  /** days from today to the target date */
  days: number;
  /** top of the healthy weight range; protein is not scaled past it, as for the cut */
  idealMaxKg: number;
}): GainNumbers {
  const gapKg = round2(input.targetKg - input.weightNowKg);
  const raw = rawSurplusKcal(gapKg, input.days);
  const surplusKcal = clampSurplus(raw);
  const bmi = bmiOf(input.weightNowKg, input.heightCm);
  const targetBmi = bmiOf(input.targetKg, input.heightCm);
  const kg = paceKgPerWeek(surplusKcal);
  const pacePct = (kg / input.weightNowKg) * 100;
  const basis = Math.min(input.weightNowKg, input.idealMaxKg);
  const flags: GainFlag[] = [];
  if (bmi < CONSULT_BMI) flags.push("BMI_LOW");
  if (targetBmi > HEALTHY_BMI_MAX) flags.push("TARGET_ABOVE_HEALTHY");
  return {
    surplusKcal,
    rawSurplusKcal: Math.round(raw),
    gapKg,
    paceKgPerWeek: round2(kg),
    pacePct: round2(pacePct),
    band: paceBand(pacePct, bmi < UNDERWEIGHT_BMI),
    daysToTarget: daysAtSurplus(gapKg, surplusKcal),
    protein: {
      minG: Math.round(PROTEIN_G_PER_KG.min * basis),
      targetG: Math.round(PROTEIN_G_PER_KG.target * basis),
      maxG: Math.round(PROTEIN_G_PER_KG.max * basis),
    },
    bmi: round1(bmi),
    targetBmi: round1(targetBmi),
    flags,
  };
}

/** True when the smoothed weekly rate (kg/week, negative = losing) is a fast fall for this body. */
export function isRapidLoss(weeklyRateKg: number | null, weightKg: number): boolean {
  return weeklyRateKg !== null && weeklyRateKg <= -((RAPID_LOSS_PCT_PER_WEEK / 100) * weightKg);
}

/**
 * A starting target for someone who picks "Naikin BB": underweight people head for the
 * lower edge of the healthy range, everyone else for about 3 kg more, never beyond the
 * healthy range when they are inside it.
 */
export function suggestGainTarget(weightNowKg: number, heightCm: number, idealMinKg: number, idealMaxKg: number): number {
  if (bmiOf(weightNowKg, heightCm) < UNDERWEIGHT_BMI) {
    return Math.max(idealMinKg, Math.round(weightNowKg + 2));
  }
  return Math.min(Math.round(weightNowKg + 3), Math.max(idealMaxKg, Math.round(weightNowKg + 1)));
}

// --- The day -----------------------------------------------------------------

export type GainIntakeState = "short" | "reached" | "over";

/**
 * "Sisa" under a gain plan. Under-eating is the problem, so the number is what is still
 * to eat: short ("Kurang X kkal lagi"), reached (at the target, and up to
 * REACHED_MARGIN_KCAL over it), or over (more than the margin above the target; the
 * kcal are the amount above the target, shown without any pressure).
 */
export function gainRemaining(targetKcal: number, eatenKcal: number): { state: GainIntakeState; kcal: number } {
  const left = Math.round(targetKcal - eatenKcal);
  if (left > 0) return { state: "short", kcal: left };
  const over = -left;
  return over <= REACHED_MARGIN_KCAL ? { state: "reached", kcal: 0 } : { state: "over", kcal: over };
}

/** Eat-ring tone under a gain plan: never red; amber only past the margin. */
export function gainEatTone(eatenKcal: number, targetKcal: number): "ok" | "near" {
  return targetKcal > 0 && eatenKcal > targetKcal + REACHED_MARGIN_KCAL ? "near" : "ok";
}

/** A day that counts toward the gain streak. */
export function gainDayHit(eatenKcal: number, targetKcal: number): boolean {
  return targetKcal > 0 && eatenKcal >= targetKcal * STREAK_FRACTION;
}

// --- AI prompt ---------------------------------------------------------------

/**
 * One line for the AI scan prompt (Indonesian: the prompts stay Indonesian). It keeps
 * the model from coaching toward a deficit. It does not touch the kcal estimate itself.
 */
export const GAIN_PROMPT_NOTE =
  "Konteks pengguna: sedang program naik berat badan (makan di atas kebutuhan harian). Jangan pernah menyarankan mengurangi kalori, porsi, atau berat badan, dan jangan menilai makanan sebagai terlalu banyak. Tetap sebut semua makanan dan minuman apa adanya.";
