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

/** "baru saja", "5 menit lalu", "2 jam lalu", "3 hari lalu" — for feeds. */
export function timeAgo(at: Date | string): string {
  const seconds = Math.max(0, (Date.now() - new Date(at).getTime()) / 1000);
  if (seconds < 60) return "baru saja";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} menit lalu`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} jam lalu`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} hari lalu`;
  return new Date(at).toLocaleDateString("id-ID", { day: "numeric", month: "short" });
}
