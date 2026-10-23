import type { ImageRef, StickerData, StickerOptions } from "../core/resolve";
import { dayFoodData, type DayFoodStory } from "./dayfood";

/**
 * The app-facing contract: screens hand a `StorySpec` to the share sheet, and
 * `buildStickerData` flattens it into the binding namespaces templates read
 * (`day.*`, `meal.*`, `streak.*`, `weight.*`, `week.*`, `period.*`, `challenge.*`, `workout.*`,
 * `milestone.*`). Nothing here knows about layout.
 */

export type MealStory = {
  kind: "meal";
  name: string;
  kcal: number;
  protein?: number | null;
  carbs?: number | null;
  fat?: number | null;
  /** One-line reaction under the kcal, e.g. the scan page's "Aman, bro". */
  reaction?: string;
  photoUri?: string | null;
  /** True when `photoUri` is a sticker cutout with a transparent background. */
  photoCutout?: boolean;
  /**
   * The whole-plate sticker (transparent PNG of the plate or bowl with all its food). It fills the `cutout` slot
   * of the cutout templates while `photoUri` stays the photo behind the photo templates, so a meal with both
   * offers both. Wins over a `photoCutout` photoUri.
   */
  cutoutUri?: string | null;
  date?: Date;
};

export type WorkoutPr = { exercise: string; label: string; value: string };

export type WorkoutStory = {
  kind: "workout";
  name: string;
  durationMin?: number | null;
  volumeKg?: number | null;
  setsDone?: number | null;
  prs?: WorkoutPr[];
  date?: Date;
};

export type ProgressStory = {
  kind: "progress";
  eatenKcal: number;
  targetKcal: number;
  proteinG?: number | null;
  proteinTargetG?: number | null;
  carbsG?: number | null;
  fatG?: number | null;
  streakDays?: number | null;
  /** Days with at least one log since the user joined. */
  trackedDays?: number | null;
  weightLostKg?: number | null;
  /** Naikin BB: weight gained since the start; never worded as "turun". */
  weightGainedKg?: number | null;
  /** A Naikin BB plan: gained wording, and the ring is never red. */
  gain?: boolean;
  /** Pregnancy mode: no calorie target, remaining or weight framing, only what was eaten and the streak. */
  maternal?: boolean;
  /** Newest-last weigh-ins for the sparkline; drawn from 2 points up. */
  weekTrend?: Array<{ date: string; weightKg: number }>;
  /** 0..1 progress from the start weight to the goal weight, when a goal exists. */
  weightGoalProgress?: number | null;
  /** Exact weights; only ever reach the sticker when the user turned "hide numbers" off. */
  weight?: { startKg: number; nowKg: number; goalKg?: number | null } | null;
  date?: Date;
};

export type RecapStory = {
  kind: "recap";
  /** Range label, e.g. "12-18 Okt". */
  name: string;
  weekStart?: string;
  weekEnd?: string;
  avgKcal: number;
  targetKcal: number;
  daysOnTarget: number;
  loggedDays: number;
  proteinAvgG: number | null;
  proteinTargetG: number | null;
  streakDays: number;
  exerciseKcal: number;
  exerciseMin: number;
  weightChangeKg: number | null;
  bestDay: { label: string; kcal: number } | null;
  gain: boolean;
  /** Monday-first eaten kcal per day (0 = not logged). */
  days?: Array<{ date: string; kcal: number }>;
  date?: Date;
};

export type ChallengeStory = {
  kind: "challenge";
  title: string;
  goal?: string;
  target?: number | null;
  durationDays: number;
  status: "upcoming" | "active" | "ended" | string;
  hitDays: number;
  judgedDays: number;
  streak: number;
  bestStreak: number;
  rank: number | null;
  participants: number;
  date?: Date;
};

/**
 * "Progres": how a chosen period went. Numbers come from the API's period progress (packages/api lib/period-progress);
 * this type is plain data so the engine never depends on the API.
 */
