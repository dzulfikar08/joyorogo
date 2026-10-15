// Pure rules for group challenges (tantangan grup), kept free of the DB so the
// router and both clients share one definition of "hit", streaks and ranking.
// Clients import this file for goal labels and share text, so it must not pull
// in server-only modules (type imports are erased and safe).
import type { ChallengeGoal } from "@joyorogo/db/schema/challenge";

import { daysBetween, shiftDate } from "./engine";

export type { ChallengeGoal };

/** Challenge lengths a host can pick, in days. */
export const CHALLENGE_DURATIONS = [7, 14, 30] as const;
/** A challenge may be scheduled at most this many days ahead. */
export const MAX_START_AHEAD_DAYS = 14;
/** Upcoming + running challenges per group. */
export const MAX_OPEN_CHALLENGES = 3;
export const CHALLENGE_TITLE_MAX = 60;
/**
 * A calorie day counts only when at least this share of the target was eaten.
 * Same cut-off the adaptive TDEE uses (plan.ts, minDayKcal): a day under half
 * the budget is a forgotten log, not a diet.
 */
export const CALORIE_FLOOR_RATIO = 0.5;

/**
 * How a day's number is backed.
 * - device: written by Health Connect, Apple Health or JoyoFit.
 * - photo: food entries that all came from a photo scan (still self-logged).
 * - manual: typed in by the user ("dicatat manual").
 */
export type Basis = "device" | "photo" | "manual";

export const BASIS_LABEL: Record<Basis, string> = {
  device: "Terverifikasi perangkat",
  photo: "Dari scan foto",
  manual: "Dicatat manual",
};

export type GoalSpec = {
  id: ChallengeGoal;
  label: string;
  /** One-line picker blurb. */
  blurb: string;
  /** Where the number comes from, shown under the goal. */
  source: string;
  unit: string;
  /** 'fixed': host sets one threshold. 'personal': each member's own plan target. */
  targetKind: "fixed" | "personal";
  /** Bounds for a fixed target; null for personal goals. */
  range: { min: number; max: number; step: number; default: number; presets: number[] } | null;
  /** Reaching the threshold can only go up during the day, so today may already count. */
  monotonic: boolean;
  /** Needs a device or app the member may not have connected. */
  needsDevice: boolean;
  /** Hint shown when a member has no data for this goal. */
  deviceHint: string | null;
};

export const GOALS: Record<ChallengeGoal, GoalSpec> = {
  steps: {
    id: "steps",
    label: "Langkah harian",
    blurb: "Capai jumlah langkah tertentu tiap hari.",
    source: "Langkah dari Health Connect atau Apple Health.",
    unit: "langkah",
    targetKind: "fixed",
    range: { min: 2000, max: 30000, step: 500, default: 8000, presets: [6000, 8000, 10000, 12000] },
    monotonic: true,
    needsDevice: true,
    deviceHint: "Hubungkan Health Connect atau Apple Health di JoyoRogo supaya langkahmu terhitung.",
  },
  protein: {
    id: "protein",
    label: "Target protein",
    blurb: "Penuhi target protein harianmu sendiri.",
    source: "Protein dari catatan makanmu, dibandingkan target proteinmu saat bergabung.",
    unit: "g protein",
    targetKind: "personal",
    range: null,
    monotonic: true,
    needsDevice: false,
    deviceHint: null,
  },
  calories: {
    id: "calories",
    label: "Kalori sesuai target",
    blurb: "Makan di bawah target kalori harianmu, tetap dicatat lengkap.",
    source: "Kalori dari catatan makanmu, dibandingkan target kalorimu saat bergabung.",
    unit: "kkal",
    targetKind: "personal",
    range: null,
    monotonic: false,
    needsDevice: false,
    deviceHint: null,
  },
  workouts: {
    id: "workouts",
    label: "Latihan tercatat",
    blurb: "Catat sesi latihan tiap hari.",
    source: "Sesi latihan di JoyoRogo, Strava, Health Connect atau Apple Health.",
    unit: "sesi",
    targetKind: "fixed",
    range: { min: 1, max: 3, step: 1, default: 1, presets: [1, 2, 3] },
    monotonic: true,
    needsDevice: false,
    deviceHint: null,
  },
  strain: {
    id: "strain",
    label: "Strain JoyoFit",
    blurb: "Capai strain tertentu dari jam tanganmu.",
    source: "Strain harian dari JoyoFit (skala 0 sampai 21).",
    unit: "strain",
    targetKind: "fixed",
    range: { min: 1, max: 21, step: 0.5, default: 10, presets: [8, 10, 12, 14] },
    monotonic: true,
    needsDevice: true,
    deviceHint: "Butuh JoyoFit dan jam tangan yang tersambung supaya strain terhitung.",
  },
  sleep: {
    id: "sleep",
    label: "Tidur JoyoFit",
    blurb: "Penuhi persentase tidur dari JoyoFit tiap malam.",
    source: "Skor tidur harian dari JoyoFit, persen dari kebutuhan tidurmu.",
    unit: "% tidur",
    targetKind: "fixed",
    range: { min: 50, max: 100, step: 5, default: 85, presets: [75, 85, 90, 100] },
    monotonic: true,
    needsDevice: true,
    deviceHint: "Butuh JoyoFit dan jam tangan yang tersambung supaya skor tidur terhitung.",
  },
};

