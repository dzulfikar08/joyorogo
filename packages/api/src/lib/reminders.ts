import { sql } from "drizzle-orm";

import type { Database } from "@joyorogo/db";
import { dayBoundsIn, dayZoneOffsetMs, weekdayOfMs } from "@joyorogo/i18n";
import type { DayZone } from "@joyorogo/i18n";

import { calibrationNotice } from "./calibration";
import { readCalibrationPrefs } from "./calibration-store";
import { daysBetween, effectiveRamadan, shiftDate } from "./engine";
import {
  insideWindow,
  isFastingPattern,
  wibDateKey,
  wibMinutes,
  windowHoursFor,
  windowTimes,
} from "./fasting";
import { enqueueMany } from "./notify";
import type { NotifyDeps, PushCategory, PushEvent } from "./notify";
import { buildPlan, planQueries } from "./plan";
import { premiumUnlocked } from "./readiness-food";
import type { StreakState } from "./streak";
import { loadStreaks, streakPlanOf } from "./streak-store";
import { paywallConfig } from "./tiers";
import type { PaywallEnv } from "./tiers";
import { ZONE_GROUPS, profileInZone } from "./zone-sql";

// Reminders the server decides on, per person, in the person's own zone. The five-minute cron calls `runReminders`; each reminder has a
// window of the day (and a weekday for the weekly ones). Inside the window every tick looks for people who qualify and
// have not been sent this reminder today (a dedupe key per day), so a skipped tick only delays it and a person never
// gets one twice. Rows are stored with `enqueueMany`; the same tick's flush delivers them, applying the person's
// switches, quiet hours and daily caps. Rules, windows and defaults: docs/push.md.

export type ReminderKind =
  | "meal_noon"
  | "meal_evening"
  | "weigh"
  | "recap"
  | "plan"
  | "calibration"
  | "challenge_end";

export type ReminderSlot = {
  kind: ReminderKind;
  category: PushCategory;
  /** Minute of the person's local day the window opens / closes. */
  startMin: number;
  endMin: number;
  /** Local weekday (0 = Sunday) for weekly reminders. */
  dow?: number;
};

const h = (hours: number, minutes = 0) => hours * 60 + minutes;

export const REMINDER_SLOTS: readonly ReminderSlot[] = [
  { kind: "meal_noon", category: "meal", startMin: h(13), endMin: h(13, 45) },
  { kind: "meal_evening", category: "meal", startMin: h(20), endMin: h(20, 45) },
  { kind: "weigh", category: "weigh", startMin: h(7, 30), endMin: h(9) },
  { kind: "plan", category: "recap", startMin: h(7, 30), endMin: h(9, 30), dow: 1 },
  { kind: "recap", category: "recap", startMin: h(8), endMin: h(10), dow: 1 },
  { kind: "calibration", category: "recap", startMin: h(8, 30), endMin: h(10) },
  { kind: "challenge_end", category: "group", startMin: h(8), endMin: h(10) },
];

/** A reminder delivered this long after its window closed is dropped as stale. */
const STALE_AFTER_WINDOW_MS = 30 * 60_000;

/** The streak must be at least this long to be "at risk". */
export const STREAK_RISK_MIN = 3;
/** The weigh-in reminder comes after this many days without one, then at most once a week. */
export const WEIGH_AFTER_DAYS = 7;
/** Nobody is nagged about food after two weeks without a single entry. */
export const ENGAGED_DAYS = 14;
/** Calibration is looked at by a twelfth of the people per tick (stable per person), not everybody every tick. */
const CALIBRATION_SLOTS = 12;
const CALIBRATION_BATCH = 60;
const CANDIDATE_LIMIT = 500;

/** Local weekday of a timestamp in `zone`, 0 = Sunday. */
export function wibWeekday(now: Date, zone: DayZone): number {
  return weekdayOfMs(now.getTime(), zone);
}

