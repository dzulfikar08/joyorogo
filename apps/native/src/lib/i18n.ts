import { i18n, initI18n, isLocale, resolveLocale, setActiveLocale } from "@joyorogo/i18n";
import type { Locale } from "@joyorogo/i18n";
import * as SecureStore from "expo-secure-store";
import { initReactI18next } from "react-i18next";

// Language resolution, first match wins:
//   1. the account's saved choice (profile.locale), applied by <LocaleSync/> once signed in
//   2. the choice stored on this device (works before login), loaded by loadStoredLocale()
//   3. the device language
//   4. `id`
// Only explicit choices are stored, so a changed device language still applies
// to people who never picked one.

const KEY = "joyorogo.locale";

/** Device languages, most preferred first. Hermes exposes the OS locale through Intl. */
function deviceLanguages(): string[] {
  try {
    return [new Intl.DateTimeFormat().resolvedOptions().locale];
  } catch {
    return [];
  }
}

// Synchronous first pass from the device language so t() works on the very
// first render; the stored choice replaces it before the app mounts.
const initial = resolveLocale({ device: deviceLanguages() });
initI18n({ locale: initial, plugins: [initReactI18next] });
setActiveLocale(initial);

/** The choice stored on this device, if the user ever picked one. */
export async function loadStoredLocale(): Promise<Locale | null> {
  try {
    const value = await SecureStore.getItemAsync(KEY);
    return isLocale(value) ? value : null;
  } catch {
    return null;
  }
}

/** Switches the UI language now. `remember` stores it as the device choice. */
export async function setLocale(locale: Locale, { remember = true } = {}): Promise<void> {
  setActiveLocale(locale);
  await i18n.changeLanguage(locale);
  if (remember) {
    try {
      await SecureStore.setItemAsync(KEY, locale);
    } catch {
      // Best-effort; the account copy still persists it.
    }
  }
}
