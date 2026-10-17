// Number and date formatting is shared with native and the server: see
// @joyorogo/i18n (docs/i18n.md). Re-exported here so screens keep one import.
export {
  fmtDateLong,
  fmtDateMedium,
  fmtDateShort,
  fmtGramsLabel,
  fmtIdr,
  fmtInt,
  fmtKcalLabel,
  fmtKg,
  fmtRatio,
  timeAgo,
} from "@joyorogo/i18n";

/** WIB date N days from now as 'YYYY-MM-DD' (fixed UTC+7, no DST). */
export function jakartaDatePlusDays(days: number): string {
  return new Date(Date.now() + 7 * 3_600_000 + days * 86_400_000).toISOString().slice(0, 10);
}

/** Lenient numeric field parser: trims, accepts decimal comma, null when invalid. */
export function parseNum(value: string): number | null {
  const normalized = value.trim().replace(",", ".");
  if (normalized === "") return null;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}
