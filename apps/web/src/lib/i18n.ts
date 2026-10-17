import {
  DEFAULT_LOCALE,
  i18n,
  initI18n,
  isLocale,
  resolveLocale,
  setActiveLocale,
} from "@joyorogo/i18n";
import type { Locale } from "@joyorogo/i18n";
import { initReactI18next } from "react-i18next";

// Language resolution, first match wins:
//   1. the account's saved choice (profile.locale) — applied by <LocaleSync/> once signed in
//   2. the choice stored on this device (works before login) — read here
//   3. the browser's languages
//   4. `id`
// Only explicit choices are stored, so a changed browser language still applies
// to people who never picked one.

const STORAGE_KEY = "jrg-locale";

function storedChoice(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function apply(locale: Locale): void {
  setActiveLocale(locale);
  document.documentElement.lang = locale;
}

/** Device choice, if the user ever picked one on this browser. */
export function storedLocale(): Locale | null {
  const stored = storedChoice();
  return isLocale(stored) ? stored : null;
}

const initial = resolveLocale({
  stored: storedChoice(),
  device: typeof navigator === "undefined" ? [] : navigator.languages,
});
initI18n({ locale: initial, plugins: [initReactI18next] });
apply(initial);

/** Switches the UI language now. `remember` stores it as the device choice. */
export async function setLocale(locale: Locale, { remember = true } = {}): Promise<void> {
  if (remember) {
    try {
      localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      // Best-effort (private mode); the account copy still persists it.
    }
  }
  apply(locale);
  await i18n.changeLanguage(locale);
}

export { DEFAULT_LOCALE };
