// Hamil (pregnancy) and Menyusui (breastfeeding) modes: pure math shared by the
// server and both clients. No deficit and no weight-loss target here: the daily
// target is maintenance TDEE on the pre-pregnancy basis plus the additions of
// Permenkes 28/2019 (AKG 2019). Nothing in this file is medical advice; it only
// names numbers from the cited sources and flags where we had to estimate.
//
// Sources (numbers verified against the documents, not from memory):
//   AKG 2019   Permenkes RI No. 28 Tahun 2019, Lampiran I, Tabel 1-3
//              (energi, protein, serat, air, vitamin A, folat, kalsium, besi, iodium).
//   IOM 2009   Weight Gain During Pregnancy: Reexamining the Guidelines
//              (total gain by pre-pregnancy BMI; provisional twin ranges).
//   FAO/WHO    Fats and fatty acids in human nutrition (2010), Table 7.2:
//   2010       DHA 200 mg/day in pregnancy and lactation.

import {
  MATERNAL_ACTIVITY_FACTOR,
  DEFAULT_SLEEP_TARGET_HOURS,
  ageFromBirthYear,
  bmrMifflin,
  daysBetween,
  idealWeightRange,
  jakartaToday,
  movementInFactorKcal,
  round5,
  shiftDate,
} from "./engine";
import { ALCOHOL_MATCH, ALCOHOL_UNLESS, caffeineMgFor } from "./intake";
import type { ProfileInput, Targets } from "./engine";

export const MATERNAL_MODES = ["none", "pregnant", "breastfeeding"] as const;
export type MaternalMode = (typeof MATERNAL_MODES)[number];

export const FEEDING_TYPES = ["exclusive", "partial"] as const;
export type FeedingType = (typeof FEEDING_TYPES)[number];

/** What the user typed: HPHT (first day of last period) or HPL (due date). */
export const PREGNANCY_DATE_KINDS = ["hpht", "hpl"] as const;
export type PregnancyDateKind = (typeof PREGNANCY_DATE_KINDS)[number];

/** Known conditions. They only trigger a "talk to your doctor/bidan" note. */
export const MATERNAL_CONDITIONS = ["gestational_diabetes", "hypertension", "anemia"] as const;
export type MaternalCondition = (typeof MATERNAL_CONDITIONS)[number];

/** A full term, HPHT to HPL (Naegele's rule: +280 days). */
export const PREGNANCY_DAYS = 280;
/** The pregnancy date may reach at most 42 weeks back; later it is stale and the app asks to end the mode. */
export const MAX_PREGNANCY_DAYS = 42 * 7;
/** Trimester starts (completed weeks): T2 = 14w0d, T3 = 28w0d. */
export const TRIMESTER_2_WEEK = 14;
export const TRIMESTER_3_WEEK = 28;
/** Baby age in months is calendar-average: 365.25 / 12. */
export const DAYS_PER_MONTH = 30.4375;
export const MAX_BABY_MONTHS = 24;
/** Pregnancy-time limit on caffeine (mg/day). */
export const CAFFEINE_LIMIT_MG = 200;

/** Everything stored on the profile row for these modes. */
export type MaternalState = {
  mode: MaternalMode;
  /** HPHT in WIB 'YYYY-MM-DD'. An entered HPL is stored as HPL - 280 days. */
  pregnancyLmp: string | null;
  /** What the user typed, so the editor shows it back the same way. */
  pregnancyDateKind: PregnancyDateKind | null;
  prePregnancyWeightKg: number | null;
  twins: boolean;
  feedingType: FeedingType | null;
  /** Baby's birth date; an entered age in months becomes a date so the age keeps advancing. */
  babyBirthDate: string | null;
  conditions: MaternalCondition[];
};

export const NO_MATERNAL: MaternalState = {
  mode: "none",
  pregnancyLmp: null,
  pregnancyDateKind: null,
  prePregnancyWeightKg: null,
  twins: false,
  feedingType: null,
  babyBirthDate: null,
  conditions: [],
};

/** The profile row columns this module reads (see packages/db schema). */
export type MaternalRow = {
  maternalMode: MaternalMode;
  pregnancyLmp: string | null;
  pregnancyDateKind: PregnancyDateKind | null;
  prePregnancyWeightKg: number | null;
  pregnancyTwins: boolean;
  breastfeedingType: FeedingType | null;
  babyBirthDate: string | null;
  maternalConditions: string[] | null;
};

function pick<T extends string>(list: readonly T[], value: unknown): T | null {
  return list.find((item) => item === value) ?? null;
}

