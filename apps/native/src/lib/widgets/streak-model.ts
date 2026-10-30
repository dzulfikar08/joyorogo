import { daysBetween } from "@joyorogo/api/lib/engine";
import { streakAt } from "@joyorogo/api/lib/streak";

import type { WidgetSnapshot } from "./snapshot";

/**
 * What the streak widget shows for a snapshot, as plain data: which mascot pose, which number, which copy keys. Kept
 * free of react-native-android-widget (bun tests it, and ui renders it) like layout.ts.
 *
 * The widget has one job, nudging the next log, so every state ends in the same tap: the scan camera.
 *
 *   done       today is logged: lit flame with the run, Joyo cheering
 *   at_risk    the run is alive but today is blank: the run still shows ("Jaga apinya"), Joyo wide-eyed
 *   broken     the run ended: a cold flame with the days since the last log, Joyo giving the look (asleep after a week)
 *   fresh      nothing logged recently (or ever): a title instead of a number, an invitation to light the first flame
 *   off        Hamil / Menyusui or a snapshot without a streak: no flame, just the scan prompt (no streak pressure)
 *   noTarget   signed in without a plan yet
 *   signedOut  no session
 */
export type StreakWidgetKind = "done" | "at_risk" | "broken" | "fresh" | "off" | "noTarget" | "signedOut";

export type StreakPose = "cheer" | "surprised" | "determined" | "sleepy" | "ready" | "relax";

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
  | "misc:widget.streak.atRisk.1"
  | "misc:widget.streak.atRisk.2"
  | "misc:widget.streak.atRisk.gain"
  | "misc:widget.streak.broken.1"
  | "misc:widget.streak.broken.2"
  | "misc:widget.streak.broken.3"
  | "misc:widget.streak.asleep"
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

/** Pixel size of each pose's trimmed art in assets/widget/mascot, for the tile's aspect ratio (a test reads the files). */
export const MASCOT_ART: Record<StreakPose, { width: number; height: number }> = {
  cheer: { width: 192, height: 186 },
  surprised: { width: 178, height: 192 },
  determined: { width: 180, height: 192 },
  sleepy: { width: 192, height: 142 },
  ready: { width: 185, height: 192 },
  relax: { width: 187, height: 192 },
};

/** A week without a log: Joyo has dozed off instead of giving the look. */
export const SLEEPY_AFTER_DAYS = 7;

/** The nudge lines of each state; the one shown changes with the calendar day, not at random. */
const DONE_LINES = ["misc:widget.streak.done.1", "misc:widget.streak.done.2"] as const;
const AT_RISK_LINES = ["misc:widget.streak.atRisk.1", "misc:widget.streak.atRisk.2"] as const;
const BROKEN_LINES = [
  "misc:widget.streak.broken.1",
  "misc:widget.streak.broken.2",
  "misc:widget.streak.broken.3",
] as const;

/** The line for `date`: the same all day, a different one tomorrow. */
function rotate<T extends readonly StreakCopyKey[]>(lines: T, date: string): T[number] {
  return lines[daysBetween("1970-01-01", date) % lines.length]!;
}

/**
 * The model for `snapshot` on the phone's date `today` ('YYYY-MM-DD'). The snapshot's stamp is aged to that date, so
 * a widget nobody has refreshed since last night already reads "at risk" this morning.
 */
export function streakWidgetModel(snapshot: WidgetSnapshot, today: string): StreakWidgetModel {
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
    case "done":
      return {
        kind: "done",
        pose: "cheer",
        count: state.days,
        titleKey: null,
        lit: true,
        labelKey: "misc:widget.streak.days",
        lineKey: rotate(DONE_LINES, today),
        gain,
      };
    case "at_risk":
      return {
        kind: "at_risk",
        pose: "surprised",
        count: state.days,
        titleKey: null,
        lit: true,
        labelKey: "misc:widget.streak.days",
        lineKey: gain ? "misc:widget.streak.atRisk.gain" : rotate(AT_RISK_LINES, today),
        gain,
      };
    case "broken":
      return {
        kind: "broken",
        pose: state.lapseDays >= SLEEPY_AFTER_DAYS ? "sleepy" : "determined",
        count: state.lapseDays,
        titleKey: null,
        lit: false,
        labelKey: gain ? "misc:widget.streak.lapseGain" : "misc:widget.streak.lapse",
        lineKey: state.lapseDays >= SLEEPY_AFTER_DAYS ? "misc:widget.streak.asleep" : rotate(BROKEN_LINES, today),
        gain,
      };
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
