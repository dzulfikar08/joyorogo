// Readers for what Garmin's Personal API answers (docs/garmin.md). Pure: JSON in, rows out. A record that cannot be read
// is counted and skipped; one odd record never fails a sync.

export type GarminActivity = {
  /** Garmin's `activityId`, as text (it exceeds 2^31 and is only ever an identifier). */
  id: string;
  /** Garmin's `activityType.typeKey`: walking, treadmill_running, strength_training... */
  typeKey: string;
  /** The diary's workout type (`garminWorkoutType`). */
  type: string;
  /** Day on the watch's own clock, yyyy-MM-dd (`startTimeLocal`). */
  date: string;
  startedAt: string | null;
  durationSec: number;
  /** `calories`: Garmin's figure includes resting energy. */
  grossKcal: number | null;
  /** `bmrCalories`: the resting energy inside `grossKcal`; absent on some activities. */
  restingKcal: number | null;
};

export type GarminWeighIn = {
  date: string;
  weightKg: number;
  bodyFatPct?: number;
  waterPct?: number;
  boneKg?: number;
};

export type GarminDay = {
  date: string;
  steps: number;
  distanceMeters: number;
  activeCalories: number;
  exerciseMinutes: number;
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const inRange = (value: number | null, min: number, max: number): value is number => value !== null && value >= min && value <= max;

/** Garmin `typeKey` → the diary's workout vocabulary (the one Strava, Health Connect and COROS imports share). */
const TYPE_KEYS: Readonly<Record<string, string>> = {
  walking: "Walk",
  casual_walking: "Walk",
  speed_walking: "Walk",
  hiking: "Hike",
  running: "Run",
  street_running: "Run",
  track_running: "Run",
  virtual_run: "Run",
  indoor_running: "Treadmill",
  treadmill_running: "Treadmill",
  trail_running: "TrailRun",
  cycling: "Ride",
  road_biking: "Ride",
  gravel_cycling: "Ride",
  mountain_biking: "Ride",
  indoor_cycling: "Ride",
  virtual_ride: "VirtualRide",
  e_bike_fitness: "EBikeRide",
  e_bike_mountain: "EBikeRide",
  lap_swimming: "Swim",
  open_water_swimming: "Swim",
  swimming: "Swim",
  strength_training: "WeightTraining",
  yoga: "Yoga",
  badminton: "Badminton",
  soccer: "Soccer",
};

export function garminWorkoutType(typeKey: string): string {
  return TYPE_KEYS[typeKey] ?? "OtherWorkout";
}

/** "paddelball" → "Paddelball", "hiit_cardio" → "Hiit cardio": the name of a workout the diary has no label for. */
export function humanTypeKey(typeKey: string): string {
  const words = typeKey.replaceAll("_", " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The calories of an activity for the diary: Garmin's `calories` minus the resting energy inside it (`bmrCalories`;
 * when Garmin sent none, `restingEstimate`: 1 MET, the person's weight in kcal per hour). `null` when Garmin sent no
 * calories (the caller estimates from the type); never negative.
 */
export function netKcal(grossKcal: number | null, restingKcal: number | null, restingEstimate: number): number | null {
  if (grossKcal === null || grossKcal <= 0) return null;
  return Math.max(0, grossKcal - (restingKcal ?? restingEstimate));
}

/** `activities/search/activities`: an array of activity summaries. */
export function parseActivities(body: unknown): { activities: GarminActivity[]; unparsed: number } {
  const activities: GarminActivity[] = [];
  let unparsed = 0;
  for (const record of Array.isArray(body) ? (body as unknown[]) : []) {
    if (!isRecord(record)) {
      unparsed += 1;
      continue;
    }
    const id = typeof record.activityId === "number" || typeof record.activityId === "string" ? String(record.activityId) : "";
    const typeKey = isRecord(record.activityType) && typeof record.activityType.typeKey === "string" ? record.activityType.typeKey : "";
    const local = typeof record.startTimeLocal === "string" ? record.startTimeLocal : "";
    const date = local.slice(0, 10);
    const durationSec = num(record.duration);
    if (id === "" || typeKey === "" || !DATE.test(date) || durationSec === null || durationSec <= 0) {
      unparsed += 1;
      continue;
    }
    activities.push({
      id,
      typeKey,
      type: garminWorkoutType(typeKey),
      date,
      startedAt: typeof record.startTimeGMT === "string" ? record.startTimeGMT : null,
      durationSec,
      grossKcal: num(record.calories),
      restingKcal: num(record.bmrCalories),
    });
  }
  return { activities, unparsed };
}

/**
 * `weight/range`: `dailyWeightSummaries[]`, one per day, whose `latestWeight` carries grams (weight, boneMass) and
 * percentages (bodyFat, bodyWater). The day's latest weigh-in wins. Values outside the ranges the diary accepts are dropped
 * (the weight itself: the whole entry).
 */
export function parseWeighIns(body: unknown): { entries: GarminWeighIn[]; unparsed: number } {
  const days = isRecord(body) && Array.isArray(body.dailyWeightSummaries) ? (body.dailyWeightSummaries as unknown[]) : [];
  const entries: GarminWeighIn[] = [];
  let unparsed = 0;
  for (const day of days) {
    const latest = isRecord(day) && isRecord(day.latestWeight) ? day.latestWeight : null;
    const date = latest && typeof latest.calendarDate === "string" ? latest.calendarDate : isRecord(day) && typeof day.summaryDate === "string" ? day.summaryDate : "";
    const grams = latest ? num(latest.weight) : null;
    const weightKg = grams === null ? null : Math.round(grams) / 1000;
    if (!latest || !DATE.test(date) || !inRange(weightKg, 25, 400)) {
      unparsed += 1;
      continue;
    }
    const bodyFat = num(latest.bodyFat);
    const water = num(latest.bodyWater);
    const boneGrams = num(latest.boneMass);
    const boneKg = boneGrams === null ? null : boneGrams / 1000;
    entries.push({
      date,
      weightKg,
      ...(inRange(bodyFat, 2, 75) ? { bodyFatPct: bodyFat } : {}),
      ...(inRange(water, 20, 85) ? { waterPct: water } : {}),
      ...(inRange(boneKg, 0.5, 8) ? { boneKg } : {}),
    });
  }
  return { entries, unparsed };
}

/**
 * `dailysummaries`: `data[]`, one per day. Steps, distance, active calories and intensity minutes (moderate + vigorous)
 * are what `daily_activity` holds. A day without wellness data or without steps is not a reading.
 */
export function parseDailySummaries(body: unknown): { days: GarminDay[]; unparsed: number } {
  const data = isRecord(body) && Array.isArray(body.data) ? (body.data as unknown[]) : [];
  const days: GarminDay[] = [];
  let unparsed = 0;
  for (const record of data) {
    if (!isRecord(record) || typeof record.calendarDate !== "string" || !DATE.test(record.calendarDate)) {
      unparsed += 1;
      continue;
    }
    const movement = isRecord(record.movement) ? record.movement : {};
    const steps = isRecord(movement.steps) ? movement.steps : {};
    const stepCount = num(steps.value);
    if (record.includesWellnessData === false || stepCount === null || stepCount <= 0) continue;
    const calories = isRecord(record.calories) ? record.calories : {};
    const intensity = isRecord(record.intensityMinutes) ? record.intensityMinutes : {};
    days.push({
      date: record.calendarDate,
      steps: Math.min(300_000, Math.round(stepCount)),
      distanceMeters: Math.min(500_000, Math.max(0, num(steps.distanceInMeters) ?? 0)),
      activeCalories: Math.min(20_000, Math.max(0, num(calories.burnedActive) ?? 0)),
      exerciseMinutes: Math.min(1440, Math.max(0, (num(intensity.moderate) ?? 0) + (num(intensity.vigorous) ?? 0))),
    });
  }
  return { days, unparsed };
}