export function maternalFromRow(row: MaternalRow): MaternalState {
  const mode = pick(MATERNAL_MODES, row.maternalMode) ?? "none";
  if (mode === "none") return NO_MATERNAL;
  return {
    mode,
    pregnancyLmp: row.pregnancyLmp,
    pregnancyDateKind: pick(PREGNANCY_DATE_KINDS, row.pregnancyDateKind),
    prePregnancyWeightKg: row.prePregnancyWeightKg,
    twins: row.pregnancyTwins,
    feedingType: pick(FEEDING_TYPES, row.breastfeedingType),
    babyBirthDate: row.babyBirthDate,
    conditions: (row.maternalConditions ?? []).flatMap((c) => pick(MATERNAL_CONDITIONS, c) ?? []),
  };
}

/** Column values for a state; the inverse of maternalFromRow. */
export function maternalToRow(state: MaternalState): MaternalRow {
  return {
    maternalMode: state.mode,
    pregnancyLmp: state.pregnancyLmp,
    pregnancyDateKind: state.pregnancyDateKind,
    prePregnancyWeightKg: state.prePregnancyWeightKg,
    pregnancyTwins: state.twins,
    breastfeedingType: state.feedingType,
    babyBirthDate: state.babyBirthDate,
    maternalConditions: state.conditions,
  };
}

// --- Dates -------------------------------------------------------------------

export function lmpFromDueDate(dueDate: string): string {
  return shiftDate(dueDate, -PREGNANCY_DAYS);
}

export function dueDateFromLmp(lmp: string): string {
  return shiftDate(lmp, PREGNANCY_DAYS);
}

export type Trimester = 1 | 2 | 3;

export type Gestation = {
  /** days since HPHT */
  days: number;
  /** completed weeks */
  weeks: number;
  /** days into the current week, 0-6 */
  dayOfWeek: number;
  trimester: Trimester;
  lmp: string;
  /** HPL */
  dueDate: string;
  /** days until HPL; negative once past it */
  daysToDue: number;
  /** past 42 weeks: the stored date is stale (or the baby is overdue); ask the user to review */
  overdue: boolean;
};

export function trimesterOfWeek(weeks: number): Trimester {
  if (weeks >= TRIMESTER_3_WEEK) return 3;
  if (weeks >= TRIMESTER_2_WEEK) return 2;
  return 1;
}

/** Null when the HPHT is after today (not a possible state). Recomputed every day. */
export function gestationalAge(lmp: string, today: string = jakartaToday()): Gestation | null {
  const days = daysBetween(lmp, today);
  if (days < 0) return null;
  const weeks = Math.floor(days / 7);
  const dueDate = dueDateFromLmp(lmp);
  return {
    days,
    weeks,
    dayOfWeek: days % 7,
    trimester: trimesterOfWeek(weeks),
    lmp,
    dueDate,
    daysToDue: daysBetween(today, dueDate),
    overdue: days > MAX_PREGNANCY_DAYS,
  };
}

/** Completed months of the baby, advancing daily with the birth date. */
export function babyAgeMonths(birthDate: string, today: string = jakartaToday()): number {
  return Math.max(0, Math.floor(daysBetween(birthDate, today) / DAYS_PER_MONTH));
}

/** Birth date that makes the baby exactly `months` completed months old today. */
export function birthDateFromAgeMonths(months: number, today: string = jakartaToday()): string {
  return shiftDate(today, -Math.ceil(months * DAYS_PER_MONTH));
}

// --- Input -------------------------------------------------------------------

export type MaternalInput =
  | { mode: "none" }
  | {
      mode: "pregnant";
      dateKind: PregnancyDateKind;
      date: string;
      prePregnancyWeightKg: number;
      twins: boolean;
      conditions?: MaternalCondition[];
    }
  | {
      mode: "breastfeeding";
      feeding: FeedingType;
      babyAgeMonths: number;
      /** optional; the pre-pregnancy weight is the basis when known, else the current weight */
      prePregnancyWeightKg?: number | null;
      conditions?: MaternalCondition[];
    };

export type MaternalInputError = "pregnancyDateFuture" | "pregnancyDateTooOld";

