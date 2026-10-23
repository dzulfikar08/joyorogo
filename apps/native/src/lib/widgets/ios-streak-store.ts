import { ExtensionStorage } from "@bacons/apple-targets";
import { Platform } from "react-native";

import { DEFAULT_LOCALE, i18n, isLocale } from "@joyorogo/i18n";

import {
  IOS_APP_GROUP,
  IOS_STREAK_KEY,
  IOS_STREAK_LANG_KEY,
  IOS_WIDGET_KIND,
  iosStreakPayload,
} from "./ios-streak";
import type { WidgetSnapshot } from "./snapshot";

/**
 * Hands the streak to the iPhone widget: the payload and the app language go into the App Group's UserDefaults, then
 * WidgetKit is told to reload the widget. No-ops everywhere but iOS, and when the App Group is not enabled for the
 * build (`UserDefaults(suiteName:)` then gives the extension nothing to read and it shows the signed-out tile).
 *
 * The widget ages the stored stamp itself at each midnight (StreakModel.swift), so a write is only needed when the facts
 * change: the day summary loads, the person signs out, or the app language changes.
 */
const store = new ExtensionStorage(IOS_APP_GROUP);

function language(): string {
  return isLocale(i18n.language) ? i18n.language : DEFAULT_LOCALE;
}

function writeLanguage(): void {
  store.set(IOS_STREAK_LANG_KEY, language());
}

/** Mirrors `snapshot` (what push.ts just stored for the Android widgets) to the iPhone widget. */
export function mirrorStreakToIosWidget(snapshot: WidgetSnapshot): void {
  if (Platform.OS !== "ios") return;
  try {
    store.set(IOS_STREAK_KEY, JSON.stringify(iosStreakPayload(snapshot)));
    writeLanguage();
    ExtensionStorage.reloadWidget(IOS_WIDGET_KIND);
  } catch {
    // A failed write leaves the widget on what it already shows.
  }
}

// The widget speaks the app's language, so a language switch rewrites it without waiting for the next day summary.
if (Platform.OS === "ios") {
  i18n.on("languageChanged", () => {
    try {
      writeLanguage();
      ExtensionStorage.reloadWidget(IOS_WIDGET_KIND);
    } catch {
      // Same as above.
    }
  });
}
