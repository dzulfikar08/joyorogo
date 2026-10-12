const numberFormat = new Intl.NumberFormat("id-ID");

/** Integer with Indonesian separators (FR-10) — kcal and grams display. */
export function fmtInt(n: number): string {
  return numberFormat.format(Math.round(n));
}

/** kg with exactly one decimal and Indonesian comma (FR-10). */
export function fmtKg(n: number): string {
  return (Math.round(n * 10) / 10).toLocaleString("id-ID", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

/** 'YYYY-MM-DD' (WIB calendar day) -> "Minggu, 14 September 2026". */
export function fmtDateIndo(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("id-ID", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

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
