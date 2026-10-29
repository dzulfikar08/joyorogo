// Port of `HuaweiExportModel.kt` (what the parsers hand over, what the importer writes) and `WorkoutPoint`. Timestamps are unix seconds.

/** One minute of `step_samples` assembled from the export. */
export interface ImportedMinute {
  ts: number;
  steps: number;
  distance: number;
  /** Small calories (cal, 1/1000 kcal), the unit of `step_samples.calories`. */
  calories: number;
  heartRate: number | null;
  spo2: number | null;
  restingHeartRate: number | null;
}

export function newMinute(ts: number): ImportedMinute {
  return {
    ts,
    steps: 0,
    distance: 0,
    calories: 0,
    heartRate: null,
    spo2: null,
    restingHeartRate: null,
  };
}

/** A `sleep_segments` row: `type` is the raw kind the watch uses, `stage` its stage name. */
export interface ImportedSleep {
  start: number;
  end: number;
  type: number;
  stage: string | null;
}

/** One `health_metrics` row (`emotion`, `hrv`, `sleep_apnea`, `skin_temperature`, `arterial_stiffness`, `arrhythmia`); `json` is the `values_json` text. */
export interface ImportedMetric {
  type: string;
  ts: number;
  value: number;
  json: string;
}

export interface ImportedSleepScore {
  start: number;
  end: number;
  score: number;
  efficiency: number | null;
}

/** A day's totals from the `SportsHealth-Data.xls` summary; calories in small calories. */
export interface ImportedDayTotal {
  dayStartSec: number;
  dayEndSec: number;
  noonSec: number;
  steps: number;
  distance: number;
  calories: number;
}

/** One weigh-in: `tsMs` epoch milliseconds, `reportedJson` the `ReportedBody` text, null when the scale sent only a weight. */
export interface ImportedWeighIn {
  tsMs: number;
  weightKg: number;
  impedanceOhm: number | null;
  reportedJson: string | null;
}

/** A meal from `NUTRITION_RECORD` for JoyoRogo's diary. Macros are grams. */
export interface ImportedMeal {
  key: string;
  date: string;
  meal: string;
  name: string;
  kcal: number;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  eatenAtMs: number | null;
}

/** One thing for JoyoRogo that the importer found: `kind` `meal` or `water`, `key` its identity, `payload` the JSON text. */
export interface QueuedImport {
  kind: string;
  key: string;
  payload: string;
}

/** Units: speed m/s, cadence steps per minute, stride metres per step, power watts. */
export interface WorkoutPoint {
  ts: number;
  lat: number | null;
  lon: number | null;
  alt: number | null;
  hr: number | null;
  speed: number | null;
  cadence: number | null;
  stride: number | null;
  power: number | null;
}

export function point(ts: number, fields: Partial<Omit<WorkoutPoint, "ts">> = {}): WorkoutPoint {
  return {
    ts,
    lat: null,
    lon: null,
    alt: null,
    hr: null,
    speed: null,
    cadence: null,
    stride: null,
    power: null,
    ...fields,
  };
}

/** A `workouts` row with its `workout_points`. Times are unix seconds, distance metres, calories kcal. */
export interface ImportedWorkout {
  start: number;
  end: number;
  sportType: number;
  sportName: string;
  duration: number;
  distance: number;
  calories: number;
  steps: number;
  avgHr: number | null;
  maxHr: number | null;
  summaryJson: string;
  points: WorkoutPoint[];
}

/** What the parsers hand over. */
export interface Collector {
  heartRate(tsSec: number, bpm: number): void;
  restingHeartRate(tsSec: number, bpm: number): void;
  spo2(tsSec: number, percent: number): void;
  sleep(segment: ImportedSleep): void;
  metric(point: ImportedMetric): void;
  sleepScore(score: ImportedSleepScore): void;
  dayTotal(total: ImportedDayTotal): void;
  steps(minuteSec: number, steps: number, distance: number, calories: number): void;
  weighIn(weighIn: ImportedWeighIn): void;
  meal(meal: ImportedMeal): void;
  /** Water of one `DRINK_WATER` record, `ml` on the local day `date`; `key` identifies the record so a repeat is counted once. */
  water(date: string, ml: number, key: string): void;
  /** A fact about the person (`height` cm, `male` 1 / 0, `age` years) seen at `tsMs`; the newest of each kind is kept for the profile. */
  profileFact(kind: string, value: number, tsMs: number): void;
  /** A sample point whose key the importer does not use. */
  unmapped(key: string): void;
  /** A sample point of a known key that was dropped; `reason` is a short code (`no-time`, `no-number`, `out-of-range`, `bad-span`). */
  rejected(key: string, reason: string, sample: string | null): void;
}

/**
 * Where the importer writes: the same calls `HuaweiImportStore` gets natively, each handing over a batch. The converter's sink turns
 * them into the lines of the import file.
 */
export interface ImportSink {
  writeMinutes(rows: ImportedMinute[]): void;
  writeSleep(rows: ImportedSleep[]): void;
  writeMetrics(rows: ImportedMetric[]): void;
  writeSleepScores(rows: ImportedSleepScore[]): void;
  writeDayTotals(rows: ImportedDayTotal[]): void;
  queueForRogo(rows: QueuedImport[]): void;
  writeWeighIns(rows: ImportedWeighIn[]): void;
  writeWorkout(workout: ImportedWorkout): void;
  /** Called between chunks of input, so a sink that writes asynchronously can apply back-pressure. */
  drain?(): Promise<void>;
}
