// US-013 iOS branch: the HealthKit import mirrors the Health Connect data
// rules from health-connect.ts (day keys, 7-day window, workout dedupe by
// external id, recorded kcal over MET estimate, sleep never overwrites manual
// rows). The Swift module only reads raw data; normalizing happens here.
import { estimateKcal, metForStravaType } from "@joyorogo/api/lib/met";
import { sleepHoursByWibDay } from "@joyorogo/api/lib/healthkit";
import { crossSourceMatcher, type ImportedWorkoutRow } from "@joyorogo/api/lib/import-dedupe";
import { dayOfMs, i18n } from "@joyorogo/i18n";
import * as SecureStore from "expo-secure-store";

import { getAppleHealthModule } from "@/modules/apple-health";
import type {
  AppleHealthDayTotals,
  AppleHealthSleepSample,
  AppleHealthWorkout,
} from "@/modules/apple-health";
import type { HealthSyncResult } from "@/src/lib/health-sync";
import { client } from "@/utils/orpc";

const SYNC_WINDOW_DAYS = 7;

const ZERO_RESULT: HealthSyncResult = {
  workoutsImported: 0,
  workoutsSkipped: 0,
  activityDays: 0,
  sleepNights: 0,
};

// HKWorkoutActivityType raw values → the same Strava-ish type names the
// Health Connect import maps to, so metForStravaType() covers exactly these.
// Values verified against Apple's HKWorkoutActivityType documentation.
const ACTIVITY_BY_ACTIVITY_TYPE: Record<number, string> = {
  4: "Badminton", // badminton
  13: "Ride", // cycling
  16: "Elliptical", // elliptical
  20: "WeightTraining", // functionalStrengthTraining
  24: "Hike", // hiking
  35: "Rowing", // rowing
  37: "Run", // running
  41: "Soccer", // soccer
  44: "StairClimbing", // stairClimbing
  46: "Swim", // swimming
  48: "Tennis", // tennis
  50: "WeightTraining", // traditionalStrengthTraining
  52: "Walk", // walking
  57: "Yoga", // yoga
  63: "HighIntensityIntervalTraining", // highIntensityIntervalTraining
};

// Indonesian display names, matching LABEL_ID_BY_EXERCISE_TYPE in
// health-connect.ts. Dance has three HK cases (14, 77, 78).
const LABEL_BY_ACTIVITY_TYPE: Record<number, string> = {
  4: "Badminton",
  13: "Sepeda",
  14: "Menari",
  16: "Elliptical",
  20: "Angkat beban",
  24: "Hiking",
  35: "Dayung",
  37: "Lari",
  41: "Sepak bola",
  44: "Naik tangga",
  46: "Berenang",
  47: "Tenis meja",
  48: "Tenis",
  50: "Angkat beban",
  51: "Voli",
  52: "Jalan",
  57: "Yoga",
  63: "HIIT",
  73: "Kardio campuran",
  77: "Menari",
  78: "Menari",
};

// The person's calendar day (active zone) an instant falls on, like the server's jakartaToday().
function wibDateOf(iso: string): string {
  return dayOfMs(new Date(iso).getTime());
}

// The last `count` calendar days in the active zone, today first.
function wibDaysBack(count: number): string[] {
  const days: string[] = [];
  for (let offset = 0; offset < count; offset++) {
    days.push(dayOfMs(Date.now() - offset * 86_400_000));
  }
  return days;
}

// HealthKit never reveals whether read access was granted, so the flag
// records that a sync from Profil completed; silent auto-sync waits for it.
const FIRST_SYNC_KEY = "joyorogo.appleHealthFirstSync";

export async function hasCompletedFirstSync(): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(FIRST_SYNC_KEY)) === "1";
  } catch {
    return false;
  }
}

async function markFirstSyncDone(): Promise<void> {
  try {
    await SecureStore.setItemAsync(FIRST_SYNC_KEY, "1");
  } catch {
    // Persistence is best-effort; the next successful sync retries.
  }
}

/**
 * HKWorkout rows → exercise_log (source 'apple_health'). exercise.add inserts
 * strictly (unique user+source+externalId), so dedupe here against the last
 * 7 days of already-imported rows before sending. kcal prefers the recorded
 * energy, else a MET estimate at the latest known weight.
 */
