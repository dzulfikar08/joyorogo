import type { ImageRef, StickerData, StickerOptions } from "../core/resolve";

/**
 * The app-facing contract: screens hand a `StorySpec` to the share sheet, and
 * `buildStickerData` flattens it into the binding namespaces templates read
 * (`day.*`, `meal.*`, `streak.*`, `weight.*`, `week.*`, `challenge.*`, `workout.*`,
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

export type StorySpec = MealStory | WorkoutStory | ProgressStory | RecapStory | ChallengeStory;

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
  }
  data.milestone = milestoneData(spec);
  const assets: Record<string, ImageRef | undefined> = {};
  // A cutout (transparent PNG of the food) is never a full-bleed background: it has its own slot.
  if (prefs.cutout) assets.cutout = prefs.cutout;
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
