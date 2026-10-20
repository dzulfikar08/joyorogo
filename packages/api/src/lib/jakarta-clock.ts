const HOUR_MS = 60 * 60 * 1000;
const WIB_OFFSET_MS = 7 * HOUR_MS;

/**
 * The clock a screen renders from, advanced only when the WIB hour changes. WIB has no DST, so an hour boundary is
 * always aligned to a UTC hour and WIB midnight is one of them: a day rollover, and the greeting changing from pagi to
 * siang, both show up as a new hour. Returning `prev` (same identity) lets a polling tick skip the re-render.
 */
export function advanceClock(prev: Date, now: Date): Date {
  const hour = (d: Date) => Math.floor((d.getTime() + WIB_OFFSET_MS) / HOUR_MS);
  return hour(prev) === hour(now) ? prev : now;
}
