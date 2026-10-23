import { DEFAULT_DAY_ZONE, isDayZone } from "@joyorogo/i18n";
import type { DayZone } from "@joyorogo/i18n";
import type { StreakStamp } from "@joyorogo/api/lib/streak";

// Type-only: snapshot.ts reads files through expo, which bun cannot load.
import type { WidgetSnapshot } from "./snapshot";
import type { StreakCopyKey } from "./streak-model";

/**
 * The iPhone side of the Streak Catat widget (targets/widget, a WidgetKit extension). Pure data, no native imports, so
 * bun tests it; ios-streak-store.ts writes it into the App Group.
 *
 * Android renders the model in JS (streak-ui.tsx). WidgetKit cannot run JS: it draws from what the app left in the shared
 * UserDefaults and ages it itself (targets/widget/StreakModel.swift is a port of streak-model.ts, checked against it by
 * widget-ios-check). So the app stores the same facts the model reads, no rendered copy:
 *
 *   `streak`       JSON, IosStreakPayload: signed in or not, the day zone, the streak stamp, Hamil / Menyusui, Naikin BB
 *   `streak.lang`  "id" | "en" | "ms": the app's language; the widget picks its copy from streak-copy.json with it
 *
 * Widget copy is the Android copy: targets/widget/streak-copy.json is generated from packages/i18n/.../misc.json (the same
 * `misc:widget...` keys, see ios-streak.test.ts), so a sentence is edited in one place.
 */

/** Same string as ios.entitlements in app.json and streakAppGroup in targets/widget/StreakStore.swift (a test checks both). */
export const IOS_APP_GROUP = "group.com.joyodigitama.joyorogo";

/** The WidgetKit `kind` of the widget; ExtensionStorage.reloadWidget(kind) reloads exactly it. Same as streakWidgetKind in Swift. */
export const IOS_WIDGET_KIND = "StreakCatat";

export const IOS_STREAK_KEY = "streak";
export const IOS_STREAK_LANG_KEY = "streak.lang";

/** Bump when the shape changes in a way an older extension cannot read. */
export const IOS_STREAK_VERSION = 1;

export interface IosStreakPayload {
  v: typeof IOS_STREAK_VERSION;
  signedIn: boolean;
  /** Null: signed in without a plan yet (and every signed-out snapshot). */
  day: {
    zone: DayZone;
    /** Null in Hamil / Menyusui and when the snapshot has no streak. */
    streak: StreakStamp | null;
    maternal: boolean;
    gain: boolean;
  } | null;
}

/** What the widget needs of a snapshot: the inputs of streakWidgetModel and nothing else (no kcal, no inbox). */
export function iosStreakPayload(snapshot: WidgetSnapshot): IosStreakPayload {
  const day = snapshot.signedIn ? snapshot.day : null;
  return {
    v: IOS_STREAK_VERSION,
    signedIn: snapshot.signedIn,
    day: day
      ? {
          zone: isDayZone(day.zone) ? day.zone : DEFAULT_DAY_ZONE,
          streak: day.streak ? { days: day.streak.days, lastLoggedDate: day.streak.lastLoggedDate } : null,
          maternal: day.maternal === true,
          gain: day.gain === true,
        }
      : null,
  };
}

/**
 * Every copy key the widget can show, in streak-copy.json: the model's own (StreakCopyKey, so a key added there fails here
 * until it is listed) plus the gallery description, which only the iPhone widget picker shows.
 */
export const IOS_STREAK_COPY_KEYS = {
  "misc:widget.signIn": true,
  "misc:widget.setTarget": true,
  "misc:widget.photoCta": true,
  "misc:widget.streak.title": true,
  "misc:widget.streak.freshTitle": true,
  "misc:widget.streak.days": true,
  "misc:widget.streak.lapse": true,
  "misc:widget.streak.lapseGain": true,
  "misc:widget.streak.done.1": true,
  "misc:widget.streak.done.2": true,
  "misc:widget.streak.atRisk.1": true,
  "misc:widget.streak.atRisk.2": true,
  "misc:widget.streak.atRisk.gain": true,
  "misc:widget.streak.broken.1": true,
  "misc:widget.streak.broken.2": true,
  "misc:widget.streak.broken.3": true,
  "misc:widget.streak.asleep": true,
  "misc:widget.streak.fresh": true,
  "misc:widget.streak.freshGain": true,
  "misc:widget.streak.off": true,
  "misc:widget.streak.signInLine": true,
  "misc:widget.streak.gallery": true,
} as const satisfies Record<StreakCopyKey | "misc:widget.streak.gallery", true>;
