// Number, date and duration text for the screens. Locale-aware through @joyorogo/i18n (the language the app renders in).

import { formatPace } from "@joyorogo/api/lib/workout-analysis";
import { fmtClock, fmtDateMedium, fmtDateShort, fmtDecimal, fmtInt, i18n } from "@joyorogo/i18n";
import { paceMode } from "@joyorogo/workout-view/analysis-math";
import type { SportKind } from "@joyorogo/api/lib/workout-analysis";

export { fmtClock, fmtDateMedium, fmtDateShort, fmtDecimal, fmtInt };

const WIB_OFFSET_MS = 7 * 3_600_000;

/** WIB calendar day of a unix-seconds instant, 'YYYY-MM-DD'. */
export function wibDay(unixSec: number): string {
  return new Date(unixSec * 1000 + WIB_OFFSET_MS).toISOString().slice(0, 10);
}

/** "14 Sep 2026 · 06.12", both in WIB. */
export function fmtStart(unixSec: number): string {
  return `${fmtDateMedium(wibDay(unixSec))} · ${fmtClock(new Date(unixSec * 1000))}`;
}

/** "5,02 km" (one decimal from 100 km up, none for a bare 0). */
export function fmtKm(meters: number | null | undefined): string {
  if (meters === null || meters === undefined) return "–";
  const km = meters / 1000;
  return `${fmtDecimal(km, km >= 100 ? 1 : 2)} km`;
}

/** "1 j 05 m" / "42 m" from seconds. */
export function fmtHm(totalSec: number): string {
  const total = Math.max(0, Math.round(totalSec / 60));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h > 0
    ? i18n.t("fitWeb:unit.hm", { h, m: String(m).padStart(2, "0") })
    : i18n.t("fitWeb:unit.min", { m });
}

/** "7 j 48 m" from hours. */
export function fmtSleep(hours: number | null | undefined): string {
  return hours === null || hours === undefined ? "–" : fmtHm(hours * 3600);
}

/** Integer with the unit, "–" when the value is missing: fmtWith(152, "bpm") is "152 bpm". */
export function fmtWith(value: number | null | undefined, unit: string, decimals = 0): string {
  return value === null || value === undefined ? "–" : `${fmtDecimal(value, decimals)} ${unit}`;
}

/** A change as the person reads it: "+12%" / "-3%" (or "+4" when it has no percent). */
export function fmtSigned(value: number, decimals = 0): string {
  const rounded = Number(value.toFixed(decimals));
  return `${rounded > 0 ? "+" : rounded < 0 ? "−" : ""}${fmtDecimal(Math.abs(rounded), decimals)}`;
}

/** `5:32` for runs and walks, km/h in the language's decimal separator for rides; "–" without a usable pace. */
export function fmtPaceOrSpeed(kind: SportKind, paceSecKm: number | null | undefined): string {
  if (paceSecKm === null || paceSecKm === undefined || !(paceSecKm > 0)) return "–";
  return paceMode(kind) === "speed" ? fmtDecimal(3600 / paceSecKm, 1) : formatPace(paceSecKm);
}

/** "13 B", "48 KB", "2,4 MB": a stored or chosen file's size as a person reads it. */
export function fmtFileSize(bytes: number): string {
  if (bytes < 1024) return `${fmtInt(bytes)} B`;
  if (bytes < 1024 * 1024) return `${fmtDecimal(bytes / 1024, bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${fmtDecimal(bytes / 1024 / 1024, 1)} MB`;
}