/** The reminder windows `now` is inside of for people living in `zone`. */
export function activeSlots(now: Date, zone: DayZone): ReminderSlot[] {
  const minute = wibMinutes(now, zone);
  const weekday = wibWeekday(now, zone);
  return REMINDER_SLOTS.filter(
    (slot) =>
      minute >= slot.startMin &&
      minute < slot.endMin &&
      (slot.dow === undefined || slot.dow === weekday),
  );
}

export function slotStaleMs(slot: ReminderSlot): number {
  return (slot.endMin - slot.startMin) * 60_000 + STALE_AFTER_WINDOW_MS;
}

/**
 * Whether a food reminder makes no sense for this person right now. Intermittent fasting: nothing outside the eating
 * window (a lunch nudge to someone whose window opens at 18:00, an evening one after it closed). Ramadan: no lunch nudge
 * (the day is a fast); the evening one stays because the fast breaks. Pregnant and breastfeeding accounts never fast,
 * so a leftover pattern setting is ignored for them.
 */
export function skipMealReminder(input: {
  kind: "meal_noon" | "meal_evening";
  nowMin: number;
  pattern: string | null;
  windowStart: string | null;
  ramadanMode: string | null;
  maternalMode: string | null;
  now: Date;
  zone: DayZone;
}): boolean {
  if (input.maternalMode && input.maternalMode !== "none") return false;
  const ramadanPref =
    input.ramadanMode === "on" || input.ramadanMode === "off" || input.ramadanMode === "auto"
      ? input.ramadanMode
      : "auto";
  if (effectiveRamadan(ramadanPref, input.now, input.zone)) return input.kind === "meal_noon";
  if (isFastingPattern(input.pattern) && input.windowStart) {
    return !insideWindow(
      input.nowMin,
      windowTimes(input.windowStart, windowHoursFor(input.pattern)),
    );
  }
  return false;
}

/** Days since the last weigh-in (or since the account began) once that reaches a week; null before. */
export function weighGapDays(input: {
  lastWeighDate: string | null;
  createdDate: string;
  today: string;
}): number | null {
  const since = input.lastWeighDate ?? input.createdDate;
  const days = daysBetween(since, input.today);
  return days >= WEIGH_AFTER_DAYS ? days : null;
}

/** The streak that today's missing entry would break (0 when today counts, or the streak is too short to matter). */
export function streakAtRisk(state: StreakState): number {
  return state.status === "at_risk" && state.days >= STREAK_RISK_MIN ? state.days : 0;
}

/** Stable small number per person, to spread a daily job over the ticks of its window. */
export function userSlot(userId: string, slots: number): number {
  let sum = 0;
  for (let i = 0; i < userId.length; i++) sum = (sum * 31 + userId.charCodeAt(i)) % 100_003;
  return sum % slots;
}

// --- Candidate queries ------------------------------------------------------------------------

const reachable = sql`(EXISTS (SELECT 1 FROM push_device d WHERE d.user_id = profile.user_id)
  OR EXISTS (SELECT 1 FROM push_subscription s WHERE s.user_id = profile.user_id))`;

const prefOn = (column: "meal" | "weigh" | "recap") =>
  sql`COALESCE((SELECT p.${sql.raw(column)} FROM push_prefs p WHERE p.user_id = profile.user_id), 1) = 1`;

const notYetSent = (dedupeKey: string) =>
  sql`NOT EXISTS (SELECT 1 FROM push_outbox o WHERE o.user_id = profile.user_id AND o.dedupe_key = ${dedupeKey})`;

/** The person's own synced phone reminder (sync_record rogo/pref/reminders) is off at `path`: the server one may fire. */
const localReminderOff = (path: string) =>
  sql`COALESCE((SELECT json_extract(r.json, ${path}) FROM sync_record r
    WHERE r.user_id = profile.user_id AND r.ns = 'rogo' AND r.kind = 'pref' AND r.id = 'reminders' AND r.deleted_at IS NULL), 0) != 1`;

/** Logged food in the last two weeks, or a fresh account: someone still using the app. */
const engaged = (today: string, zone: DayZone) =>
  sql`(EXISTS (SELECT 1 FROM food_log f2 WHERE f2.user_id = profile.user_id AND f2.date >= ${shiftDate(today, -ENGAGED_DAYS)})
    OR profile.created_at > ${dayBoundsIn(shiftDate(today, -ENGAGED_DAYS), zone).startMs})`;

