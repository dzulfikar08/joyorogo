// Number and date formatting is shared with native and the server: see
// @joyorogo/i18n (docs/i18n.md). Re-exported here so screens keep one import.
import { dayOfMs, fmtNumber } from "@joyorogo/i18n";

export {
  fmtClock,
  fmtDateLong,
  fmtDateMedium,
  fmtDateShort,
  fmtGramsLabel,
  fmtDecimal,
  fmtIdr,
  fmtInt,
  fmtKcalLabel,
  fmtMegabytes,
  fmtNumber,
  fmtKg,
  fmtRatio,
  timeAgo,
} from "@joyorogo/i18n";

/** Activity factor with the language's decimal separator, up to three decimals: "1,375" (id) / "1.375" (en). */
export function fmtFactor(factor: number): string {
  return fmtNumber(factor, 3);
}

/** The user's date N days from now as 'YYYY-MM-DD' (their day zone, no DST). */
export function jakartaDatePlusDays(days: number): string {
  return dayOfMs(Date.now() + days * 86_400_000);
}

/** Lenient numeric field parser: trims, accepts decimal comma, null when invalid. */
export function parseNum(value: string): number | null {
  const normalized = value.trim().replace(",", ".");
  if (normalized === "") return null;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}
