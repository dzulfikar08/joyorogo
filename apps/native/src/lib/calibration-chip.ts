import type { CalibrationInfo } from "@joyorogo/api/lib/calibration";

/** What the Beranda calibration chip says: null hides it. */
export type CalibrationChip =
  /** The weight trend has nothing to start from: the clock starts with the first weigh-in of the window. */
  | { kind: "weigh" }
  /** The earliest the data can be good enough, counting one log and one weigh-in a day from now on. */
  | { kind: "days"; days: number }
  /** The data is there, but the weekly measurement starts on `date` (a Monday). */
  | { kind: "waiting"; date: string };

/**
 * The chip while the automatic calibration is still collecting (or holding for Monday). The days are a lower bound:
 * the longest of what each gate still needs (logged days, weigh-ins, the weigh-in span), each at best one a day. The
 * gates are the server's own (`CalibrationInfo`), so the chip can never disagree with the progress bars in Profil.
 */
export function calibrationChip(info: CalibrationInfo | null | undefined): CalibrationChip | null {
  if (!info) return null;
  if (info.status === "waiting") return { kind: "waiting", date: info.nextDate };
  if (info.status !== "collecting") return null;
  if (info.weighIns === 0) return { kind: "weigh" };
  const days = Math.max(
    info.loggedDaysNeeded - info.loggedDays,
    info.weighInsNeeded - info.weighIns,
    info.spanDaysNeeded - info.spanDays,
    1,
  );
  return { kind: "days", days };
}