export const GOAL_ORDER: ChallengeGoal[] = [
  "steps",
  "protein",
  "calories",
  "workouts",
  "strain",
  "sleep",
];

const numFmt = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1 });
const fmt = (n: number) => numFmt.format(n);

/** "Minimal 8.000 langkah per hari" style rule for a threshold. */
export function describeGoal(goal: ChallengeGoal, target: number | null): string {
  switch (goal) {
    case "steps":
      return target === null ? "Capai target langkah" : `Minimal ${fmt(target)} langkah per hari`;
    case "protein":
      return "Penuhi target protein harianmu";
    case "calories":
      return "Makan sampai target kalori harianmu, tidak lebih";
    case "workouts":
      return target === null
        ? "Catat latihan tiap hari"
        : `Catat minimal ${fmt(target)} sesi latihan per hari`;
    case "strain":
      return target === null ? "Capai strain" : `Strain JoyoFit minimal ${fmt(target)} per hari`;
    case "sleep":
      return target === null ? "Capai tidur" : `Tidur JoyoFit minimal ${fmt(target)}% per hari`;
  }
}

/** Default title when the host leaves the name empty. */
export function defaultChallengeTitle(
  goal: ChallengeGoal,
  target: number | null,
  durationDays: number,
): string {
  const head =
    goal === "steps" && target !== null
      ? `${fmt(target)} langkah`
      : goal === "protein"
        ? "Protein tercapai"
        : goal === "calories"
          ? "Kalori sesuai target"
          : goal === "workouts"
            ? "Latihan tiap hari"
            : goal === "strain" && target !== null
              ? `Strain ${fmt(target)}`
              : goal === "sleep" && target !== null
                ? `Tidur ${fmt(target)}%`
                : GOALS[goal].label;
  return `${head}, ${durationDays} hari`;
}

export type ChallengeInput = {
  goal: ChallengeGoal;
  target: number | null;
  durationDays: number;
  startDate: string;
};

/** Error message (Indonesian) for an invalid host input, null when valid. */
export function validateChallengeInput(input: ChallengeInput, today: string): string | null {
  const spec = GOALS[input.goal];
  if (!(CHALLENGE_DURATIONS as readonly number[]).includes(input.durationDays)) {
    return "Pilih durasi 7, 14, atau 30 hari.";
  }
  if (input.startDate < today || input.startDate > shiftDate(today, MAX_START_AHEAD_DAYS)) {
    return `Mulai paling lambat ${MAX_START_AHEAD_DAYS} hari dari sekarang.`;
  }
  if (spec.targetKind === "personal") {
    return input.target === null ? null : "Target protein dan kalori ikut profil tiap anggota.";
  }
  const range = spec.range;
  if (!range || input.target === null) return "Isi targetnya dulu.";
  if (input.target < range.min || input.target > range.max) {
    return `Target ${spec.label.toLowerCase()} antara ${fmt(range.min)} dan ${fmt(range.max)}.`;
  }
  // Multiples of the step keep steps/sleep/strain thresholds tidy.
  const offset = (input.target - range.min) / range.step;
  if (Math.abs(offset - Math.round(offset)) > 1e-9) {
    return `Target harus kelipatan ${fmt(range.step)}.`;
  }
  return null;
}