type MealCandidate = {
  id: string;
  pattern: string | null;
  windowStart: string | null;
  ramadan: string | null;
  maternal: string | null;
  goal: string | null;
};

async function mealCandidates(
  db: Database,
  today: string,
  zone: DayZone,
  slot: "meal_noon" | "meal_evening",
): Promise<MealCandidate[]> {
  const local = localReminderOff(
    slot === "meal_noon"
      ? "$.value.meals.makan_siang.enabled"
      : "$.value.meals.makan_malam.enabled",
  );
  return db.all<MealCandidate>(sql`
    SELECT profile.user_id AS id, profile.fasting_pattern AS pattern, profile.fasting_window_start AS windowStart,
           profile.ramadan_mode AS ramadan, profile.maternal_mode AS maternal, profile.goal AS goal
    FROM profile
    WHERE ${reachable} AND ${profileInZone(zone)} AND ${prefOn("meal")} AND ${local} AND ${notYetSent(`meal:${slot === "meal_noon" ? "noon" : "evening"}:${today}`)}
      AND ${engaged(today, zone)}
      AND NOT EXISTS (SELECT 1 FROM food_log f WHERE f.user_id = profile.user_id AND f.date = ${today})
    LIMIT ${CANDIDATE_LIMIT}`);
}

/** Per person, the streak the evening reminder protects: the shared definition (lib/streak-store), none in Hamil / Menyusui. */
async function streaksOf(
  db: Database,
  candidates: MealCandidate[],
  today: string,
): Promise<Map<string, StreakState>> {
  const subjects = [];
  for (const c of candidates) {
    if (c.maternal && c.maternal !== "none") continue;
    // Only a Naikin BB person needs the plan: the 90% rule counts against their target.
    const plan =
      c.goal === "gain"
        ? await streakPlanOf(db, c.id, today)
        : { maternal: false, gainTargetKcal: null };
    if (!plan.maternal) subjects.push({ userId: c.id, gainTargetKcal: plan.gainTargetKcal });
  }
  return loadStreaks(db, today, subjects);
}

// --- The runner -------------------------------------------------------------------------------

export type ReminderDeps = NotifyDeps & { env: NotifyDeps["env"] & PaywallEnv };

/** Looks at every reminder window `now` is inside of, per zone group, and stores what is due. Returns how many rows were stored. */
export async function runReminders(deps: ReminderDeps): Promise<number> {
  const now = (deps.now ?? (() => new Date()))();
  let stored = 0;
  for (const zone of ZONE_GROUPS) {
    for (const slot of activeSlots(now, zone)) {
      try {
        stored += await runSlot(deps, slot, now, zone);
      } catch (error) {
        console.error(`[push] reminder ${slot.kind} failed`, error);
      }
    }
  }
  return stored;
}