/** Client input -> stored state, or the reason the date cannot be right. */
export function resolveMaternalInput(
  input: MaternalInput,
  today: string = jakartaToday(),
): { ok: true; state: MaternalState } | { ok: false; error: MaternalInputError } {
  if (input.mode === "none") return { ok: true, state: NO_MATERNAL };
  const conditions = [...new Set(input.conditions ?? [])];
  if (input.mode === "pregnant") {
    const lmp = input.dateKind === "hpl" ? lmpFromDueDate(input.date) : input.date;
    const days = daysBetween(lmp, today);
    if (days < 0) return { ok: false, error: "pregnancyDateFuture" };
    if (days > MAX_PREGNANCY_DAYS) return { ok: false, error: "pregnancyDateTooOld" };
    return {
      ok: true,
      state: {
        mode: "pregnant",
        pregnancyLmp: lmp,
        pregnancyDateKind: input.dateKind,
        prePregnancyWeightKg: input.prePregnancyWeightKg,
        twins: input.twins,
        feedingType: null,
        babyBirthDate: null,
        conditions,
      },
    };
  }
  return {
    ok: true,
    state: {
      mode: "breastfeeding",
      pregnancyLmp: null,
      pregnancyDateKind: null,
      prePregnancyWeightKg: input.prePregnancyWeightKg ?? null,
      twins: false,
      feedingType: input.feeding,
      babyBirthDate: birthDateFromAgeMonths(input.babyAgeMonths, today),
      conditions,
    },
  };
}

// --- Energy (AKG 2019, Tabel 1) ----------------------------------------------

/** Hamil (+an) energi, kkal: trimester 1, 2, 3. */
export const AKG_PREGNANCY_KCAL: Record<Trimester, number> = { 1: 180, 2: 300, 3: 300 };
/** Menyusui (+an) energi, kkal: "6 bln pertama", "6 bln kedua". */
export const AKG_LACTATION_KCAL = { first: 330, second: 400 } as const;

export type Lactation = "first" | "second";

/** AKG's two lactation periods follow the baby's completed months: 0-5 first, 6+ second. */
export function lactationPeriod(babyMonths: number): Lactation {
  return babyMonths < 6 ? "first" : "second";
}

export type MaternalStage = "t1" | "t2" | "t3" | "bf1" | "bf2";

export function maternalStage(state: MaternalState, today: string = jakartaToday()): MaternalStage | null {
  if (state.mode === "pregnant") {
    const g = state.pregnancyLmp ? gestationalAge(state.pregnancyLmp, today) : null;
    return g ? (`t${g.trimester}` as MaternalStage) : null;
  }
  if (state.mode === "breastfeeding" && state.babyBirthDate) {
    return lactationPeriod(babyAgeMonths(state.babyBirthDate, today)) === "first" ? "bf1" : "bf2";
  }
  return null;
}

/** The AKG energy addition for a stage. */
export function akgEnergyAddition(stage: MaternalStage): number {
  switch (stage) {
    case "t1":
      return AKG_PREGNANCY_KCAL[1];
    case "t2":
      return AKG_PREGNANCY_KCAL[2];
    case "t3":
      return AKG_PREGNANCY_KCAL[3];
    case "bf1":
      return AKG_LACTATION_KCAL.first;
    case "bf2":
      return AKG_LACTATION_KCAL.second;
  }
}

// --- Nutrients (AKG 2019, Tabel 1-3) -----------------------------------------

export type MaternalNutrientKey =
  | "protein"
  | "fiber"
  | "water"
  | "iron"
  | "folate"
  | "calcium"
  | "iodine"
  | "vitaminA"
  | "dha";

export type MaternalNutrient = {
  key: MaternalNutrientKey;
  /** daily target = base + add */
  target: number;
  /** AKG for her age band when not pregnant or breastfeeding (0 when the source has none) */
  base: number;
  /** the "+an" of the stage */
  add: number;
  unit: "g" | "ml" | "mg" | "mcg" | "RE";
  /**
   * true when our food data can track it (food_log carries kcal, protein, carbs,
   * fat, fiber; water has its own log). false = shown as "perhatikan" guidance.
   */
  tracked: boolean;
  source: "akg2019" | "fao2010";
};

type Band = { protein: number; fiber: number; water: number; iron: number; calcium: number; iodine: number };

/** AKG 2019 Tabel 1 and 3, Perempuan. Vitamin A (600 RE) and folat (400 mcg) are the same for every band from 10 y. */
function akgBand(age: number): Band {
  if (age <= 12) return { protein: 55, fiber: 27, water: 1850, iron: 8, calcium: 1200, iodine: 120 };
  if (age <= 15) return { protein: 65, fiber: 29, water: 2100, iron: 15, calcium: 1200, iodine: 150 };
  if (age <= 18) return { protein: 65, fiber: 29, water: 2150, iron: 15, calcium: 1200, iodine: 150 };
  if (age <= 29) return { protein: 60, fiber: 32, water: 2350, iron: 18, calcium: 1000, iodine: 150 };
  if (age <= 49) return { protein: 60, fiber: 30, water: 2350, iron: 18, calcium: 1000, iodine: 150 };
  return { protein: 60, fiber: 25, water: 2350, iron: 8, calcium: 1200, iodine: 150 };
}

