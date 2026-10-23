// Weeks for the weekly reflection tests and the model comparison script (docs/weekly-recap-ai.md): a quiet baseline week
// and the owner's week that inspired the feature. Plain data, no database.

import { shiftDate } from "./engine";
import type { TrendPoint } from "./engine";
import { buildWeekRecap } from "./recap";
import { streakState } from "./streak";
import type { ReflectionInput, WorkoutInput } from "./recap-facts";
import type { SleepFinding } from "./sleep-insights-types";

/** A Monday; `TODAY` is the Monday after, so the week is complete. */
export const WEEK = "2026-10-12";
export const TODAY = "2026-10-19";

export const day = (i: number): string => shiftDate(WEEK, i);

export interface WeekSpec {
  /** Kcal eaten per day, Monday first; 0 = nothing logged, null = day not judged yet (use a running `today`). */
  eaten: readonly number[];
  target?: number;
  protein?: readonly (number | null)[];
  proteinTarget?: number;
  today?: string;
  streakDays?: number;
  gain?: boolean;
}

/** A recap built the way the router builds it, from per-day totals. */
export function recapOf(spec: WeekSpec) {
  const today = spec.today ?? TODAY;
  const loggedDates = spec.eaten.flatMap((kcal, i) => (kcal > 0 ? [day(i)] : []));
  return buildWeekRecap({
    weekStart: WEEK,
    today,
    targetKcal: spec.target ?? 1500,
    proteinTargetG: spec.proteinTarget ?? 110,
    food: spec.eaten.flatMap((kcal, i) =>
      kcal > 0 ? [{ date: day(i), kcal, protein: spec.protein?.[i] ?? null }] : [],
    ),
    exercise: [],
    trendPoints: [],
    streakDays:
      spec.streakDays ??
      streakState(loggedDates, today < shiftDate(WEEK, 6) ? today : shiftDate(WEEK, 6)).days,
    gain: spec.gain ? true : undefined,
  });
}

/** A neutral week: on target, protein fine, nothing flagged. Override what a test is about. */
export function quietWeek(
  over: Partial<ReflectionInput> = {},
  spec: Partial<WeekSpec> = {},
): ReflectionInput {
  return {
    recap: recapOf({
      eaten: [1500, 1480, 1520, 1500, 1510, 1490, 1500],
      protein: [105, 110, 108, 112, 109, 111, 107],
      streakDays: 2,
      ...spec,
    }),
    mode: "lose",
    today: TODAY,
    person: {
      gender: "male",
      heightCm: 175,
      ageYears: 38,
      weightKg: 80,
      targetKg: 75,
      targetDate: "2027-03-01",
    },
    food: [],
    weighIns: [],
    weightBefore: null,
    trend: null,
    waist: [],
    exercise: { sessions: 0, minutes: 0, activeDays: 0 },
    workouts: [],
    loadRatios: [],
    sleep: [],
    needSleepHours: 8,
    steps: [],
    ...over,
  };
}

/** The outcome and the unfavourable direction of each factor, the way `sleepFindingsFor` words them. */
const FINDING_SHAPE = {
  caffeine: { outcome: "asleep", diff: -34 },
  regularity: { outcome: "asleep", diff: -41 },
  temperature: { outcome: "awake", diff: 15 },
  humidity: { outcome: "awake", diff: 9 },
  dinner: { outcome: "awake", diff: 18 },
  workout: { outcome: "awake", diff: 12 },
} as const;

/** A gate-passed personal sleep finding (the unfavourable direction unless `over` says otherwise). */
export function sleepFinding(
  factor: keyof typeof FINDING_SHAPE,
  over: Partial<SleepFinding> = {},
): SleepFinding {
  return {
    factor,
    confidence: "maybe",
    exposed: 5,
    other: 9,
    threshold: factor === "temperature" ? 28 : factor === "humidity" ? 70 : null,
    nights: [],
    through: WEEK,
    ...FINDING_SHAPE[factor],
    ...over,
  };
}