async function runSlot(
  deps: ReminderDeps,
  slot: ReminderSlot,
  now: Date,
  zone: DayZone,
): Promise<number> {
  const { db } = deps;
  const today = wibDateKey(now, zone);
  const staleMs = slotStaleMs(slot);
  const base = { category: slot.category, staleMs } as const;

  switch (slot.kind) {
    case "meal_noon":
    case "meal_evening": {
      const candidates = (await mealCandidates(db, today, zone, slot.kind)).filter(
        (c) =>
          !skipMealReminder({
            kind: slot.kind as "meal_noon" | "meal_evening",
            nowMin: wibMinutes(now, zone),
            pattern: c.pattern,
            windowStart: c.windowStart,
            ramadanMode: c.ramadan,
            maternalMode: c.maternal,
            now,
            zone,
          }),
      );
      if (candidates.length === 0) return 0;
      if (slot.kind === "meal_noon") {
        return enqueueMany(
          deps,
          candidates.map((c) => c.id),
          () => ({
            ...base,
            kind: "meal_noon",
            title: { key: "notify.meal.noon.title" },
            body: { key: "notify.meal.noon.body" },
            link: { t: "makan" },
            dedupeKey: `meal:noon:${today}`,
          }),
        );
      }
      const streaks = await streaksOf(db, candidates, today);
      return enqueueMany(
        deps,
        candidates.map((c) => c.id),
        (id): PushEvent => {
          const streak = streaks.get(id);
          const risk = streak ? streakAtRisk(streak) : 0;
          return {
            ...base,
            kind: risk > 0 ? "streak" : "meal_evening",
            title:
              risk > 0
                ? { key: "notify.meal.streak.title", params: { n: risk } }
                : { key: "notify.meal.evening.title" },
            body: { key: risk > 0 ? "notify.meal.streak.body" : "notify.meal.evening.body" },
            link: { t: "makan" },
            dedupeKey: `meal:evening:${today}`,
          };
        },
      );
    }

    case "weigh": {
      const weekAgo = now.getTime() - 6 * 86_400_000;
      const rows = await db.all<{ id: string; last: string | null; created: string }>(sql`
        SELECT profile.user_id AS id,
               (SELECT MAX(w.date) FROM weight_log w WHERE w.user_id = profile.user_id) AS last,
               strftime('%Y-%m-%d', profile.created_at / 1000, 'unixepoch', ${`+${dayZoneOffsetMs(zone) / 3_600_000} hours`}) AS created
        FROM profile
        WHERE ${reachable} AND ${profileInZone(zone)} AND ${prefOn("weigh")} AND ${localReminderOff("$.value.weighIn.enabled")}
          AND ${notYetSent(`weigh:${today}`)} AND profile.maternal_mode = 'none' AND ${engaged(today, zone)}
          AND NOT EXISTS (SELECT 1 FROM push_outbox o WHERE o.user_id = profile.user_id AND o.kind = 'weigh' AND o.created_at > ${weekAgo})
        LIMIT ${CANDIDATE_LIMIT}`);
      const gaps = new Map<string, number>();
      for (const row of rows) {
        const days = weighGapDays({ lastWeighDate: row.last, createdDate: row.created, today });
        if (days !== null) gaps.set(row.id, days);
      }
      return enqueueMany(deps, [...gaps.keys()], (id) => ({
        ...base,
        kind: "weigh",
        title: { key: "notify.weigh.title", params: { n: gaps.get(id) ?? WEIGH_AFTER_DAYS } },
        body: { key: "notify.weigh.body" },
        link: { t: "berat" },
        dedupeKey: `weigh:${today}`,
      }));
    }

    case "recap": {
      const rows = await db.all<{ id: string }>(sql`
        SELECT profile.user_id AS id FROM profile
        WHERE ${reachable} AND ${profileInZone(zone)} AND ${prefOn("recap")} AND ${notYetSent(`recap:${today}`)}
          AND (SELECT COUNT(DISTINCT f.date) FROM food_log f
               WHERE f.user_id = profile.user_id AND f.date >= ${shiftDate(today, -7)} AND f.date < ${today}) >= 2
        LIMIT ${CANDIDATE_LIMIT}`);
      return enqueueMany(
        deps,
        rows.map((r) => r.id),
        () => ({
          ...base,
          kind: "recap",
          title: { key: "notify.recap.weekly.title" },
          body: { key: "notify.recap.weekly.body" },
          link: { t: "rekap" },
          dedupeKey: `recap:${today}`,
        }),
      );
    }

    case "plan": {
      const rows = await db.all<{
        id: string;
        tier: "free" | "founder";
        founderUntil: number | null;
      }>(sql`
        SELECT profile.user_id AS id, "user".tier AS tier, "user".founder_until AS founderUntil
        FROM profile JOIN "user" ON "user".id = profile.user_id
        WHERE ${reachable} AND ${profileInZone(zone)} AND ${prefOn("recap")} AND ${notYetSent(`plan:${today}`)}
          AND EXISTS (SELECT 1 FROM meal_plan mp WHERE mp.user_id = profile.user_id
                      AND mp.start_date <= ${today} AND mp.start_date >= ${shiftDate(today, -6)})
        LIMIT ${CANDIDATE_LIMIT}`);
      const config = paywallConfig(deps.env);
      const pro = rows.filter((r) =>
        premiumUnlocked(
          { tier: r.tier, founderUntil: r.founderUntil ? new Date(r.founderUntil) : null },
          config,
          now,
        ),
      );
      return enqueueMany(
        deps,
        pro.map((r) => r.id),
        () => ({
          ...base,
          kind: "plan",
          title: { key: "notify.recap.plan.title" },
          body: { key: "notify.recap.plan.body" },
          link: { t: "rencana" },
          dedupeKey: `plan:${today}`,
        }),
      );
    }

    case "calibration": {
      const tick = Math.floor((wibMinutes(now, zone) - slot.startMin) / 5);
      const rows = await db.all<{ id: string }>(sql`
        SELECT profile.user_id AS id FROM profile
        WHERE ${reachable} AND ${profileInZone(zone)} AND ${prefOn("recap")} AND profile.maternal_mode = 'none'
          AND EXISTS (SELECT 1 FROM weight_log w WHERE w.user_id = profile.user_id AND w.date >= ${shiftDate(today, -21)})
        LIMIT ${CANDIDATE_LIMIT}`);
      const mine = rows
        .filter((r) => userSlot(r.id, CALIBRATION_SLOTS) === tick % CALIBRATION_SLOTS)
        .slice(0, CALIBRATION_BATCH);
      let stored = 0;
      for (const { id } of mine) {
        const [profRows, latest, weighIns, intake, exercise, prefRows] = await db.batch(
          planQueries(db, id, today),
        );
        const prof = profRows[0];
        if (!prof) continue;
        const plan = buildPlan(
          prof,
          {
            latestWeightKg: latest[0]?.weightKg ?? null,
            weighIns,
            intake,
            exercise,
            prefs: readCalibrationPrefs(prefRows),
          },
          today,
        );
        const notice = calibrationNotice({
          calibration: plan.calibration,
          baseKcal: plan.targets.eatKcal,
          formulaBaseKcal: plan.formulaEatKcal,
          seenKcal: plan.prefs.seenKcal,
        });
        if (!notice) continue;
        stored += await enqueueMany(deps, [id], () => ({
          ...base,
          kind: "calibration",
          title: { key: "notify.recap.calibration.title" },
          body: {
            key: "notify.recap.calibration.body",
            params: { toKcal: notice.toKcal, fromKcal: notice.fromKcal },
          },
          link: { t: "beranda" },
          // Once per change of the figure: a target that moves again is news again.
          dedupeKey: `calibration:${notice.fromKcal}:${notice.toKcal}`,
        }));
      }
      return stored;
    }

    case "challenge_end": {
      const yesterday = shiftDate(today, -1);
      const rows = await db.all<{
        id: string;
        challengeId: string;
        teamId: string;
        title: string;
      }>(sql`
        SELECT m.user_id AS id, c.id AS challengeId, c.team_id AS teamId, c.title AS title
        FROM team_challenge c JOIN team_challenge_member m ON m.challenge_id = c.id
        JOIN profile ON profile.user_id = m.user_id
        WHERE c.end_date = ${yesterday} AND ${reachable} AND ${profileInZone(zone)}
          AND COALESCE((SELECT p.group_notes FROM push_prefs p WHERE p.user_id = profile.user_id), 1) = 1
        LIMIT ${CANDIDATE_LIMIT}`);
      const byId = new Map(rows.map((r) => [`${r.id}:${r.challengeId}`, r]));
      let stored = 0;
      for (const row of byId.values()) {
        stored += await enqueueMany(deps, [row.id], () => ({
          ...base,
          kind: "challenge_end",
          title: { key: "notify.group.challengeEnd.title" },
          body: { key: "notify.group.challengeEnd.body", params: { title: row.title } },
          link: { t: "challenge", groupId: row.teamId, challengeId: row.challengeId },
          dedupeKey: `challenge_end:${row.challengeId}`,
        }));
      }
      return stored;
    }
  }
}

export type { PushCategory };