const VITAMIN_A_BASE_RE = 600;
const FOLATE_BASE_MCG = 400;
/** FAO/WHO 2010: average nutrient requirement of DHA in pregnancy and lactation. */
export const DHA_MG = 200;

/** Hamil (+an): protein by trimester, serat by trimester, the rest the same all pregnancy except besi (+0, +9, +9). */
const PREGNANCY_ADD = {
  protein: { t1: 1, t2: 10, t3: 30 },
  fiber: { t1: 3, t2: 4, t3: 4 },
  iron: { t1: 0, t2: 9, t3: 9 },
  water: 300,
  folate: 200,
  calcium: 200,
  iodine: 70,
  vitaminA: 300,
} as const;

/** Menyusui (+an): "6 bln pertama" / "6 bln kedua". */
const LACTATION_ADD = {
  protein: { first: 20, second: 15 },
  fiber: { first: 5, second: 6 },
  water: { first: 800, second: 650 },
  iron: 0,
  folate: 100,
  calcium: 200,
  iodine: 140,
  vitaminA: 350,
} as const;

export function maternalNutrients(stage: MaternalStage, age: number): MaternalNutrient[] {
  const band = akgBand(age);
  const pregnant = stage === "t1" || stage === "t2" || stage === "t3";
  const t = stage as "t1" | "t2" | "t3";
  const l: Lactation = stage === "bf2" ? "second" : "first";
  const add = pregnant
    ? {
        protein: PREGNANCY_ADD.protein[t],
        fiber: PREGNANCY_ADD.fiber[t],
        water: PREGNANCY_ADD.water,
        iron: PREGNANCY_ADD.iron[t],
        folate: PREGNANCY_ADD.folate,
        calcium: PREGNANCY_ADD.calcium,
        iodine: PREGNANCY_ADD.iodine,
        vitaminA: PREGNANCY_ADD.vitaminA,
      }
    : {
        protein: LACTATION_ADD.protein[l],
        fiber: LACTATION_ADD.fiber[l],
        water: LACTATION_ADD.water[l],
        iron: LACTATION_ADD.iron,
        folate: LACTATION_ADD.folate,
        calcium: LACTATION_ADD.calcium,
        iodine: LACTATION_ADD.iodine,
        vitaminA: LACTATION_ADD.vitaminA,
      };
  const akg = (
    key: MaternalNutrientKey,
    base: number,
    plus: number,
    unit: MaternalNutrient["unit"],
    tracked: boolean,
  ): MaternalNutrient => ({
    key,
    target: Math.round((base + plus) * 10) / 10,
    base,
    add: plus,
    unit,
    tracked,
    source: "akg2019",
  });
  return [
    akg("protein", band.protein, add.protein, "g", true),
    akg("fiber", band.fiber, add.fiber, "g", true),
    akg("water", band.water, add.water, "ml", true),
    akg("iron", band.iron, add.iron, "mg", false),
    akg("folate", FOLATE_BASE_MCG, add.folate, "mcg", false),
    akg("calcium", band.calcium, add.calcium, "mg", false),
    akg("iodine", band.iodine, add.iodine, "mcg", false),
    akg("vitaminA", VITAMIN_A_BASE_RE, add.vitaminA, "RE", false),
    { key: "dha", target: DHA_MG, base: 0, add: DHA_MG, unit: "mg", tracked: false, source: "fao2010" },
  ];
}

// --- Weight gain (IOM 2009) --------------------------------------------------

export type BmiCategory = "under" | "normal" | "over" | "obese";

/** WHO cut-offs, the ones IOM 2009 uses: <18.5, 18.5-24.9, 25-29.9, >=30. */
export function bmiCategory(bmi: number): BmiCategory {
  if (bmi < 18.5) return "under";
  if (bmi < 25) return "normal";
  if (bmi < 30) return "over";
  return "obese";
}

export function bmiOf(weightKg: number, heightCm: number): number {
  const m = heightCm / 100;
  return weightKg / (m * m);
}

/** IOM 2009, total gain over the pregnancy, singleton, kg. */
export const IOM_SINGLETON_KG: Record<BmiCategory, { minKg: number; maxKg: number }> = {
  under: { minKg: 12.5, maxKg: 18 },
  normal: { minKg: 11.5, maxKg: 16 },
  over: { minKg: 7, maxKg: 11.5 },
  obese: { minKg: 5, maxKg: 9 },
};

