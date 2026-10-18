import { fmtClock, fmtDateMedium, fmtMegabytes, fmtNumber } from "@/lib/format";

const MB = 1024 * 1024;

/** Stored size as the user reads it: "31 KB" under a megabyte, "2,4 MB" above. */
export function fmtBytes(bytes: number): string {
  if (bytes >= MB) return fmtMegabytes(bytes);
  const kb = bytes / 1024;
  return `${fmtNumber(Math.max(1, kb), kb < 10 ? 1 : 0)} KB`;
}

/** "14 Sep 2026 · 06.12", both in WIB. `startSec` is unix seconds. */
export function fmtStart(startSec: number): string {
  const at = new Date(startSec * 1000);
  const wibDay = new Date(at.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);
  return `${fmtDateMedium(wibDay)} · ${fmtClock(at)}`;
}