/** A neutral week of a Pro account with the sleep switch on and one finding: what the reflection gets with the consent on. */
export function consentOnWeek(
  findings: readonly SleepFinding[] = [
    sleepFinding("caffeine", { confidence: "leaning", exposed: 6 }),
  ],
  over: Partial<ReflectionInput> = {},
): ReflectionInput {
  return quietWeek({ sleepFindings: findings, ...over });
}

const item = (i: number, meal: string, name: string, kcal: number) => ({
  date: day(i),
  meal,
  name,
  kcal,
});

/** The owner's week: 107.7 kg, target 1500, avg 1950, protein 58 of 110, a 1 km run at HR 163 with 8 min in zones 4-5, load 4x, short sleep, 5 weigh-ins. */
export function ownerWeek(): ReflectionInput {
  const eaten = [1500, 2600, 1700, 2200, 1400, 2500, 1750];
  const trendKg = [108.56, 108.52, 108.45, 108.38, 108.31];
  const weighDays = [0, 1, 3, 4, 6];
  const trendPoints: TrendPoint[] = [
    { date: shiftDate(WEEK, -3), weightKg: 108.6, trendKg: 108.6 },
    ...weighDays.map((d, i) => ({
      date: day(d),
      weightKg: [108.4, 108.2, 108.0, 107.8, 107.7][i]!,
      trendKg: trendKg[i]!,
    })),
  ];
  const recap = buildWeekRecap({
    weekStart: WEEK,
    today: TODAY,
    targetKcal: 1500,
    proteinTargetG: 110,
    food: eaten.map((kcal, i) => ({
      date: day(i),
      kcal,
      protein: [50, 70, 45, 60, 55, 62, 64][i]!,
    })),
    exercise: [{ date: day(2), kcal: 90, minutes: 8, sessions: 1 }],
    trendPoints,
    streakDays: 9,
  });
  const run: WorkoutInput = {
    start: Math.floor(Date.parse(`${day(2)}T06:00:00+07:00`) / 1000),
    date: day(2),
    kind: "run",
    durationMin: 8.4,
    distanceKm: 1,
    avgHr: 163,
    maxHr: 177,
    zones: { maxHr: 188, sec: [30, 60, 120, 180, 300], belowSec: 10 },
  };
  return {
    recap,
    mode: "lose",
    today: TODAY,
    person: {
      gender: "male",
      heightCm: 175,
      ageYears: 38,
      weightKg: 107.7,
      targetKg: 90,
      targetDate: "2027-01-01",
    },
    food: [
      item(0, "makan_siang", "Ayam goreng", 400),
      item(0, "makan_siang", "Nasi putih", 250),
      item(0, "makan_malam", "Mie goreng", 450),
      item(1, "sarapan", "Nasi goreng", 500),
      item(1, "makan_siang", "Ayam goreng", 400),
      item(1, "makan_siang", "Nasi putih", 250),
      item(1, "makan_siang", "Es teh manis", 120),
      item(1, "makan_malam", "Mie goreng", 450),
      item(1, "makan_malam", "Nasi putih", 250),
      item(2, "makan_siang", "Gorengan", 300),
      item(2, "makan_siang", "Es teh manis", 120),
      item(3, "makan_siang", "Kentang goreng", 350),
      item(3, "makan_siang", "Nasi putih", 250),
      item(3, "snack", "Donat", 250),
      item(3, "makan_malam", "Es teh manis", 120),
      item(4, "makan_siang", "Ayam goreng", 400),
      item(5, "snack", "Es teh manis", 120),
      item(5, "makan_malam", "Gorengan", 300),
      item(6, "makan_siang", "Es teh manis", 120),
    ],
    weighIns: weighDays.map((d, i) => ({
      date: day(d),
      weightKg: [108.4, 108.2, 108.0, 107.8, 107.7][i]!,
    })),
    weightBefore: { date: shiftDate(WEEK, -3), weightKg: 108.6 },
    trend: { weeklyRateKg: -0.3, projectedDate: "2027-12-20" },
    waist: [
      { date: shiftDate(WEEK, -2), waistCm: 112 },
      { date: day(3), waistCm: 102 },
    ],
    exercise: { sessions: 1, minutes: 8, activeDays: 1 },
    workouts: [run],
    loadRatios: [1.1, 4],
    sleep: [5, 6.4, 5.5, 6, 6.2, 5.8, 6.1].map((hours, i) => ({ date: day(i), hours })),
    needSleepHours: 8,
    steps: [3200, 4100, 2800, 5200, 3900, 4400, 3500].map((steps, i) => ({ date: day(i), steps })),
  };
}