/** IOM 2009 provisional twin ranges, kg. Underweight: IOM says "insufficient information". */
export const IOM_TWINS_KG: Record<Exclude<BmiCategory, "under">, { minKg: number; maxKg: number }> = {
  normal: { minKg: 16.8, maxKg: 24.5 },
  over: { minKg: 14.1, maxKg: 22.7 },
  obese: { minKg: 11.3, maxKg: 19.1 },
};

/** IOM 2009 recommended rate in the 2nd and 3rd trimester, singleton, kg/week. */
export const IOM_RATE_KG_WEEK: Record<BmiCategory, { minKg: number; maxKg: number }> = {
  under: { minKg: 0.44, maxKg: 0.58 },
  normal: { minKg: 0.35, maxKg: 0.5 },
  over: { minKg: 0.23, maxKg: 0.33 },
  obese: { minKg: 0.17, maxKg: 0.27 },
};

/** IOM assumes 0.5-2 kg for the whole first trimester in every BMI group. */
export const IOM_FIRST_TRIMESTER_KG = { minKg: 0.5, maxKg: 2 } as const;
const FIRST_TRIMESTER_END_WEEK = 13;
const TERM_WEEK = 40;
/** A scale reading is noisy: a gain this close to the band still counts as inside it. */
export const GAIN_TOLERANCE_KG = 0.5;

export type WeightGainPlan = {
  prePregnancyWeightKg: number;
  bmi: number;
  category: BmiCategory;
  twins: boolean;
  totalMinKg: number;
  totalMaxKg: number;
  /** twins and underweight: no IOM range exists, the normal-weight twin range stands in */
  borrowedRange: boolean;
  /** IOM mean weekly rate for weeks 14+, singleton only */
  weeklyRateKg: { minKg: number; maxKg: number } | null;
};

