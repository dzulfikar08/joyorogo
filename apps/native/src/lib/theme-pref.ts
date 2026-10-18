import type { RogoTheme } from "@joyorogo/api/lib/rogo-prefs";
import { notePrefChanged } from "@joyorogo/api/lib/rogo-prefs-sync";
import * as SecureStore from "expo-secure-store";
import { UnistylesRuntime } from "react-native-unistyles";

const KEY = "joyorogo.theme";

export async function loadThemePref(): Promise<RogoTheme | undefined> {
  try {
    const value = await SecureStore.getItemAsync(KEY);
    if (value === "light" || value === "dark" || value === "system") return value;
    return undefined;
  } catch {
    return undefined;
  }
}

/** Stores the choice without telling the account (used when the choice came from it); undefined = never chosen. */
export async function writeThemePref(theme: RogoTheme | undefined): Promise<void> {
  try {
    if (theme === undefined) await SecureStore.deleteItemAsync(KEY);
    else await SecureStore.setItemAsync(KEY, theme);
  } catch {
    // Persistence is best-effort; the session override still applies.
  }
}

export async function saveThemePref(theme: RogoTheme): Promise<void> {
  await writeThemePref(theme);
  await notePrefChanged("theme", theme);
}

/** Puts the stored choice on screen. "system" (or nothing stored) hands control back to the OS scheme. */
export function applyThemePref(pref: RogoTheme | undefined): void {
  if (pref === "light" || pref === "dark") {
    // setTheme throws while adaptiveThemes is enabled.
    UnistylesRuntime.setAdaptiveThemes(false);
    UnistylesRuntime.setTheme(pref);
  } else {
    UnistylesRuntime.setAdaptiveThemes(true);
  }
}