export function challengeEndDate(startDate: string, durationDays: number): string {
  return shiftDate(startDate, durationDays - 1);
}

export type ChallengeStatus = "upcoming" | "active" | "ended";

export function challengeStatus(startDate: string, endDate: string, today: string): ChallengeStatus {
  if (today < startDate) return "upcoming";
  if (today > endDate) return "ended";
  return "active";
}

/**
 * First day counted for a member who joins on `joinDay`: the challenge start
 * or the join day, whichever is later. The join day itself counts in full.
 */
export function memberFromDate(startDate: string, joinDay: string): string {
  return joinDay > startDate ? joinDay : startDate;
}

// --- Daily evaluation --------------------------------------------------------

/** Normalised numbers for one member-day; `value: null` means no data synced or logged. */
export type DayFacts = { value: number | null; basis: Basis | null; mealsLogged?: number };

export type DayStatus = "hit" | "miss" | "pending";
export type DayResult = {
  date: string;
  status: DayStatus;
  value: number | null;
  /** Backing of the value; null when there is none. */
  basis: Basis | null;
};

/**
 * Judges one day. Today is never a miss while it can still be won: a goal
 * that only goes up (steps, protein, ...) hits the moment it is reached and is
 * 'pending' otherwise; calories (an upper bound) stay 'pending' until the day
 * is over, unless already exceeded, which is final.
 */
export function evaluateDay(args: {
  goal: ChallengeGoal;
  target: number;
  facts: DayFacts | undefined;
  date: string;
  today: string;
}): DayResult {
  const { goal, target, facts, date, today } = args;
  const isToday = date === today;
  const value = facts?.value ?? null;
  const basis = facts?.basis ?? null;
  const open: DayStatus = isToday ? "pending" : "miss";
  const result = (status: DayStatus): DayResult => ({ date, status, value, basis });

  if (goal === "calories") {
    if (value === null || (facts?.mealsLogged ?? 0) === 0) return result(open);
    if (value > target) return result("miss");
    if (value < target * CALORIE_FLOOR_RATIO) return result(open);
    return result(isToday ? "pending" : "hit");
  }
  if (value === null) return result(open);
  return result(value >= target ? "hit" : open);
}

export type Progress = {
  /** One entry per judged day (fromDate through min(endDate, today)). */
  days: DayResult[];
  hitDays: number;
  /** Days judged and failed (today pending is not counted). */
  missDays: number;
  /** Days in this member's span, whole challenge from fromDate on. */
  totalDays: number;
  /** Consecutive hit days ending at the latest judged day; a pending today does not break it. */
  streak: number;
  bestStreak: number;
  /** Hit days by backing, so a board can say how many are verified. */
  hitsByBasis: Record<Basis, number>;
};

export function buildProgress(args: {
  goal: ChallengeGoal;
  target: number;
  fromDate: string;
  endDate: string;
  today: string;
  factsByDate: ReadonlyMap<string, DayFacts>;
}): Progress {
  const { goal, target, fromDate, endDate, today, factsByDate } = args;
  const last = today < endDate ? today : endDate;
  const days: DayResult[] = [];
  for (let date = fromDate; date <= last; date = shiftDate(date, 1)) {
    days.push(evaluateDay({ goal, target, facts: factsByDate.get(date), date, today }));
  }

  const hitsByBasis: Record<Basis, number> = { device: 0, photo: 0, manual: 0 };
  let hitDays = 0;
  let missDays = 0;
  let run = 0;
  let bestStreak = 0;
  for (const day of days) {
    if (day.status === "hit") {
      hitDays += 1;
      run += 1;
      bestStreak = Math.max(bestStreak, run);
      hitsByBasis[day.basis ?? "manual"] += 1;
    } else if (day.status === "miss") {
      missDays += 1;
      run = 0;
    }
    // pending (today) neither extends nor breaks the run
  }
  // `run` already reflects the trailing hits because pending is skipped.
  return {
    days,
    hitDays,
    missDays,
    totalDays: fromDate > endDate ? 0 : daysBetween(fromDate, endDate) + 1,
    streak: run,
    bestStreak,
    hitsByBasis,
  };
}

// --- Ranking -----------------------------------------------------------------

export type RankKey = { hitDays: number; bestStreak: number; streak: number };

