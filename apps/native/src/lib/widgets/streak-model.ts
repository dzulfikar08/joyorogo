import { daysBetween } from "@joyorogo/api/lib/engine";
import { streakAt } from "@joyorogo/api/lib/streak";

import type { WidgetSnapshot } from "./snapshot";

/**
 * What the streak widget shows for a snapshot, as plain data: which mascot pose, which number, which copy keys. Kept
 * free of react-native-android-widget (bun tests it, and ui renders it) like layout.ts.
 *
 * The widget has one job, nudging the next log, so every state ends in the same tap: the scan camera. Joyo's mood
 * escalates the way a friend's would, by the phone's local hour while today is blank and by days of silence once the run
 * is gone:
 *
 *   done       today is logged: lit flame with the run, Joyo cheering. The 7th, 30th, 100th (and every further 100th)
 *              day of the run is a milestone; the first log after a week or more away is a heboh welcome back
 *   at_risk    the run is alive but today is blank: the run still shows, Joyo's mood follows the hour
 *              (before 12 morning, 12-17 side-eye, 17-21 panic, from 21 last chance)
 *   broken     the run ended: a cold flame with the days since the last log, Joyo's mood follows the days the run has
 *              been gone (1 teary, 2-3 mopey, 4-6 frozen, 7-13 dusty, 14+ ghost)
 *   fresh      nothing logged recently (or ever): a title instead of a number, an invitation to light the first flame
 *   off        Hamil / Menyusui or a snapshot without a streak: no flame, just the scan prompt (no streak pressure)
 *   noTarget   signed in without a plan yet
 *   signedOut  no session
 */
export type StreakWidgetKind = "done" | "at_risk" | "broken" | "fresh" | "off" | "noTarget" | "signedOut";

export type StreakPose =
  | "cheer"
  | "milestone"
  | "welcome"
  | "morning"
  | "sideeye"
  | "panic"
  | "lastchance"
  | "teary"
  | "mopey"
  | "frozen"
  | "dusty"
  | "ghost"
  | "ready"
  | "relax";

/** Every `misc` copy key the tile can show, spelled out so i18n's typed `t()` checks each against the locale files. */
export type StreakCopyKey =
  | "misc:widget.signIn"
  | "misc:widget.setTarget"
  | "misc:widget.photoCta"
  | "misc:widget.streak.title"
  | "misc:widget.streak.freshTitle"
  | "misc:widget.streak.days"
  | "misc:widget.streak.lapse"
  | "misc:widget.streak.lapseGain"
  | "misc:widget.streak.done.1"
  | "misc:widget.streak.done.2"
  | "misc:widget.streak.done.milestone"
  | "misc:widget.streak.done.welcome"
  | "misc:widget.streak.atRisk.morning"
  | "misc:widget.streak.atRisk.sideeye"
  | "misc:widget.streak.atRisk.panic"
  | "misc:widget.streak.atRisk.lastchance"
  | "misc:widget.streak.atRisk.gain"
  | "misc:widget.streak.broken.teary"
  | "misc:widget.streak.broken.mopey.1"
  | "misc:widget.streak.broken.mopey.2"
  | "misc:widget.streak.broken.mopey.3"
  | "misc:widget.streak.broken.frozen"
  | "misc:widget.streak.broken.dusty"
  | "misc:widget.streak.broken.ghost"
  | "misc:widget.streak.fresh"
  | "misc:widget.streak.freshGain"
  | "misc:widget.streak.off"
  | "misc:widget.streak.signInLine";

export interface StreakWidgetModel {
  kind: StreakWidgetKind;
  pose: StreakPose;
  /** The big number beside the flame; null shows no flame, and `titleKey` takes its place. */
  count: number | null;
  /** Big text instead of the number, for the states that have none. */
  titleKey: StreakCopyKey | null;
  /** Lit orange flame (a log counts today or the run is alive) or a cold grey one. */
  lit: boolean;
  /** The unit under the number ("hari beruntun"; for a broken streak "hari tanpa catat"). */
  labelKey: StreakCopyKey | null;
  lineKey: StreakCopyKey;
  /** A Naikin BB plan counts days at the eating target, not days with a log: the copy says so. */
  gain: boolean;
}

/**
 * Pixel size of each pose's trimmed art in assets/widget/mascot, for the tile's aspect ratio (a test reads the files).
 * The art of the mood poses is drawn after this table, so their sizes are placeholders until the files land.
 */
export const MASCOT_ART: Record<StreakPose, { width: number; height: number }> = {
  cheer: { width: 192, height: 186 },
  ready: { width: 185, height: 192 },
  relax: { width: 187, height: 192 },
  milestone: { width: 168, height: 192 },
  welcome: { width: 192, height: 181 },
  morning: { width: 186, height: 192 },
  sideeye: { width: 171, height: 192 },
  panic: { width: 171, height: 192 },
  lastchance: { width: 156, height: 192 },
  teary: { width: 178, height: 192 },
  mopey: { width: 192, height: 185 },
  frozen: { width: 183, height: 192 },
  dusty: { width: 192, height: 140 },
  ghost: { width: 134, height: 192 },
};

/** Local hours at which an unlogged day gets more worried (12:00, 17:00, 21:00); the widget must repaint at each. */
export const MOOD_HOURS = [12, 17, 21] as const;

/** Run lengths that earn Joyo's party pose on the day they are reached: 7, 30, 100 and every further 100. */
export function isMilestone(days: number): boolean {
  return days === 7 || days === 30 || (days >= 100 && days % 100 === 0);
}

