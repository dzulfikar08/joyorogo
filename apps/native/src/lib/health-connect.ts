// US-009 + US-013: Health Connect is the PRIMARY activity source on Android.
// react-native-health-connect ships Android native code only — it needs a dev
// build (not Expo Go), and its TurboModule lookup throws outside Android, so
// this file is require()d lazily from src/lib/health-sync.ts and must never
// be imported at module scope by shared screens.
//
// The iOS equivalent lives in src/lib/apple-health.ts (local AppleHealth
// module); the platform pick happens in health-sync.ts.
//
// Data rules:
// - Cumulative metrics (steps, distance, active calories) come from
//   Health Connect's own aggregateRecord(), which dedupes across writing
//   apps — a phone and a watch reporting the same walk count once.
// - Workouts are ExerciseSession rows deduped by HC metadata id.
// - Aggregate active calories are displayed as-is and never added on top of
//   workout kcal in Burn, so nothing double counts.
// - A manual entry is user intent: workout import dedupes only against its
//   own source, and sleep sync never overwrites a manual row.
import { Platform } from "react-native";
import {
  aggregateRecord,
  getGrantedPermissions,
  initialize,
  readRecords,
  requestPermission,
} from "react-native-health-connect";
import type {
  BackgroundAccessPermission,
  Permission,
  RecordResult,
} from "react-native-health-connect";

import { estimateKcal, metForStravaType } from "@joyorogo/api/lib/met";

import { client } from "@/utils/orpc";

// readRecords returns results without the recordType tag but with resolved
// units (energy in kcal variants) — that's the shape we consume.
type HealthSessionRecord = RecordResult<"ExerciseSession">;

function isHealthConnectSupported(): boolean {
  return Platform.OS === "android";
}

const READ_PERMISSIONS: (Permission | BackgroundAccessPermission)[] = [
  { accessType: "read", recordType: "ExerciseSession" },
  { accessType: "read", recordType: "SleepSession" },
  { accessType: "read", recordType: "Steps" },
  { accessType: "read", recordType: "Distance" },
  { accessType: "read", recordType: "ActiveCaloriesBurned" },
];

// Android 14+ background reads: data syncs without opening the app. Requested
// separately — older Health Connect builds reject the request outright.
const BACKGROUND_READ_PERMISSION: BackgroundAccessPermission = {
  accessType: "read",
  recordType: "BackgroundAccessPermission",
};

// Health Connect ExerciseType numbers → Strava-ish type names, which the
// shared metForStravaType() already maps to our MET keys.
const ACTIVITY_BY_EXERCISE_TYPE: Record<number, string> = {
  2: "Badminton",
  8: "Ride",
  9: "Ride",
  25: "Elliptical",
  36: "HighIntensityIntervalTraining",
  37: "Hike",
  56: "Run",
  57: "Run",
  64: "Soccer",
  68: "StairClimbing",
  70: "WeightTraining",
  73: "Swim",
  74: "Swim",
  79: "Walk",
  83: "Yoga",
};

const LABEL_ID_BY_EXERCISE_TYPE: Record<number, string> = {
  0: "Olahraga",
  2: "Badminton",
  8: "Sepeda",
  9: "Sepeda statis",
  16: "Menari",
  25: "Elliptical",
  36: "HIIT",
  37: "Hiking",
  53: "Dayung",
  56: "Lari",
  57: "Lari treadmill",
  64: "Sepak bola",
  68: "Naik tangga",
  70: "Angkat beban",
  73: "Berenang",
  74: "Berenang",
  75: "Tenis meja",
  76: "Tenis",
  78: "Voli",
  79: "Jalan",
  83: "Yoga",
};

