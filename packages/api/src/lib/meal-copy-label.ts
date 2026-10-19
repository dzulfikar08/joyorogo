import { fmtDateShort, getActiveLocale, getT, relativeDayLabel } from "@joyorogo/i18n";
import type { Locale } from "@joyorogo/i18n";

import { mealLabel } from "./engine";
import type { Meal } from "./engine";

/** Day part of a chip: "kemarin" within two days, else "10 Okt". */
function chipDay(date: string, today: string, locale: Locale): string {
  const label = relativeDayLabel(date, today, locale);
  // relativeDayLabel gives a long "Sabtu, 10 Okt" past yesterday; chips stay short.
  return label.includes(",") ? fmtDateShort(date, locale) : label.toLowerCase();
}

/** Chip / suggestion text for a logged meal: "Sama kayak sarapan tadi", "Makan siang kemarin", "Makan malam 10 Okt". */
export function copyChipLabel(
  slot: { date: string; meal: Meal },
  today: string,
  locale: Locale = getActiveLocale(),
): string {
  const t = getT(locale, "makan");
  const meal = mealLabel(slot.meal, locale);
  return slot.date === today
    ? t("story.copy.chipToday", { meal: meal.toLowerCase() })
    : t("story.copy.chipDay", { meal, day: chipDay(slot.date, today, locale) });
}

/** What a reference asked for, for the "nothing logged" line: "makan siang kemarin"; null when it named nothing. */
export function copyWantedLabel(
  wanted: { date: string | null; meal: Meal | null },
  today: string,
  locale: Locale = getActiveLocale(),
): string | null {
  const parts = [
    wanted.meal ? mealLabel(wanted.meal, locale).toLowerCase() : null,
    wanted.date ? chipDay(wanted.date, today, locale) : null,
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(" ") : null;
}
