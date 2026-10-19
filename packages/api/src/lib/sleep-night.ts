// Hours of one night can sit in two stores: the app's sleep_log (manual entry or a Health Connect / Apple Health import,
// keyed by the day the night started) and fitness_score.sleep_hours (the JoyoFit push, keyed by the day the night ended).
// Every place that shows sleep hours reads both through pickNightSleep, so the Beranda tile, the Tidur screen, the group
// and the MCP connector never disagree about the same night.

/** `fitness_score.source` of a JoyoFit push; also the `source` a night shows when its hours came from the watch. */
export const WATCH_SLEEP_SOURCE = "joyofit";

export interface NightSleep {
  hours: number;
  /** 'manual' | 'health_connect' | 'apple_health' (sleep_log) or {@link WATCH_SLEEP_SOURCE}. */
  source: string;
}

/**
 * A manual entry is the person's own number and wins. Without one the watch's reading beats an import: JoyoFit measures
 * the whole day (night plus naps), while an import may be a partial copy of the same night. With neither, null.
 *
 * `watchHours` is `fitness_score.sleep_hours` of the day the night ended; a missing or non-positive value is no reading.
 */
export function pickNightSleep(
  log: NightSleep | null | undefined,
  watchHours: number | null | undefined,
): NightSleep | null {
  if (log?.source === "manual") return log;
  if (typeof watchHours === "number" && Number.isFinite(watchHours) && watchHours > 0) {
    return { hours: watchHours, source: WATCH_SLEEP_SOURCE };
  }
  return log ?? null;
}