async function importWorkouts(
  workouts: AppleHealthWorkout[],
  latestWeightKg: number | null,
): Promise<{ imported: number; skipped: number }> {
  const existing = new Set<string>();
  // The other phone's source (Health Connect vs Apple Health) may already hold this very workout.
  const otherSourceRows: ImportedWorkoutRow[] = [];
  for (const day of wibDaysBack(SYNC_WINDOW_DAYS + 1)) {
    const { items } = await client.exercise.listByDate({ date: day });
    for (const item of items) {
      if (item.source === "apple_health" && item.externalId) {
        existing.add(item.externalId);
      }
      if (item.source === "health_connect") {
        otherSourceRows.push({ date: day, type: item.type, durationMin: item.durationMin });
      }
    }
  }
  const otherSource = crossSourceMatcher(otherSourceRows);

  let imported = 0;
  let skipped = 0;
  for (const workout of workouts) {
    if (existing.has(workout.id)) {
      skipped++;
      continue;
    }
    const durationMin = (Date.parse(workout.end) - Date.parse(workout.start)) / 60_000;
    if (durationMin < 1) {
      skipped++;
      continue;
    }
    const activity = ACTIVITY_BY_ACTIVITY_TYPE[workout.activityType] ?? "OtherWorkout";
    const duration = Math.round(durationMin);
    if (otherSource.claim({ date: wibDateOf(workout.start), type: activity, durationMin: duration })) {
      skipped++;
      continue;
    }
    const recordedKcal = workout.kcal != null ? Math.round(workout.kcal) : 0;
    const kcal =
      recordedKcal > 0
        ? recordedKcal
        : estimateKcal(metForStravaType(activity), latestWeightKg ?? 70, duration);
    try {
      await client.exercise.add({
        date: wibDateOf(workout.start),
        type: activity,
        name: LABEL_BY_ACTIVITY_TYPE[workout.activityType] ?? "Olahraga (Apple Health)",
        durationMin: duration,
        kcal,
        source: "apple_health",
        externalId: workout.id,
      });
    } catch {
      // The (user, source, externalId) unique index rejects a workout that is
      // already stored even when the list window above misses it (a row the
      // user moved to another day, or a racing sync). Skip it: the stored row,
      // including any user edit, stays untouched.
      skipped++;
      continue;
    }
    existing.add(workout.id);
    imported++;
  }
  return { imported, skipped };
}

/**
 * Cumulative daily metrics for the last 7 days, aggregated by HealthKit
 * itself (HKStatisticsCollectionQuery anchored at midnight of the day zone), so a phone
 * and a watch reporting the same walk cannot double count. Exercise minutes
 * come from the already-read workout records.
 */
async function importDailyActivity(
  totals: AppleHealthDayTotals[],
  workouts: AppleHealthWorkout[],
): Promise<number> {
  const minutesByDay = new Map<string, number>();
  for (const workout of workouts) {
    const day = wibDateOf(workout.start);
    const minutes = Math.max(0, (Date.parse(workout.end) - Date.parse(workout.start)) / 60_000);
    minutesByDay.set(day, (minutesByDay.get(day) ?? 0) + minutes);
  }

  let upserted = 0;
  for (const day of wibDaysBack(SYNC_WINDOW_DAYS)) {
    const total = totals.find((t) => t.date === day);
    const stepsCount = Math.round(total?.steps ?? 0);
    const meters = Math.round(total?.distanceMeters ?? 0);
    const kcal = Math.round(total?.activeKcal ?? 0);
    const exerciseMinutes = Math.round(minutesByDay.get(day) ?? 0);
    if (stepsCount === 0 && meters === 0 && kcal === 0 && exerciseMinutes === 0) {
      continue;
    }
    await client.activity.upsert({
      date: day,
      steps: stepsCount,
      distanceMeters: meters,
      activeCalories: kcal,
      exerciseMinutes,
      source: "apple_health",
    });
    upserted++;
  }
  return upserted;
}

/**
 * sleepAnalysis samples → sleepLog (source 'apple_health'), unioned across
 * overlapping sources and keyed by the evening the night began (sleepNightKey).
 * The server refuses to overwrite manual rows, so user corrections always
 * survive a resync.
 */
async function importSleep(samples: AppleHealthSleepSample[]): Promise<number> {
  const hoursByDay = sleepHoursByWibDay(
    samples.map((sample) => ({
      startMs: Date.parse(sample.start),
      endMs: Date.parse(sample.end),
      value: sample.value,
    })),
  );
  let imported = 0;
  for (const [day, hours] of hoursByDay) {
    const row = await client.sleep.log({
      date: day,
      hours: Math.round(hours * 10) / 10,
      source: "apple_health",
    });
    if (row) imported++;
  }
  return imported;
}

/**
 * Full sync: workouts + daily activity rollup + sleep, last 7 days. HealthKit
 * denies silently (queries just return nothing), so unlike Health Connect
 * there is no per-scope permission check: denied reads yield an empty result
 * and the Profil card points at the Settings screen.
 */
export async function syncAppleHealth(latestWeightKg: number | null): Promise<HealthSyncResult> {
  const mod = getAppleHealthModule();
  if (!mod) {
    return ZERO_RESULT;
  }
  if (!(await mod.isAvailable())) {
    throw new Error(i18n.t("olahraga:healthSync.appleHealthUnavailable"));
  }

  await mod.requestAuthorization();

  const endMs = Date.now();
  const startMs = endMs - SYNC_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const [workouts, dailyTotals, sleepSamples] = await Promise.all([
    mod.getWorkouts(startMs, endMs),
    // The native module buckets these totals at WIB midnight (AppleHealthModule.swift); a UTC+8 person's totals shift
    // by an hour until the module takes the zone (a native build, not OTA-able).
    mod.getDailyTotals(startMs, endMs),
    mod.getSleepSamples(startMs, endMs),
  ]);

  const imported = await importWorkouts(workouts, latestWeightKg);
  const activityDays = await importDailyActivity(dailyTotals, workouts);
  const sleepNights = await importSleep(sleepSamples);
  await markFirstSyncDone();

  return {
    workoutsImported: imported.imported,
    workoutsSkipped: imported.skipped,
    activityDays,
    sleepNights,
  };
}