/** A first log after at least this many days away is a comeback, not an ordinary day one. */
export const COMEBACK_AFTER_DAYS = 7;

/** The nudge lines of each state; the one shown changes with the calendar day, not at random. */
const DONE_LINES = ["misc:widget.streak.done.1", "misc:widget.streak.done.2"] as const;
const MOPEY_LINES = [
  "misc:widget.streak.broken.mopey.1",
  "misc:widget.streak.broken.mopey.2",
  "misc:widget.streak.broken.mopey.3",
] as const;

/** The line for `date`: the same all day, a different one tomorrow. */
function rotate<T extends readonly StreakCopyKey[]>(lines: T, date: string): T[number] {
  return lines[daysBetween("1970-01-01", date) % lines.length]!;
}

/** Joyo's worry while the run is alive and today is blank, by the phone's local hour. */
function atRiskMood(hour: number): { pose: StreakPose; lineKey: StreakCopyKey } {
  if (hour < MOOD_HOURS[0]) return { pose: "morning", lineKey: "misc:widget.streak.atRisk.morning" };
  if (hour < MOOD_HOURS[1]) return { pose: "sideeye", lineKey: "misc:widget.streak.atRisk.sideeye" };
  if (hour < MOOD_HOURS[2]) return { pose: "panic", lineKey: "misc:widget.streak.atRisk.panic" };
  return { pose: "lastchance", lineKey: "misc:widget.streak.atRisk.lastchance" };
}

/**
 * Joyo's mood once the run is gone, by `lapseDays` (the count the tile shows: 2 is the first broken day, last log
 * the day before yesterday). He counts the days the run has been gone, so `lapseDays - 1`: 1 teary, 2-3 mopey,
 * 4-6 frozen, 7-13 dusty, 14 and more ghost.
 */
function brokenMood(lapseDays: number, today: string): { pose: StreakPose; lineKey: StreakCopyKey } {
  const gone = lapseDays - 1;
  if (gone <= 1) return { pose: "teary", lineKey: "misc:widget.streak.broken.teary" };
  if (gone <= 3) return { pose: "mopey", lineKey: rotate(MOPEY_LINES, today) };
  if (gone <= 6) return { pose: "frozen", lineKey: "misc:widget.streak.broken.frozen" };
  if (gone <= 13) return { pose: "dusty", lineKey: "misc:widget.streak.broken.dusty" };
  return { pose: "ghost", lineKey: "misc:widget.streak.broken.ghost" };
}

/**
 * The model for `snapshot` on the phone's date `today` ('YYYY-MM-DD') and local `hour` (0-23). The snapshot's stamp is
 * aged to that date, so a widget nobody has refreshed since last night already reads "at risk" this morning.
 */
export function streakWidgetModel(snapshot: WidgetSnapshot, today: string, hour: number): StreakWidgetModel {
  const base = { count: null, titleKey: null, lit: false, labelKey: null, gain: false } as const;
  if (!snapshot.signedIn) {
    return { ...base, kind: "signedOut", pose: "ready", titleKey: "misc:widget.signIn", lineKey: "misc:widget.streak.signInLine" };
  }
  const day = snapshot.day;
  if (!day) {
    return { ...base, kind: "noTarget", pose: "ready", titleKey: "misc:widget.streak.title", lineKey: "misc:widget.setTarget" };
  }
  if (day.maternal || !day.streak) {
    return { ...base, kind: "off", pose: "relax", titleKey: "misc:widget.photoCta", lineKey: "misc:widget.streak.off" };
  }

  const gain = day.gain === true;
  const state = streakAt(day.streak, today);
  switch (state.status) {
    case "done": {
      const previous = day.streak.previousLoggedDate;
      const comeback =
        state.days === 1 && typeof previous === "string" && daysBetween(previous, today) >= COMEBACK_AFTER_DAYS;
      const [pose, lineKey] = comeback
        ? (["welcome", "misc:widget.streak.done.welcome"] as const)
        : isMilestone(state.days)
          ? (["milestone", "misc:widget.streak.done.milestone"] as const)
          : (["cheer", rotate(DONE_LINES, today)] as const);
      return {
        kind: "done",
        pose,
        count: state.days,
        titleKey: null,
        lit: true,
        labelKey: "misc:widget.streak.days",
        lineKey,
        gain,
      };
    }
    case "at_risk": {
      const mood = atRiskMood(hour);
      return {
        kind: "at_risk",
        pose: mood.pose,
        count: state.days,
        titleKey: null,
        lit: true,
        labelKey: "misc:widget.streak.days",
        lineKey: gain ? "misc:widget.streak.atRisk.gain" : mood.lineKey,
        gain,
      };
    }
    case "broken": {
      const mood = brokenMood(state.lapseDays, today);
      return {
        kind: "broken",
        pose: mood.pose,
        count: state.lapseDays,
        titleKey: null,
        lit: false,
        labelKey: gain ? "misc:widget.streak.lapseGain" : "misc:widget.streak.lapse",
        lineKey: mood.lineKey,
        gain,
      };
    }
    case "none":
      return {
        kind: "fresh",
        pose: "ready",
        count: null,
        titleKey: "misc:widget.streak.freshTitle",
        lit: false,
        labelKey: null,
        lineKey: gain ? "misc:widget.streak.freshGain" : "misc:widget.streak.fresh",
        gain,
      };
  }
}
