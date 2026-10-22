// Extra read-only views for the AI connection (MCP): the coach plan and the consent-gated sleep nights and findings.
// Same rules as fit-data.ts: no transport, no auth, no paywall here; callers pass an authenticated user id.
// Menstrual cycle data is never read by anything in this file or exposed through the connector.

import { and, desc, eq, gte, lte } from "drizzle-orm";

import type { Database } from "@joyorogo/db";
import { sleepNight } from "@joyorogo/db/schema/sleep-insights";
import { isoInZone } from "@joyorogo/i18n";
import type { DayZone } from "@joyorogo/i18n";

import { readCoachDoc } from "./coach-doc";
import type { CoachDoc } from "./coach-doc";
import { daysBetween, jakartaToday } from "./engine";
import { readPref, sleepFindingsFor } from "./sleep-insights-store";

const round1 = (value: number): number => Math.round(value * 10) / 10;
const minutes = (seconds: number): number => Math.round(seconds / 60);
const DAY_MS = 86_400_000;
const RECENT_DAYS = 14;

export interface PlanView {
  hasPlan: boolean;
  plan: {
    kind: "run" | "strength";
    goal: string;
    level: string;
    daysPerWeek: number;
    /** 0 = Sunday. */
    weekdays: number[];
    startDay: string;
    weeks: number;
    /** 1-based week of today; 0 before the start, null after the last week. */
    currentWeek: number | null;
    /** The coach's adjustment of the current week (scalePct of the planned load and why), when there is one. */
    currentWeekAdjust: { scalePct: number; reason: string } | null;
  } | null;
  /** Sessions ticked off or skipped in the last 14 days, and ticked sessions with a recorded workout. */
  recent: { days: number; done: number; skipped: number; doneWithWorkout: number };
  /** Gym sessions logged in the plan document in the last 14 days. */
  strengthLogsRecent: number;
}

export function planViewOf(doc: CoachDoc | null, zone: DayZone, now: Date = new Date()): PlanView {
  const since = now.getTime() - RECENT_DAYS * DAY_MS;
  const entries = doc ? Object.values(doc.done).filter((e) => e.at >= since) : [];
  const recent = {
    days: RECENT_DAYS,
    done: entries.filter((e) => !e.skipped).length,
    skipped: entries.filter((e) => e.skipped).length,
    doneWithWorkout: entries.filter((e) => !e.skipped && e.workoutStart !== null).length,
  };
  const strengthLogsRecent = doc ? Object.values(doc.logs).filter((l) => l.at >= since).length : 0;
  const plan = doc?.plan;
  if (!plan) return { hasPlan: false, plan: null, recent, strengthLogsRecent };

  const offset = daysBetween(plan.startDay, jakartaToday(now, zone));
  const week = Math.floor(offset / 7) + 1;
  const currentWeek = offset < 0 ? 0 : week > plan.weeks ? null : week;
  const adjust = currentWeek ? plan.adjust[String(currentWeek)] : undefined;
  return {
    hasPlan: true,
    plan: {
      kind: plan.kind,
      goal: plan.goal,
      level: plan.level,
      daysPerWeek: plan.daysPerWeek,
      weekdays: plan.weekdays,
      startDay: plan.startDay,
      weeks: plan.weeks,
      currentWeek,
      currentWeekAdjust: adjust ? { scalePct: adjust.scalePct, reason: adjust.reason } : null,
    },
    recent,
    strengthLogsRecent,
  };
}

export async function getPlanView(db: Database, userId: string, zone: DayZone): Promise<PlanView> {
  return planViewOf((await readCoachDoc(db, userId)).doc, zone);
}

export interface SleepNightView {
  /** The day the night ended. */
  date: string;
  fellAsleep: string;
  wokeUp: string;
  asleepMin: number;
  awakeMin: number;
  awakenings: number;
  /** Null on a watch without sleep stages. */
  stagesMin: { deep: number; rem: number; light: number } | null;
  watchScore: number | null;
  hrvMs: number | null;
  restingHrBpm: number | null;
  napsMin: number[];
  bedroom: { tempCMean: number; humidityPctMean: number } | null;
}