export type PeriodStory = {
  kind: "period";
  /** The period, inclusive WIB days (`YYYY-MM-DD`). */
  from: string;
  to: string;
  /** Finished days in the period that count for "X of Y days logged". */
  judgedDays: number;
  loggedDays: number;
  streakDays?: number | null;
  /** Naikin BB: the energy balance reads as a surplus and no fat is implied. */
  gain?: boolean;
  /** Smoothed-trend change; null without enough weigh-ins. Absolute kg only reach the card when "hide numbers" is off. */
  weight?: {
    startKg: number;
    endKg: number;
    changeKg: number;
    changePct: number;
    direction: "down" | "up" | "steady";
    weeklyRateKg?: number | null;
    /** Trend line, oldest first. */
    series: Array<{ date: string; kg: number }>;
  } | null;
  /** Estimated energy balance over the logged, complete days; null when no day could be counted. */
  energy?: {
    /** Burn minus eaten: positive = deficit. */
    balanceKcal: number;
    countedDays: number;
    /** Kg of fat the deficit implies, only when it agrees with the trend (the API decides). */
    impliedFatKg?: number | null;
  } | null;
  /** Calories eaten per bar (a day, or a week on long periods); null = nothing logged. */
  intake?: {
    bars: Array<{ from: string; to: string; avgKcal: number | null }>;
    weekly: boolean;
    targetKcal?: number | null;
  } | null;
  /** Hide the deficit block (its own switch; the absolute weight follows "hide numbers"). */
  hideDeficit?: boolean;
  date?: Date;
};

export type StorySpec = MealStory | WorkoutStory | ProgressStory | RecapStory | PeriodStory | ChallengeStory | DayFoodStory;

export type StickerPrefs = {
  /** First name, only when the user opted in; otherwise omit. */
  userName?: string | null;
  /** The user's own photo (already downscaled) or a meal photo. */
  photo?: ImageRef | null;
  /** Transparent PNG cutout of the food, when the host has one (otherwise the meal's `photoCutout` uri is used). */
  cutout?: ImageRef | null;
  options?: StickerData["options"];
};

const STREAK_MILESTONES = [3, 7, 14, 21, 30, 50, 60, 75, 90, 100, 150, 200, 365, 500, 1000];

/** The largest milestone `days` has reached, or null under 3 days. */
export function streakMilestone(days: number): number | null {
  let hit: number | null = null;
  for (const m of STREAK_MILESTONES) if (days >= m) hit = m;
  return hit;
}

function nextStreakMilestone(days: number): number | null {
  return STREAK_MILESTONES.find((m) => m > days) ?? null;
}

function localDayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${String(date.getDate()).padStart(2, "0")}`;
}

/** 0..1 share of the way from the start weight to the goal weight; null without a gap to cover. */
export function weightGoalProgress(startKg: number, nowKg: number, goalKg: number): number | null {
  const span = goalKg - startKg;
  if (Math.abs(span) < 0.5) return null;
  return Math.min(1, Math.max(0, (nowKg - startKg) / span));
}

const round1 = (n: number) => Math.round(n * 10) / 10;

function dayData(spec: ProgressStory): Record<string, unknown> {
  const target = spec.maternal ? 0 : spec.targetKcal;
  const eaten = spec.eatenKcal;
  const gain = spec.gain === true;
  const over = !gain && target > 0 && eaten > target * 1.05;
  const macroFraction = (grams: number | null | undefined, kcalPerG: number) =>
    grams != null && target > 0 ? Math.max(0, (grams * kcalPerG) / target) : undefined;
  return {
    kcal: eaten,
    target: target > 0 ? target : undefined,
    ratio: target > 0 ? eaten / target : undefined,
    remaining: target > 0 && !over && eaten < target ? Math.round(target - eaten) : undefined,
    overBy: over ? Math.round(eaten - target) : undefined,
    over,
    gain,
    protein: spec.proteinG ?? undefined,
    proteinTarget: spec.proteinTargetG ?? undefined,
    proteinRatio: spec.proteinG != null && spec.proteinTargetG ? spec.proteinG / spec.proteinTargetG : undefined,
    carbs: spec.carbsG ?? undefined,
    fat: spec.fatG ?? undefined,
    segProtein: macroFraction(spec.proteinG, 4),
    segCarbs: macroFraction(spec.carbsG, 4),
    segFat: macroFraction(spec.fatG, 9),
    streak: (spec.streakDays ?? 0) > 0 ? spec.streakDays : undefined,
  };
}

function streakData(spec: ProgressStory): Record<string, unknown> | undefined {
  const days = spec.streakDays ?? 0;
  if (days <= 0) return undefined;
  const next = nextStreakMilestone(days);
  const labelsFrom = spec.date ?? new Date();
  // Last 7 days ending on the sticker day: the current streak fills from the right.
  const week: number[] = [];
  const dates: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(labelsFrom.getFullYear(), labelsFrom.getMonth(), labelsFrom.getDate() - i);
    week.push(i < days ? 1 : 0);
    dates.push(localDayKey(d));
  }
  return {
    days,
    best: undefined,
    week,
    weekDates: dates,
    weekLabels: dates,
    total: spec.trackedDays && spec.trackedDays > 0 ? spec.trackedDays : undefined,
    next: next ?? undefined,
    toNext: next ? next - days : undefined,
    milestone: streakMilestone(days) ?? undefined,
  };
}

function weightData(spec: ProgressStory, hideNumbers: boolean): Record<string, unknown> | undefined {
  if (spec.maternal) return undefined;
  const trend = [...(spec.weekTrend ?? [])].sort((a, b) => a.date.localeCompare(b.date));
  const gain = spec.gain === true;
  const lost = (spec.weightLostKg ?? 0) > 0 ? spec.weightLostKg! : undefined;
  const gained = (spec.weightGainedKg ?? 0) > 0 ? spec.weightGainedKg! : undefined;
  const goal = spec.weightGoalProgress ?? undefined;
  const hasAny = trend.length >= 2 || lost !== undefined || gained !== undefined || goal !== undefined;
  if (!hasAny) return undefined;
  const weights = trend.map((p) => p.weightKg);
  const min = weights.length ? Math.min(...weights) : 0;
  const max = weights.length ? Math.max(...weights) : 0;
  const normalized = weights.length >= 2 ? weights.map((w) => (max === min ? 0.5 : (w - min) / (max - min))) : undefined;
  const delta = weights.length >= 2 ? round1(weights[weights.length - 1]! - weights[0]!) : undefined;
  const direction = delta === undefined ? undefined : delta > 0.05 ? "up" : delta < -0.05 ? "down" : "steady";
  return {
    gain,
    goalPct: goal === undefined ? undefined : Math.min(1, Math.max(0, goal)),
    direction,
    // The trend line carries no kg values: it is drawn from normalized points, so it is safe to share.
    trend: normalized,
    dates: trend.length >= 2 ? trend.map((p) => p.date) : undefined,
    // Numbers: gone entirely unless the user chose to show them.
    lostKg: hideNumbers ? undefined : lost,
    gainedKg: hideNumbers ? undefined : gained,
    deltaKg: hideNumbers ? undefined : delta,
    startKg: hideNumbers ? undefined : spec.weight?.startKg,
    nowKg: hideNumbers ? undefined : spec.weight?.nowKg,
    goalKg: hideNumbers ? undefined : (spec.weight?.goalKg ?? undefined),
    // Non-numeric reading used when numbers are hidden.
    moved: lost !== undefined || gained !== undefined ? true : undefined,
  };
}

function weekData(spec: RecapStory): Record<string, unknown> {
  const days = spec.days ?? [];
  return {
    name: spec.name,
    start: spec.weekStart,
    end: spec.weekEnd,
    avgKcal: spec.avgKcal,
    targetKcal: spec.targetKcal > 0 ? spec.targetKcal : undefined,
    daysOnTarget: spec.daysOnTarget,
    loggedDays: spec.loggedDays,
    proteinAvg: spec.proteinAvgG ?? undefined,
    proteinTarget: spec.proteinTargetG ?? undefined,
    streak: spec.streakDays > 0 ? spec.streakDays : undefined,
    exerciseKcal: spec.exerciseKcal > 0 ? spec.exerciseKcal : undefined,
    exerciseMin: spec.exerciseMin > 0 ? spec.exerciseMin : undefined,
    weightChangeKg: spec.weightChangeKg ?? undefined,
    bestDayLabel: spec.bestDay?.label,
    bestDayKcal: spec.bestDay?.kcal,
    gain: spec.gain,
    kcalDays: days.length ? days.map((d) => d.kcal) : undefined,
    dayDates: days.length ? days.map((d) => d.date) : undefined,
    onTargetRatio: spec.loggedDays > 0 ? spec.daysOnTarget / spec.loggedDays : undefined,
  };
}

/** Axis top for the intake bars: the biggest bar or target plus a little air, rounded up to 500 kcal. */
function niceKcalTop(maxKcal: number): number {
  return Math.max(500, Math.ceil((maxKcal * 1.1) / 500) * 500);
}

/** Calendar days from `from` to `to`, both included (WIB day strings; pure UTC math). */
function daysInclusive(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

function periodData(spec: PeriodStory, hideNumbers: boolean): Record<string, unknown> | undefined {
  const weight = spec.weight ?? null;
  if (weight === null && (spec.judgedDays <= 0 || spec.loggedDays <= 0)) return undefined;
  const series = weight?.series ?? [];
  const kgs = series.map((p) => p.kg);
  const lo = kgs.length ? Math.min(...kgs) : 0;
  const hi = kgs.length ? Math.max(...kgs) : 0;
  const trend = series.length >= 2 ? kgs.map((kg) => (hi === lo ? 0.5 : (kg - lo) / (hi - lo))) : undefined;

  const energy = spec.energy ?? null;
  const showEnergy = energy !== null && !spec.hideDeficit && energy.countedDays > 0;
  const gain = spec.gain === true;
  const deficit = showEnergy && !gain && energy.balanceKcal > 0 ? energy.balanceKcal : undefined;
  const surplus = showEnergy && gain && energy.balanceKcal < 0 ? -energy.balanceKcal : undefined;

  const intake = spec.intake ?? null;
  const barValues = intake?.bars.map((b) => b.avgKcal ?? 0) ?? [];
  const target = intake?.targetKcal && intake.targetKcal > 0 ? intake.targetKcal : undefined;
  const top = barValues.some((v) => v > 0) ? niceKcalTop(Math.max(...barValues, target ?? 0)) : undefined;
  const bars = intake && top !== undefined && barValues.length >= 1 ? intake.bars : undefined;

  return {
    from: spec.from,
    to: spec.to,
    days: daysInclusive(spec.from, spec.to),
    logged: spec.loggedDays,
    judged: spec.judgedDays,
    streak: (spec.streakDays ?? 0) > 1 ? spec.streakDays : undefined,
    gain,
    // The change itself always travels (it is the point); the percent and absolute kg only with numbers shown,
    // because change and percent together give the starting weight away.
    changeKg: weight ? Math.abs(weight.changeKg) : undefined,
    direction: weight?.direction,
    changePct: weight && !hideNumbers ? Math.abs(weight.changePct) : undefined,
    startKg: weight && !hideNumbers ? weight.startKg : undefined,
    endKg: weight && !hideNumbers ? weight.endKg : undefined,
    rateKg: weight?.weeklyRateKg != null ? Math.abs(weight.weeklyRateKg) : undefined,
    trend,
    trendFrom: trend ? series[0]!.date : undefined,
    trendTo: trend ? series[series.length - 1]!.date : undefined,
    kgTop: trend && !hideNumbers ? hi : undefined,
    kgBottom: trend && !hideNumbers ? lo : undefined,
    deficitKcal: deficit,
    surplusKcal: surplus,
    avgDeficitKcal: deficit !== undefined && energy ? Math.round(energy.balanceKcal / energy.countedDays) : undefined,
    countedDays: showEnergy ? energy.countedDays : undefined,
    fatKg: deficit !== undefined && energy?.impliedFatKg ? energy.impliedFatKg : undefined,
    bars: bars ? barValues.map((v) => (v > 0 && top ? v / top : 0)) : undefined,
    barsTop: bars ? top : undefined,
    barsTarget: bars && target && top ? target / top : undefined,
    targetKcal: bars ? target : undefined,
    barsFrom: bars ? bars[0]!.from : undefined,
    barsTo: bars ? bars[bars.length - 1]!.to : undefined,
    barsWeekly: bars && intake!.weekly ? true : undefined,
  };
}

function milestoneData(spec: StorySpec): Record<string, unknown> | undefined {
  if (spec.kind === "progress") {
    const m = streakMilestone(spec.streakDays ?? 0);
    return m === null ? undefined : { kind: "streak", value: m, isStreak: true };
  }
  if (spec.kind === "workout" && (spec.prs?.length ?? 0) > 0) {
    return { kind: "pr", value: spec.prs!.length, isPr: true, detail: spec.prs![0]!.exercise };
  }
  if (spec.kind === "recap" && spec.loggedDays > 0 && spec.daysOnTarget >= 5) {
    return { kind: "week", value: spec.daysOnTarget, isWeek: true };
  }
  if (spec.kind === "challenge" && spec.rank !== null && spec.rank <= 3 && spec.participants > 1 && spec.status !== "upcoming") {
    return { kind: "podium", value: spec.rank, isPodium: true };
  }
  return undefined;
}

export function buildStickerData(spec: StorySpec, prefs: StickerPrefs = {}): StickerData {
  const options = prefs.options;
  const hideNumbers = options?.hideNumbers ?? true;
  const data: Record<string, unknown> = { kind: spec.kind };
  if (prefs.userName) data.user = { name: prefs.userName };
  let dayFoodAssets: Record<string, ImageRef> = {};
  switch (spec.kind) {
    case "meal":
      data.meal = {
        name: spec.name,
        kcal: spec.kcal,
        protein: spec.protein ?? undefined,
        carbs: spec.carbs ?? undefined,
        fat: spec.fat ?? undefined,
        reaction: spec.reaction || undefined,
      };
      break;
    case "workout":
      data.workout = {
        name: spec.name,
        durationMin: spec.durationMin ?? undefined,
        volumeKg: spec.volumeKg ? spec.volumeKg : undefined,
        sets: spec.setsDone ?? undefined,
        prCount: (spec.prs?.length ?? 0) > 0 ? spec.prs!.length : undefined,
        pr0: spec.prs?.[0],
        pr1: spec.prs?.[1],
        pr2: spec.prs?.[2],
      };
      break;
    case "progress":
      data.day = dayData(spec);
      data.streak = streakData(spec);
      data.weight = weightData(spec, hideNumbers);
      break;
    case "recap":
      data.week = weekData(spec);
      break;
    case "period":
      data.period = periodData(spec, hideNumbers);
      break;
    case "challenge":
      data.challenge = {
        title: spec.title,
        status: spec.status,
        hitDays: spec.hitDays,
        judgedDays: spec.judgedDays,
        durationDays: spec.durationDays,
        streak: spec.streak > 0 ? spec.streak : undefined,
        bestStreak: spec.status !== "upcoming" ? spec.bestStreak : undefined,
        rank: spec.rank !== null && spec.participants > 1 && spec.status !== "upcoming" ? spec.rank : undefined,
        participants: spec.participants,
        upcoming: spec.status === "upcoming",
      };
      break;
    case "dayfood": {
      const food = dayFoodData(spec);
      data.dayfood = food.day;
      data.slide = food.slide;
      dayFoodAssets = food.assets;
      break;
    }
  }
  data.milestone = milestoneData(spec);
  const assets: Record<string, ImageRef | undefined> = { ...dayFoodAssets };
  // A cutout (transparent PNG of the food) is never a full-bleed background: it has its own slot.
  if (prefs.cutout) assets.cutout = prefs.cutout;
  else if (spec.kind === "meal" && spec.cutoutUri) assets.cutout = { uri: spec.cutoutUri };
  else if (spec.kind === "meal" && spec.photoCutout && spec.photoUri) assets.cutout = { uri: spec.photoUri };
  if (prefs.photo) assets.photo = prefs.photo;
  else if (spec.kind === "meal" && spec.photoUri && !spec.photoCutout) assets.photo = { uri: spec.photoUri };
  return { date: localDayKey(spec.date ?? new Date()), data, assets, options };
}

/** Privacy defaults: exact weight stays hidden unless the user opts in. */
export function defaultOptions(): StickerOptions {
  return {
    watermark: true,
    hideNumbers: true,
    showName: false,
    privacy: { routeTrimMeters: 200 },
  };
}

export type { StickerOptions };
