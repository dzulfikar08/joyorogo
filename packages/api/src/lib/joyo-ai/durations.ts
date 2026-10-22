// Ported from JoyoFit (watch-fit) src/features/ai/durations.ts, adapted for JoyoRogo.
/**
 * Durations in tool results are minutes, and models repeat them as "684 minutes". People read "11 jam 24 menit".
 * The system prompt asks for hours and minutes; this is the net under it: a number of 90 or more followed by "minutes" / "menit" / "minit"
 * (or "min"/"mins") becomes "Xh Ym" / "X jam Y menit" / "X jam Y minit". Shorter ones stay as written ("45 minutes" reads fine). Pure, total.
 */
import type { Locale } from '@joyorogo/i18n';

const RE = /(?<![\d.,])(\d{2,4})(?:[\s\u00a0-])?(minutes|minute|mins|min|menit|minit)\b/gi;

export const MIN_REWRITE = 90;

export function hoursAndMinutes(total: number, locale: Locale): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (locale === 'id') return m === 0 ? `${h} jam` : `${h} jam ${m} menit`;
  if (locale === 'ms') return m === 0 ? `${h} jam` : `${h} jam ${m} minit`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export function formatDurations(text: string, locale: Locale): string {
  return text.replace(RE, (whole, digits: string) => {
    const total = Number(digits);
    return total >= MIN_REWRITE ? hoursAndMinutes(total, locale) : whole;
  });
}