// Same fixed UTC+7 day rule as the server's jakartaToday(): shift the instant
// by +7h and take the UTC calendar date.
function wibDateOf(iso: string): string {
  return new Date(new Date(iso).getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// The last `count` WIB calendar days, today first.
function wibDaysBack(count: number): string[] {
  const days: string[] = [];
  for (let offset = 0; offset < count; offset++) {
    days.push(
      new Date(Date.now() + 7 * 60 * 60 * 1000 - offset * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10),
    );
  }
  return days;
}

export type HealthConnectSyncResult = {
  workoutsImported: number;
  workoutsSkipped: number;
  activityDays: number;
  sleepNights: number;
};

const SYNC_WINDOW_DAYS = 7;

function syncWindowRange(endTime: Date) {
  return {
    operator: "between" as const,
    startTime: new Date(endTime.getTime() - SYNC_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString(),
    endTime: endTime.toISOString(),
  };
}

async function requestReadPermissions(): Promise<{
  canReadExercise: boolean;
  canReadDailyMetrics: boolean;
  canReadSleep: boolean;
}> {
  const granted = await requestPermission(READ_PERMISSIONS);
  const has = (recordType: string) =>
    granted.some(
      (p) => "recordType" in p && p.recordType === recordType && p.accessType === "read",
    );
  try {
    await requestPermission([BACKGROUND_READ_PERMISSION]);
  } catch {
    // Background reads are a bonus (Android 14+); foreground sync still works.
  }
  return {
    canReadExercise: has("ExerciseSession"),
    canReadDailyMetrics: has("Steps") && has("Distance") && has("ActiveCaloriesBurned"),
    canReadSleep: has("SleepSession"),
  };
}

const READ_RECORD_TYPES = [
  "ExerciseSession",
  "SleepSession",
  "Steps",
  "Distance",
  "ActiveCaloriesBurned",
];

/**
 * Auto-sync gate: true when all five read permissions are already granted.
 * Reads Health Connect state without prompting anything.
 */
export async function hasReadPermissions(): Promise<boolean> {
  const granted = await getGrantedPermissions();
  const have = new Set<string>(
    granted.filter((p) => p.accessType === "read").map((p) => p.recordType),
  );
  return READ_RECORD_TYPES.every((t) => have.has(t));
}

function externalIdOf(record: HealthSessionRecord): string {
  return (
    record.metadata?.id ??
    record.metadata?.clientRecordId ??
    `${record.startTime}:${record.exerciseType}`
  );
}

function sessionDurationMin(record: HealthSessionRecord): number {
  return (Date.parse(record.endTime) - Date.parse(record.startTime)) / 60_000;
}

async function readSessions(endTime: Date): Promise<HealthSessionRecord[]> {
  const { records } = await readRecords("ExerciseSession", {
    timeRangeFilter: syncWindowRange(endTime),
  });
  return records;
}

// Health Connect keeps exercise kcal in ActiveCaloriesBurned interval records,
// not on the session itself. Aggregate within the session window so Huawei/
// watch energy beats our MET guess; aggregateRecord dedupes across sources.
async function sessionKcal(record: HealthSessionRecord): Promise<number> {
  try {
    const aggregated = await aggregateRecord({
      recordType: "ActiveCaloriesBurned",
      timeRangeFilter: {
        operator: "between",
        startTime: record.startTime,
        endTime: record.endTime,
      },
    });
    return Math.round(aggregated.ACTIVE_CALORIES_TOTAL?.inKilocalories ?? 0);
  } catch {
    return 0;
  }
}

/**
 * ExerciseSession rows → exercise_log (source 'health_connect'). exercise.add
 * inserts strictly (unique user+source+externalId), so dedup here against the
 * last 7 days of already-imported rows before sending. kcal prefers the
 * recorded energy, else a MET estimate at the latest known weight.
 */
async function importWorkouts(
  records: HealthSessionRecord[],
  latestWeightKg: number | null,
): Promise<{ imported: number; skipped: number }> {
  const existing = new Set<string>();
  for (const day of wibDaysBack(SYNC_WINDOW_DAYS + 1)) {
    const { items } = await client.exercise.listByDate({ date: day });
    for (const item of items) {
      if (item.source === "health_connect" && item.externalId) {
        existing.add(item.externalId);
      }
    }
  }

  let imported = 0;
  let skipped = 0;
  for (const record of records) {
    const externalId = externalIdOf(record);
    if (existing.has(externalId)) {
      skipped++;
      continue;
    }
    const durationMin = sessionDurationMin(record);
    if (durationMin < 1) {
      skipped++;
      continue;
    }
    const activity = ACTIVITY_BY_EXERCISE_TYPE[record.exerciseType] ?? "OtherWorkout";
    const duration = Math.round(durationMin);
    const recordedKcal = await sessionKcal(record);
    const kcal =
      recordedKcal > 0
        ? recordedKcal
        : estimateKcal(metForStravaType(activity), latestWeightKg ?? 70, duration);
    await client.exercise.add({
      date: wibDateOf(record.startTime),
      type: activity,
      name:
        record.title ??
        LABEL_ID_BY_EXERCISE_TYPE[record.exerciseType] ??
        "Olahraga (Health Connect)",
      durationMin: duration,
      kcal,
      source: "health_connect",
      externalId,
    });
    existing.add(externalId);
    imported++;
  }
  return { imported, skipped };
}

/**
 * Cumulative daily metrics for the last 7 WIB days, aggregated by Health
 * Connect itself (aggregateRecord), so multiple writing apps cannot double
 * count. Exercise minutes come from the already-read session records.
 */
async function importDailyActivity(records: HealthSessionRecord[]): Promise<number> {
  const minutesByDay = new Map<string, number>();
  for (const record of records) {
    const day = wibDateOf(record.startTime);
    minutesByDay.set(day, (minutesByDay.get(day) ?? 0) + Math.max(0, sessionDurationMin(record)));
  }

  let upserted = 0;
  for (const day of wibDaysBack(SYNC_WINDOW_DAYS)) {
    const timeRangeFilter = {
      operator: "between" as const,
      startTime: `${day}T00:00:00+07:00`,
      endTime: `${day}T23:59:59.999+07:00`,
    };
    const [steps, distance, activeCalories] = await Promise.all([
      aggregateRecord({ recordType: "Steps", timeRangeFilter }),
      aggregateRecord({ recordType: "Distance", timeRangeFilter }),
      aggregateRecord({ recordType: "ActiveCaloriesBurned", timeRangeFilter }),
    ]);
    const stepsCount = Math.round(steps.COUNT_TOTAL ?? 0);
    const meters = Math.round(distance.DISTANCE?.inMeters ?? 0);
    const kcal = Math.round(activeCalories.ACTIVE_CALORIES_TOTAL?.inKilocalories ?? 0);
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
    });
    upserted++;
  }
  return upserted;
}

/**
 * SleepSession rows → sleepLog (source 'health_connect'), keyed by the WIB
 * day whose morning the sleep ended. The server refuses to overwrite manual
 * rows, so user corrections always survive a resync.
 */
async function importSleep(endTime: Date): Promise<number> {
  const { records } = await readRecords("SleepSession", {
    timeRangeFilter: syncWindowRange(endTime),
  });
  const hoursByDay = new Map<string, number>();
  for (const record of records) {
    const hours = (Date.parse(record.endTime) - Date.parse(record.startTime)) / 3_600_000;
    if (hours < 0.25) continue;
    const day = wibDateOf(record.endTime);
    hoursByDay.set(day, (hoursByDay.get(day) ?? 0) + hours);
  }
  let imported = 0;
  for (const [day, hours] of hoursByDay) {
    const row = await client.sleep.log({
      date: day,
      hours: Math.round(hours * 10) / 10,
      source: "health_connect",
    });
    if (row) imported++;
  }
  return imported;
}

/**
 * Full sync: workouts + daily activity rollup + sleep, last 7 days. Workout
 * reading is mandatory (throws without permission — the user can retry from
 * Profil); daily metrics and sleep degrade gracefully when their permissions
 * are missing.
 */
export async function syncHealthConnect(
  latestWeightKg: number | null,
): Promise<HealthConnectSyncResult> {
  if (!isHealthConnectSupported()) {
    return { workoutsImported: 0, workoutsSkipped: 0, activityDays: 0, sleepNights: 0 };
  }
  const ready = await initialize();
  if (!ready) {
    throw new Error(
      "Health Connect tidak tersedia di perangkat ini. Pasang aplikasi Health Connect, lalu coba lagi.",
    );
  }
  const { canReadExercise, canReadDailyMetrics, canReadSleep } = await requestReadPermissions();
  if (!canReadExercise) {
    throw new Error("Izin membaca latihan dari Health Connect belum diberikan.");
  }

  const endTime = new Date();
  const records = await readSessions(endTime);
  const workouts = await importWorkouts(records, latestWeightKg);
  const activityDays = canReadDailyMetrics ? await importDailyActivity(records) : 0;
  const sleepNights = canReadSleep ? await importSleep(endTime) : 0;

  return {
    workoutsImported: workouts.imported,
    workoutsSkipped: workouts.skipped,
    activityDays,
    sleepNights,
  };
}
