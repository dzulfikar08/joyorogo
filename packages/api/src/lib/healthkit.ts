// Pure sleep math for the HealthKit import (US-013 iOS branch): HealthKit
// reports fragmented sleepAnalysis category samples, often duplicated because
// iPhone and Apple Watch both write the same night. Overlapping intervals are
// unioned before summing so double-reported sleep counts once, then each bout
// is keyed with sleepNightKey, like the Health Connect import keys SleepSession rows.

export type SleepInterval = { startMs: number; endMs: number };

// HKCategoryValueSleepAnalysis: 0 inBed, 1 asleepUnspecified, 2 awake,
// 3 asleepCore, 4 asleepDeep, 5 asleepREM. Only asleep values count toward
// sleep hours.
const ASLEEP_VALUES: readonly number[] = [1, 3, 4, 5];

export function unionIntervals(intervals: SleepInterval[]): SleepInterval[] {
  const sorted = [...intervals].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  const merged: SleepInterval[] = [];
  for (const interval of sorted) {
    if (interval.endMs <= interval.startMs) continue;
    const last = merged[merged.length - 1];
    // Touching intervals merge too: adjacent stage samples describe one bout.
    if (last && interval.startMs <= last.endMs) {
      last.endMs = Math.max(last.endMs, interval.endMs);
    } else {
      merged.push({ ...interval });
    }
  }
  return merged;
}

// Same fixed UTC+7 day rule as the server's jakartaToday(): shift the instant
// by +7h and take the UTC calendar date.
function wibDayKey(ms: number): string {
  return new Date(ms + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// sleep_log keys a night by the WIB evening it began ("tidur tadi malam" is
// read as date - 1 by day.summary, group and Tidur). Sleep that ends before
// noon WIB belongs to the previous day, so the end shifted back 12 h gives the
// key; a nap ending in the afternoon stays on its own day.
export function sleepNightKey(endMs: number): string {
  return wibDayKey(endMs - 12 * 60 * 60 * 1000);
}

// Unioned asleep hours per night (sleepNightKey of each bout's end). Standalone
// bouts under 15 minutes are dropped, mirroring the Health Connect import's
// session filter; the threshold applies after the union so short stage
// samples inside a long night are never lost.
export function sleepHoursByWibDay(
  samples: Array<SleepInterval & { value: number }>,
): Map<string, number> {
  const bouts = unionIntervals(samples.filter((s) => ASLEEP_VALUES.includes(s.value)));
  const hoursByDay = new Map<string, number>();
  for (const bout of bouts) {
    const hours = (bout.endMs - bout.startMs) / 3_600_000;
    if (hours < 0.25) continue;
    const day = sleepNightKey(bout.endMs);
    hoursByDay.set(day, (hoursByDay.get(day) ?? 0) + hours);
  }
  return hoursByDay;
}
