import {
  DEFAULT_DAY_ZONE,
  DEFAULT_LOCALE,
  deviceDayZone,
  i18n,
  initI18n,
  isLocale,
  resolveLocale,
  setActiveDayZone,
  setActiveLocale,
} from "@joyorogo/i18n";
import type { Locale } from "@joyorogo/i18n";
import { initReactI18next } from "react-i18next";

// Language resolution, first match wins: the account's saved choice (profile.locale, applied by <LocaleSync/> once
// signed in), the choice stored on this device, the browser's languages, `id`. Only explicit choices are stored.

const STORAGE_KEY = "jfit-locale";

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

const initial = resolveLocale({ stored: storedChoice(), device: navigator.languages });
initI18n({ locale: initial, plugins: [initReactI18next] });
apply(initial);
// Days are cut in the device zone from the first render; <LocaleSync/> refines it once the profile loads.
setActiveDayZone(deviceDayZone() ?? DEFAULT_DAY_ZONE);

/** Switches the UI language now. `remember` stores it as the device choice. */
export async function setLocale(locale: Locale, { remember = true } = {}): Promise<void> {
  if (remember) {
    try {
      localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      // Private mode: the account copy still persists it.
    }
  }
  apply(locale);
  await i18n.changeLanguage(locale);
}

export { DEFAULT_LOCALE };