// ---- every variant ----

const zonedRun = (
  z45Sec: number,
  totalSec: number,
  over: Partial<WorkoutInput> = {},
): WorkoutInput => {
  const rest = totalSec - z45Sec;
  return {
    start: 1,
    date: day(2),
    kind: "run",
    durationMin: totalSec / 60,
    distanceKm: 5,
    avgHr: 150,
    maxHr: 170,
    zones: { maxHr: 190, sec: [rest / 3, rest / 3, rest / 3, z45Sec / 2, z45Sec / 2], belowSec: 0 },
    ...over,
  };
};

const fixed = (kcal: number, over: Partial<ReflectionInput> = {}): Partial<ReflectionInput> => ({
  recap: recapOf({ eaten: Array(7).fill(kcal), protein: Array(7).fill(100), streakDays: 2 }),
  ...over,
});

/** One scenario per variant of every fact code, so a test can show each of them is reachable, worded and translated. */
export function variantScenarios(): Record<string, ReflectionInput> {
  const trend = (rate: number | null, over: Partial<ReflectionInput> = {}) =>
    quietWeek({ trend: { weeklyRateKg: rate, projectedDate: "2027-02-01" }, ...over });
  const weigh = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ date: day(i), weightKg: 80 }));
  const food = (names: string[]) =>
    names.map((name, i) => ({ date: day(i % 5), meal: `m${i}`, name, kcal: 300 }));
  const growing = {
    person: {
      gender: "male",
      heightCm: 175,
      ageYears: 25,
      weightKg: 60,
      targetKg: 70,
      targetDate: "2027-06-01",
    },
  };
  const heavy = {
    person: {
      gender: "male",
      heightCm: 170,
      ageYears: 40,
      weightKg: 100,
      targetKg: null,
      targetDate: null,
    },
  };
  const kg = (changeKg: number) => ({
    weight: { startKg: 80, endKg: 80 + changeKg, changeKg, weighIns: 3 },
  });
  return {
    "LOG_STREAK/streak": quietWeek({}, { streakDays: 3 }),
    "LOG_STREAK/streak_gain": quietWeek({ mode: "gain" }, { streakDays: 4 }),
    "LOG_STREAK/logged": quietWeek({}, { streakDays: 2 }),
    "LOG_STREAK/some": quietWeek({}, { eaten: [1500, 1500, 0, 0, 0, 0, 0], streakDays: 0 }),
    "LOG_GAPS/gaps": quietWeek({}, { eaten: [1500, 1500, 1500, 0, 0, 0, 0] }),
    "WEIGHT_PACE/on_pace": trend(-0.5),
    "WEIGHT_PACE/week_down": trend(null, { recap: { ...quietWeek().recap, ...kg(-0.4) } }),
    "WEIGHT_PACE/behind": trend(-0.15),
    "WEIGHT_PACE/gaining": trend(0.3),
    "WEIGHT_PACE/flat": trend(0),
    "WEIGHT_PACE/too_fast": trend(-1.5),
    "WEIGHT_PACE/steady": trend(0.1, { mode: "maintain" }),
    "WEIGHT_PACE/drifting": trend(0.5, { mode: "maintain" }),
    "WEIGHT_PACE/gain_on_pace": trend(0.4, { mode: "gain", ...growing }),
    "WEIGHT_PACE/gain_stalled": trend(0, { mode: "gain", ...growing }),
    "WEIGH_INS/regular": quietWeek({ weighIns: weigh(5) }),
    "WEIGH_INS/few": quietWeek({ weighIns: weigh(1) }),
    "WEIGH_INS/none": quietWeek({ weighIns: [] }),
    "MEASURE_ANOMALY/waist": quietWeek({
      waist: [
        { date: day(0), waistCm: 100 },
        { date: day(4), waistCm: 90 },
      ],
    }),
    "MEASURE_ANOMALY/weight": quietWeek({
      weightBefore: { date: day(0), weightKg: 80 },
      weighIns: [{ date: day(1), weightKg: 84 }],
    }),
    "INTAKE_AVG_VS_TARGET/on_target": quietWeek(fixed(1500)),
    "INTAKE_AVG_VS_TARGET/over": quietWeek(fixed(1950)),
    "INTAKE_AVG_VS_TARGET/under": quietWeek(fixed(900)),
    "INTAKE_AVG_VS_TARGET/under_gain": quietWeek(fixed(1000, { mode: "gain" })),
    "INTAKE_AVG_VS_TARGET/under_maternal": quietWeek(fixed(1000, { mode: "maternal" })),
    "INTAKE_SWING/steady": quietWeek({}),
    "INTAKE_SWING/swing": quietWeek({
      recap: recapOf({ eaten: [1200, 2600, 1500, 1500, 1500, 1500, 1500] }),
    }),
    "PROTEIN_OK/ok": quietWeek({}),
    "PROTEIN_LOW/low": quietWeek({
      recap: recapOf({ eaten: Array(7).fill(1500), protein: Array(7).fill(50) }),
    }),
    "FOOD_PATTERN/fried": quietWeek({
      food: food(["Ayam goreng", "Tahu goreng", "Gorengan", "Pisang goreng"]),
    }),
    "FOOD_PATTERN/double_carb": quietWeek({
      food: ["a", "b", "c"].flatMap((m, i) => [
        { date: day(i), meal: m, name: "Nasi putih", kcal: 200 },
        { date: day(i), meal: m, name: "Mie ayam", kcal: 300 },
      ]),
    }),
    "FOOD_PATTERN/sweet": quietWeek({ food: food(["Es teh manis", "Boba", "Donat", "Es krim"]) }),
    "ACTIVE_WEEK/active": quietWeek({ exercise: { sessions: 3, minutes: 120, activeDays: 3 } }),
    "ACTIVE_WEEK/maternal": quietWeek({
      mode: "maternal",
      exercise: { sessions: 3, minutes: 90, activeDays: 3 },
    }),
    "RUN_EASY/easy": quietWeek({ workouts: [zonedRun(120, 1500)] }),
    "RUN_INTENSITY/hard_run": quietWeek({ workouts: [zonedRun(300, 600)] }),
    "RUN_INTENSITY/hard_other": quietWeek({ workouts: [zonedRun(300, 600, { kind: "ride" })] }),
    "RUN_INTENSITY/hard_check_doctor": quietWeek({
      workouts: [zonedRun(300, 600, { avgHr: 165 })],
      ...heavy,
    }),
    "RUN_INTENSITY/hard_maternal": quietWeek({ mode: "maternal", workouts: [zonedRun(300, 600)] }),
    "LOAD_SPIKE/spike": quietWeek({ loadRatios: [3] }),
    "SLEEP_OK/ok": quietWeek({
      sleep: [7.5, 8, 7, 7.5].map((hours, i) => ({ date: day(i), hours })),
    }),
    "SLEEP_SHORT/short": quietWeek({
      sleep: [5, 6, 5.5, 6].map((hours, i) => ({ date: day(i), hours })),
    }),
    "SLEEP_FACTOR/caffeine": consentOnWeek([sleepFinding("caffeine")]),
    "SLEEP_FACTOR/regularity": consentOnWeek([
      sleepFinding("regularity", { confidence: "leaning" }),
    ]),
    "SLEEP_FACTOR/temperature": consentOnWeek([sleepFinding("temperature")]),
    "SLEEP_FACTOR/humidity": consentOnWeek([sleepFinding("humidity", { confidence: "leaning" })]),
    "SLEEP_FACTOR/dinner": consentOnWeek([sleepFinding("dinner")]),
    "SLEEP_FACTOR/workout": consentOnWeek([sleepFinding("workout", { confidence: "leaning" })]),
    "STEPS_GOOD/good": quietWeek({
      steps: [9000, 9500, 8800].map((steps, i) => ({ date: day(i), steps })),
    }),
    "LOW_STEPS/low": quietWeek({
      steps: [3000, 3500, 4000].map((steps, i) => ({ date: day(i), steps })),
    }),
  };
}