/** Higher hit count first, then current streak, then best streak. */
export function compareRank(a: RankKey, b: RankKey): number {
  return b.hitDays - a.hitDays || b.streak - a.streak || b.bestStreak - a.bestStreak;
}

/** Competition ranking (1, 1, 3): equal keys share a place. Input order is preserved. */
export function assignRanks<T extends RankKey>(sorted: T[]): number[] {
  const ranks: number[] = [];
  sorted.forEach((item, i) => {
    const prev = sorted[i - 1];
    ranks.push(prev && compareRank(prev, item) === 0 ? (ranks[i - 1] ?? i + 1) : i + 1);
  });
  return ranks;
}

// --- Normalising raw rows into DayFacts --------------------------------------

/** Health Connect / Apple Health rows are device-written. */
export function stepsFacts(row: { steps: number } | undefined): DayFacts | undefined {
  return row ? { value: row.steps, basis: "device" } : undefined;
}

/** Food: photo basis only when every entry that day came from a scan. */
export function foodFacts(
  goal: "protein" | "calories",
  row: { kcal: number | null; protein: number | null; meals: number; aiMeals: number } | undefined,
): DayFacts | undefined {
  if (!row || row.meals === 0) return undefined;
  const value = goal === "protein" ? (row.protein ?? 0) : (row.kcal ?? 0);
  return {
    value,
    basis: row.aiMeals >= row.meals ? "photo" : "manual",
    mealsLogged: row.meals,
  };
}

/**
 * Workouts: `verified` counts sessions that came from Strava, Health Connect
 * or Apple Health. The day is device-backed only when the verified sessions
 * alone reach the target; otherwise it is manual.
 */
export function workoutFacts(
  row: { total: number; verified: number } | undefined,
  target: number,
): DayFacts | undefined {
  if (!row || row.total === 0) return undefined;
  return { value: row.total, basis: row.verified >= target ? "device" : "manual" };
}

/** JoyoFit scores are pushed by the app from the watch: always device-backed. */
export function fitnessFacts(value: number | null | undefined): DayFacts | undefined {
  return value === null || value === undefined ? undefined : { value, basis: "device" };
}

// --- Share text --------------------------------------------------------------

export type ChallengeShare = {
  title: string;
  goal: ChallengeGoal;
  target: number | null;
  durationDays: number;
  status: ChallengeStatus;
  hitDays: number;
  /** Days judged so far for the sharer; the denominator of "x dari y hari". */
  judgedDays: number;
  streak: number;
  bestStreak: number;
  rank: number | null;
  participants: number;
  /** Hit days by backing, so the card and caption can say how solid the numbers are. */
  hitsByBasis: Record<Basis, number>;
};

/**
 * One honest line about how the hit days were recorded; null with no hits.
 * Anything typed in by hand always shows up, even as a minority.
 */
export function verificationLabel(hits: Record<Basis, number>): string | null {
  const total = hits.device + hits.photo + hits.manual;
  if (total === 0) return null;
  if (hits.device === total) return BASIS_LABEL.device;
  if (hits.photo === total) return BASIS_LABEL.photo;
  if (hits.manual === total) return BASIS_LABEL.manual;
  return hits.manual > 0 ? "Sebagian dicatat manual" : "Perangkat dan scan foto";
}

/** Caption for Threads/IG/WhatsApp. Honest about progress: no rounding up. */
export function challengeShareText(share: ChallengeShare): string {
  const ordinal =
    share.rank !== null && share.participants > 1
      ? ` Peringkat ${share.rank} dari ${share.participants}.`
      : "";
  const streak = share.bestStreak >= 2 ? ` Streak terbaik ${share.bestStreak} hari.` : "";
  const when =
    share.status === "ended"
      ? `Tantangan ${share.durationDays} hari selesai`
      : share.status === "upcoming"
        ? `Ikut tantangan ${share.durationDays} hari`
        : `Lagi jalan di tantangan ${share.durationDays} hari`;
  const score =
    share.status === "upcoming"
      ? ""
      : ` ${share.hitDays} dari ${share.judgedDays} hari target tercapai.`;
  const label = verificationLabel(share.hitsByBasis);
  const data = share.status !== "upcoming" && label ? ` Data: ${label.toLowerCase()}.` : "";
  return `${when}: ${share.title}.${score}${ordinal}${streak}${data} Ayo ikut di JoyoRogo.`;
}