export type SleepNightsResult =
  | { consent: false; message: string }
  | { consent: true; from: string; to: string; nights: SleepNightView[] };

const NO_CONSENT =
  "Wawasan tidur belum diaktifkan. Nyalakan di JoyoRogo (Profil > Privasi > Tidur) atau JoyoFit (Pengaturan > JoyoRogo), lalu tanya lagi. / " +
  "Sleep insights are switched off. Turn them on in JoyoRogo (Profile > Privacy > Sleep) or JoyoFit (Settings > JoyoRogo), then ask again.";

/** Per-night sleep detail the person shared with the sleep-insights switch on; nothing without it. */
export async function getSleepNights(
  db: Database,
  userId: string,
  from: string,
  to: string,
  zone: DayZone,
): Promise<SleepNightsResult> {
  if (!(await readPref(db, userId)).enabled) return { consent: false, message: NO_CONSENT };
  const rows = await db
    .select()
    .from(sleepNight)
    .where(
      and(
        eq(sleepNight.userId, userId),
        gte(sleepNight.wakeDate, from),
        lte(sleepNight.wakeDate, to),
      ),
    )
    .orderBy(desc(sleepNight.wakeDate));
  const nights = rows.map((r): SleepNightView => ({
    date: r.wakeDate,
    fellAsleep: isoInZone(r.onsetMs, zone),
    wokeUp: isoInZone(r.wakeMs, zone),
    asleepMin: minutes(r.asleepS),
    awakeMin: minutes(r.awakeS),
    awakenings: r.awakenings,
    stagesMin:
      r.hasStages && r.deepS !== null && r.remS !== null && r.lightS !== null
        ? { deep: minutes(r.deepS), rem: minutes(r.remS), light: minutes(r.lightS) }
        : null,
    watchScore: r.watchScore,
    hrvMs: r.hrvMs === null ? null : round1(r.hrvMs),
    restingHrBpm: r.rhrBpm,
    napsMin: r.napsJson.map(([start, end]) => minutes((end - start) / 1000)),
    bedroom:
      r.tempCMean !== null && r.rhPctMean !== null
        ? { tempCMean: round1(r.tempCMean), humidityPctMean: Math.round(r.rhPctMean) }
        : null,
  }));
  return { consent: true, from, to, nights };
}

export type SleepFindingsResult =
  | { consent: false; message: string }
  | {
      consent: true;
      note: string;
      findings: {
        factor: string;
        confidence: "maybe" | "leaning";
        outcome: "asleep" | "awake";
        exposedNights: number;
        otherNights: number;
        /** Minutes: exposed-night mean minus other-night mean of the outcome. */
        diffMin: number;
        thresholdValue: number | null;
        through: string;
      }[];
    };

/** The personal patterns the sleep engine found (an association in the person's own nights, not a cause). */
export async function getSleepFindings(
  db: Database,
  userId: string,
  zone: DayZone,
): Promise<SleepFindingsResult> {
  if (!(await readPref(db, userId)).enabled) return { consent: false, message: NO_CONSENT };
  const found = await sleepFindingsFor(db, userId, zone);
  return {
    consent: true,
    note:
      found.length === 0
        ? "No pattern is strong enough yet (the engine needs about 14 nights and enough nights with and without each factor)."
        : "Associations in this person's own nights, not proof of cause. Word them with care: 'maybe' or 'leaning'.",
    findings: found.map((f) => ({
      factor: f.factor,
      confidence: f.confidence,
      outcome: f.outcome,
      exposedNights: f.exposed,
      otherNights: f.other,
      diffMin: Math.round(f.diff),
      thresholdValue: f.threshold,
      through: f.through,
    })),
  };
}
