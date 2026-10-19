/**
 * The `snapshot` that `coach.chat` expects with every message. On the phone JoyoFit builds it from its own engine; the
 * web has no engine, so this builds the smallest honest one from what the web can read: the recovery days
 * (`fitWeb.recovery`) and the recent cloud workouts (`fitWeb.workouts`). Every field is either a number or word those
 * rows hold, or a plain statistic of them (an average, a median), or null. Nothing is made up:
 * - `suggestion` and `plan` are null: they come from the phone's engine; the server fills the plan from the stored plan
 *   document when the snapshot has none (docs/coach.md);
 * - `workouts[].strain` is null (the list has no per-workout strain) and `matchedPlan` is false (the web cannot match
 *   workouts to the plan), so the coach is not told something it cannot know;
 * - `hrv.baselineMs` is the mean HRV of the days the window holds, `hrv.recentMs` the mean of the last seven nights.
 * Pure: no I/O, the clock comes in as arguments.
 */

import { daysBetween, shiftDate } from "@joyorogo/api/lib/engine";
import type { RecoveryDayView } from "@joyorogo/api/lib/fit-data";
import type { FitWebWorkout } from "@joyorogo/api/lib/fit-web";
import type { CoachSnapshot } from "@joyorogo/api/lib/coach-chat";

import { latest, mean, sleepStats } from "../aggregate";

/** Days of recovery the snapshot reads: enough for an HRV baseline and sleep need, short enough to stay current. */
export const SNAPSHOT_RECOVERY_DAYS = 60;
/** Days of workouts it reads; at most `SNAPSHOT_WORKOUTS` of them go in. */
export const SNAPSHOT_WORKOUT_DAYS = 30;
export const SNAPSHOT_WORKOUTS = 10;

const READINESS = ["Primed", "Balanced", "Strained", "Run down"] as const;
const LOAD_STATUS = [
  "productive",
  "maintaining",
  "recovery",
  "overreaching",
  "detraining",
] as const;
const HRV_STATE = ["balanced", "unbalanced", "low"] as const;

const oneOf = <T extends string>(list: readonly T[], value: string | null | undefined): T | null =>
  list.find((item) => item === value) ?? null;

const round = (value: number, decimals = 0): number => {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
};
const roundOrNull = (value: number | null, decimals = 0): number | null =>
  value === null ? null : round(value, decimals);

/** Needs at least this many HRV readings, so a baseline or a recent figure is a measurement and not one night. */
const MIN_HRV_RECENT = 3;
const MIN_HRV_BASELINE = 7;

export interface SnapshotInput {
  /** WIB calendar day, `YYYY-MM-DD`. */
  today: string;
  /** Epoch ms, only for `generatedAt`. */
  nowMs: number;
  /** Recovery days in any order (`fitWeb.recovery` returns them oldest first). */
  days: readonly RecoveryDayView[];
  /** Cloud workouts, newest first (`fitWeb.workouts`). */
  workouts: readonly FitWebWorkout[];
}

export function buildCoachSnapshot({ today, nowMs, days, workouts }: SnapshotInput): CoachSnapshot {
  const sorted = days
    .filter((d) => d.date <= today)
    .toSorted((a, b) => a.date.localeCompare(b.date));
  /** Days no older than `age` days, oldest first. */
  const within = (age: number) => sorted.filter((d) => daysBetween(d.date, today) < age);
  const recent = within(7);
  const byDate = new Map(sorted.map((d) => [d.date, d]));

  const readinessDay = within(3).findLast((d) => oneOf(READINESS, d.readiness) !== null);
  const headline = readinessDay ? oneOf(READINESS, readinessDay.readiness) : null;

  const loadDay = recent.findLast(
    (d) => oneOf(LOAD_STATUS, d.trainingStatus) !== null && d.loadRatio !== null,
  );
  const loadStatus = loadDay ? oneOf(LOAD_STATUS, loadDay.trainingStatus) : null;

  const hrvDay = recent.findLast((d) => oneOf(HRV_STATE, d.hrvStatus) !== null);
  const hrvState = hrvDay ? oneOf(HRV_STATE, hrvDay.hrvStatus) : null;
  const recentHrv = recent.map((d) => d.hrvMs).filter((v): v is number => v !== null);
  const baselineHrv = sorted.map((d) => d.hrvMs).filter((v): v is number => v !== null);

  // The night that ended this morning (or yesterday morning: the watch may sync late) is "last night".
  const lastNightHours = within(2).findLast((d) => d.sleepHours !== null)?.sleepHours ?? null;
  const sleepWindow = sleepStats(within(14));
  const sleep = {
    lastNightMin: lastNightHours === null ? null : round(lastNightHours * 60),
    debtMin: roundOrNull(sleepWindow.debtHours === null ? null : sleepWindow.debtHours * 60),
    needTonightMin: roundOrNull(sleepWindow.needHours === null ? null : sleepWindow.needHours * 60),
  };

  const strain = {
    yesterday: roundOrNull(byDate.get(shiftDate(today, -1))?.strain ?? null, 1),
    today: roundOrNull(byDate.get(today)?.strain ?? null, 1),
    avg7: roundOrNull(mean(recent.map((d) => d.strain)), 1),
  };

  return {
    generatedAt: Math.floor(nowMs / 1000),
    today,
    readiness: headline ? { headline } : null,
    load:
      loadDay && loadStatus
        ? { status: loadStatus, ratio: round(loadDay.loadRatio as number, 2) }
        : null,
    hrv:
      hrvState && recentHrv.length >= MIN_HRV_RECENT && baselineHrv.length >= MIN_HRV_BASELINE
        ? {
            state: hrvState,
            recentMs: round(mean(recentHrv) as number, 1),
            baselineMs: round(mean(baselineHrv) as number, 1),
          }
        : null,
    sleep:
      sleep.lastNightMin === null && sleep.debtMin === null && sleep.needTonightMin === null
        ? null
        : sleep,
    strain:
      strain.yesterday === null && strain.today === null && strain.avg7 === null ? null : strain,
    restingHr: roundOrNull(latest(recent.map((d) => d.restingHrBpm))),
    vo2max: roundOrNull(latest(sorted.map((d) => d.vo2maxMlKgMin)), 1),
    suggestion: null,
    plan: null,
    workouts: workouts.slice(0, SNAPSHOT_WORKOUTS).map((w) => ({
      start: w.start,
      sport: w.sportName.slice(0, 40),
      durationMin: round(w.movingSec / 60),
      distanceKm: w.distanceM && w.distanceM > 0 ? round(w.distanceM / 1000, 2) : null,
      avgHr: w.avgHr,
      strain: null,
      matchedPlan: false,
    })),
  };
}
