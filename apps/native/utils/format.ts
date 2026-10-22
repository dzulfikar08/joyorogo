import { fmtKg, i18n } from "@joyorogo/i18n";

// Number and date formatting is shared with web and the server: see
// @joyorogo/i18n (docs/i18n.md). Re-exported here so screens keep one import.
export {
  fmtDecimal,
  fmtDateLong,
  fmtDateMedium,
  fmtDateShort,
  fmtGramsLabel,
  fmtIdr,
  fmtInt,
  fmtKcalLabel,
  kcalUnit,
  fmtKg,
  fmtMegabytes,
  fmtRatio,
  timeAgo,
} from "@joyorogo/i18n";

/** Reads a numeric TextInput value: "68,5" and "68.5" both work. */
export function parseNum(text: string): number | null {
  const trimmed = text.trim().replace(",", ".");
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

export function errorMessage(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  return i18n.t("common:state.genericError");
}

/** ±0.05 kg/week or flatter counts as stable, matching the web recap. */
const FLAT_WEEKLY_RATE_KG = 0.05;

/** "Turun 0,6 kg/minggu" / "Naik …" / "Berat stabil" for a weekly trend rate. */
export function weeklyRateLabel(rateKg: number): string {
  if (Math.abs(rateKg) <= FLAT_WEEKLY_RATE_KG) return i18n.t("berat:trend.stable");
  return i18n.t(rateKg < 0 ? "berat:trend.down" : "berat:trend.up", {
    kg: fmtKg(Math.abs(rateKg)),
  });
}