export function weightGainPlan(
  prePregnancyWeightKg: number,
  heightCm: number,
  twins: boolean,
): WeightGainPlan {
  const bmi = bmiOf(prePregnancyWeightKg, heightCm);
  const category = bmiCategory(bmi);
  const borrowedRange = twins && category === "under";
  const range = twins ? IOM_TWINS_KG[category === "under" ? "normal" : category] : IOM_SINGLETON_KG[category];
  return {
    prePregnancyWeightKg,
    bmi: Math.round(bmi * 10) / 10,
    category,
    twins,
    totalMinKg: range.minKg,
    totalMaxKg: range.maxKg,
    borrowedRange,
    weeklyRateKg: twins ? null : IOM_RATE_KG_WEEK[category],
  };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Recommended cumulative gain at a gestational week. IOM gives two anchors per
 * BMI group: 0.5-2 kg by the end of the first trimester and the total at term.
 * Between them the band is a straight line (our interpolation), so it lands
 * exactly on the cited total at week 40.
 */
export function gainBand(
  week: number,
  plan: Pick<WeightGainPlan, "totalMinKg" | "totalMaxKg">,
): { minKg: number; maxKg: number } {
  const w = Math.min(Math.max(week, 0), TERM_WEEK);
  if (w <= FIRST_TRIMESTER_END_WEEK) {
    const share = w / FIRST_TRIMESTER_END_WEEK;
    return {
      minKg: round1(IOM_FIRST_TRIMESTER_KG.minKg * share),
      maxKg: round1(IOM_FIRST_TRIMESTER_KG.maxKg * share),
    };
  }
  const share = (w - FIRST_TRIMESTER_END_WEEK) / (TERM_WEEK - FIRST_TRIMESTER_END_WEEK);
  return {
    minKg: round1(IOM_FIRST_TRIMESTER_KG.minKg + share * (plan.totalMinKg - IOM_FIRST_TRIMESTER_KG.minKg)),
    maxKg: round1(IOM_FIRST_TRIMESTER_KG.maxKg + share * (plan.totalMaxKg - IOM_FIRST_TRIMESTER_KG.maxKg)),
  };
}

export type GainStatus = "below" | "within" | "above";

export function gainStatus(gainKg: number, band: { minKg: number; maxKg: number }): GainStatus {
  if (gainKg < band.minKg - GAIN_TOLERANCE_KG) return "below";
  if (gainKg > band.maxKg + GAIN_TOLERANCE_KG) return "above";
  return "within";
}

export type WeightGainChart = {
  plan: WeightGainPlan;
  /** every whole week 0..40 */
  band: { week: number; minKg: number; maxKg: number }[];
  /** one point per weigh-in on/after HPHT; week is fractional (days / 7) */
  points: { date: string; week: number; weightKg: number; gainKg: number }[];
  /** the latest weigh-in against the band of its week; null before the first one */
  current: {
    date: string;
    week: number;
    weightKg: number;
    gainKg: number;
    bandMinKg: number;
    bandMaxKg: number;
    status: GainStatus;
  } | null;
};

/** The weekly gain chart: IOM band by week and the user's gain since the pre-pregnancy weight. */
export function weightGainChart(input: {
  lmp: string;
  prePregnancyWeightKg: number;
  heightCm: number;
  twins: boolean;
  weighIns: { date: string; weightKg: number }[];
  today?: string;
}): WeightGainChart {
  const today = input.today ?? jakartaToday();
  const plan = weightGainPlan(input.prePregnancyWeightKg, input.heightCm, input.twins);
  const band = Array.from({ length: TERM_WEEK + 1 }, (_, week) => ({ week, ...gainBand(week, plan) }));
  const points = input.weighIns
    .filter((w) => w.date >= input.lmp && w.date <= today)
    .toSorted((a, b) => (a.date < b.date ? -1 : 1))
    .map((w) => ({
      date: w.date,
      week: round1(daysBetween(input.lmp, w.date) / 7),
      weightKg: w.weightKg,
      gainKg: round1(w.weightKg - input.prePregnancyWeightKg),
    }));
  const last = points.at(-1);
  const lastBand = last ? gainBand(last.week, plan) : null;
  return {
    plan,
    band,
    points,
    current:
      last && lastBand
        ? {
            date: last.date,
            week: last.week,
            weightKg: last.weightKg,
            gainKg: last.gainKg,
            bandMinKg: lastBand.minKg,
            bandMaxKg: lastBand.maxKg,
            status: gainStatus(last.gainKg, lastBand),
          }
        : null,
  };
}

// --- The targets -------------------------------------------------------------

/**
 * Things the clients explain next to the numbers. Flags never block anything.
 *  TWINS_ENERGY      twins: AKG has no twin figure; the singleton addition is used, ask the doctor/dietitian
 *  PARTIAL_ESTIMATE  partial breastfeeding: AKG has no figure; the full AKG addition is used as an estimate
 *  OVERDUE           HPHT is more than 42 weeks back: review the date or end the mode
 *  BABY_OVER_12      AKG stops at 12 months; the second-period figures keep applying
 *  TWINS_UNDERWEIGHT no IOM twin range for an underweight start; the normal range is shown
 *  CONSULT           a known condition was selected: check the plan with the doctor/bidan
 */
export type MaternalFlag =
  | "TWINS_ENERGY"
  | "PARTIAL_ESTIMATE"
  | "OVERDUE"
  | "BABY_OVER_12"
  | "TWINS_UNDERWEIGHT"
  | "CONSULT";

export type MaternalInfo = {
  mode: "pregnant" | "breastfeeding";
  stage: MaternalStage;
  twins: boolean;
  feedingType: FeedingType | null;
  /** pregnancy only */
  gestation: Gestation | null;
  /** breastfeeding only */
  babyMonths: number | null;
  /** maintenance TDEE on the pre-pregnancy basis (the number before the addition) */
  baseKcal: number;
  /** the AKG addition of the stage; added to baseKcal to make the target */
  addKcal: number;
  nutrients: MaternalNutrient[];
  weightGain: WeightGainPlan | null;
  conditions: MaternalCondition[];
  flags: MaternalFlag[];
};

/**
 * The daily numbers for a pregnant or breastfeeding user: maintenance TDEE of
 * the pre-pregnancy basis (the weight she had before, else today's) plus the
 * AKG 2019 addition. No deficit, no burn target, no measured-TDEE drift: weight
 * is expected to move, so it must not feed back into the plan.
 */
export function computeMaternalTargets(
  profile: ProfileInput,
  state: MaternalState,
  options: { today?: string; weightNow?: number; tdeeKcal?: number } = {},
): Targets {
  if (state.mode === "none") throw new Error("computeMaternalTargets needs a maternal mode");
  const today = options.today ?? jakartaToday();
  const weightNow = options.weightNow ?? profile.weightKg;
  const age = ageFromBirthYear(profile.birthYear, today);
  const basisKg = state.prePregnancyWeightKg ?? weightNow;

  const bmr = bmrMifflin(basisKg, profile.heightCm, age, "female");
  // Rounded to 5 like every plan number, so base + addition is exactly the target. The maternal target keeps its own
  // multipliers (MATERNAL_ACTIVITY_FACTOR: 1.25 / 1.35 / 1.45 for the levels migrated from low / mid / high), not the
  // standard factors of the normal plan, so it does not move with the new levels.
  const factor = MATERNAL_ACTIVITY_FACTOR[profile.activityLevel];
  const baseKcal = round5(options.tdeeKcal ?? bmr * factor);

  const flags: MaternalFlag[] = [];
  const gestation =
    state.mode === "pregnant" && state.pregnancyLmp ? gestationalAge(state.pregnancyLmp, today) : null;
  const babyMonths =
    state.mode === "breastfeeding" && state.babyBirthDate ? babyAgeMonths(state.babyBirthDate, today) : null;
  const stage: MaternalStage =
    state.mode === "pregnant"
      ? (`t${gestation?.trimester ?? 1}` as MaternalStage)
      : lactationPeriod(babyMonths ?? 0) === "first"
        ? "bf1"
        : "bf2";

  const add = akgEnergyAddition(stage);
  // AKG has no figure for partial breastfeeding: the full addition stands in (under-feeding a
  // nursing mother is the worse error) and the note says it is an estimate.
  if (state.mode === "breastfeeding" && state.feedingType === "partial") flags.push("PARTIAL_ESTIMATE");
  if (state.twins && state.mode === "pregnant") flags.push("TWINS_ENERGY");
  if (gestation?.overdue) flags.push("OVERDUE");
  if (babyMonths !== null && babyMonths >= 12) flags.push("BABY_OVER_12");

  const weightGain =
    state.mode === "pregnant" && state.prePregnancyWeightKg !== null
      ? weightGainPlan(state.prePregnancyWeightKg, profile.heightCm, state.twins)
      : null;
  if (weightGain?.borrowedRange) flags.push("TWINS_UNDERWEIGHT");
  if (state.conditions.length > 0) flags.push("CONSULT");

  const ideal = idealWeightRange(profile.heightCm);
  return {
    bmr: Math.round(bmr),
    level: profile.activityLevel,
    factor,
    tdee: baseKcal,
    formulaTdee: baseKcal, // COMPAT, old clients read it (see Targets)
    assumedKcal: 0, // COMPAT, old clients read it (see Targets)
    includedKcal: Math.round(movementInFactorKcal(options.tdeeKcal ?? bmr * factor, bmr)),
    eatKcal: baseKcal + add,
    exerciseKcal: 0,
    burnKcal: 0,
    sleepHours: profile.sleepTargetHours ?? DEFAULT_SLEEP_TARGET_HOURS,
    deficitKcal: 0,
    rawDeficitKcal: 0,
    idealMinKg: ideal.minKg,
    idealMaxKg: ideal.maxKg,
    notes: ["MATERNAL"],
    gain: null,
    datePace: null,
    maternal: {
      mode: state.mode,
      stage,
      twins: state.twins,
      feedingType: state.feedingType,
      gestation,
      babyMonths,
      baseKcal,
      addKcal: add,
      nutrients: maternalNutrients(stage, age),
      weightGain,
      conditions: state.conditions,
      flags,
    },
  };
}

/** One nutrient of the targets; undefined outside the maternal modes. */
export function maternalNutrient(
  targets: Pick<Targets, "maternal">,
  key: MaternalNutrientKey,
): MaternalNutrient | undefined {
  return targets.maternal?.nutrients.find((n) => n.key === key);
}

// --- Food safety flags -------------------------------------------------------

export type FoodFlagKey =
  | "alcohol"
  | "caffeine"
  | "rawMeat"
  | "rawEgg"
  | "rawFish"
  | "mercuryFish"
  | "unpasteurized"
  | "herbal";

export type FoodFlag = {
  key: FoodFlagKey;
  /** caffeine only: rough mg for one serving, an estimate from typical cups */
  caffeineMg?: number;
};

type FlagRule = { key: FoodFlagKey; match: RegExp; unless?: RegExp; pregnantOnly?: boolean };

// Matched on the lower-cased dish name in Indonesian and English. Gentle by
// design: a flag is a note to check, never a verdict on the dish.
const FLAG_RULES: FlagRule[] = [
  { key: "alcohol", match: ALCOHOL_MATCH, unless: ALCOHOL_UNLESS },
  { key: "rawMeat", match: /\b(carpaccio|tartare|steak tartare|daging mentah|ayam mentah|rare|medium rare|blue rare|steak setengah matang|steak 1\/2 matang)\b/, pregnantOnly: true },
  {
    key: "rawEgg",
    match:
      /\b(telur (setengah|1\/2|½) matang|telur mentah|telur mata sapi|telur ceplok setengah|kuning telur mentah|soft[- ]boiled|runny egg|sunny[- ]side|poached egg|raw egg|egg nog|tiramisu)\b/,
    pregnantOnly: true,
  },
  {
    key: "rawFish",
    match:
      /\b(sushi|sashimi|poke|ceviche|ikan mentah|kerang mentah|tiram mentah|oysters? mentah|raw oysters?|salmon asap|smoked salmon|lox|udang mentah|raw fish|gohu ikan|lawar)\b/,
    pregnantOnly: true,
  },
  {
    key: "mercuryFish",
    match:
      /\b(hiu|cucut|shark|ikan pedang|todak|swordfish|marlin|king mackerel|tilefish|orange roughy|bigeye|tuna mata besar|tuna steak|tuna segar|fresh tuna)\b|\btuna\b/,
    unless: /\b(kaleng|canned|light tuna|skipjack)\b/,
    pregnantOnly: true,
  },
  {
    key: "unpasteurized",
    match:
      /\b(susu mentah|susu segar murni|raw milk|unpasteuri[sz]ed|keju (brie|camembert|biru|blue|gorgonzola|roquefort|feta|lunak|mentah)|(brie|camembert|gorgonzola|roquefort|queso fresco)( cheese)?|blue cheese)\b/,
    unless: /\b(pasteuri[sz]ed|pasteurisasi)\b/,
    pregnantOnly: true,
  },
  {
    key: "herbal",
    match:
      /\b(jamu|kunyit asam|beras kencur|temulawak|brotowali|pahitan|galian putri|galian singset|cabe puyang|lempuyang|wedang uwuh|herbal|ramuan|herbs?|herbal tea|teh herbal)\b/,
  },
];

/**
 * Notes for one dish name. Alcohol, caffeine and herbal apply to both modes;
 * the raw/undercooked, mercury and unpasteurized ones only to pregnancy.
 */
export function foodFlagsFor(name: string, mode: MaternalMode): FoodFlag[] {
  if (mode === "none") return [];
  const n = name.toLowerCase();
  const flags: FoodFlag[] = [];
  for (const rule of FLAG_RULES) {
    if (rule.pregnantOnly && mode !== "pregnant") continue;
    if (rule.match.test(n) && !(rule.unless && rule.unless.test(n))) flags.push({ key: rule.key });
  }
  const mg = caffeineMgFor(n);
  if (mg !== null) flags.push({ key: "caffeine", caffeineMg: mg });
  return flags;
}

export type CaffeineDay = {
  /** estimated mg from the day's logged items, one serving each */
  mg: number;
  limitMg: number;
  over: boolean;
};

/** Sum of the estimated caffeine of the day's logged item names. */
export function caffeineOfDay(names: string[]): CaffeineDay {
  const mg = names.reduce((sum, name) => sum + (caffeineMgFor(name) ?? 0), 0);
  return { mg, limitMg: CAFFEINE_LIMIT_MG, over: mg > CAFFEINE_LIMIT_MG };
}

// --- Prompt context ----------------------------------------------------------

/**
 * One line for the AI scan prompt (Indonesian: the prompts stay Indonesian).
 * It keeps the model from coaching toward a deficit and asks it to write the
 * doneness into the dish name, which the flags above read.
 */
export function maternalPromptNote(
  info: Pick<MaternalInfo, "mode" | "stage"> | null | undefined,
): string | null {
  if (!info) return null;
  const who =
    info.mode === "pregnant"
      ? `sedang hamil (trimester ${info.stage.slice(1)})`
      : "sedang menyusui";
  return `Konteks pengguna: ${who}. Jangan pernah menyarankan mengurangi kalori atau menurunkan berat badan. Tetap sebut semua makanan dan minuman apa adanya, termasuk alkohol, kopi, dan ramuan jamu; jika telur, daging, atau ikan tampak mentah atau setengah matang, tulis kematangannya pada name (mis. "telur setengah matang", "steak rare", "sushi salmon mentah").`;
}

/** maternalPromptNote for a stored state on a given day; null outside Hamil / Menyusui. */
export function maternalNoteFor(state: MaternalState, today: string = jakartaToday()): string | null {
  const stage = maternalStage(state, today);
  return state.mode !== "none" && stage ? maternalPromptNote({ mode: state.mode, stage }) : null;
}
