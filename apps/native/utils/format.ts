// FR-10: kcal integer, kg one decimal — always Indonesian-friendly.
const idNumber = new Intl.NumberFormat("id-ID");

export function fmtKcal(n: number): string {
  return idNumber.format(Math.round(n));
}

export function fmtKg(n: number): string {
  return new Intl.NumberFormat("id-ID", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(n);
}

export function fmtDateId(date: string): string {
  return new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}

/** Reads a numeric TextInput value: "68,5" and "68.5" both work. */
export function parseNum(text: string): number | null {
  const trimmed = text.trim().replace(",", ".");
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

export function errorMessage(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  return "Terjadi kesalahan. Coba lagi.";
}

/** ±0.05 kg/week or flatter counts as stable, matching the web recap. */
const FLAT_WEEKLY_RATE_KG = 0.05;

/** "Turun 0,6 kg/minggu" / "Naik …" / "Berat stabil" for a weekly trend rate. */
export function weeklyRateLabel(rateKg: number): string {
  if (Math.abs(rateKg) <= FLAT_WEEKLY_RATE_KG) return "Berat stabil";
  return `${rateKg < 0 ? "Turun" : "Naik"} ${fmtKg(Math.abs(rateKg))} kg/minggu`;
}
