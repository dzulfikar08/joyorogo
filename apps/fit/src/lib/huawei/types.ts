// What the converter reports to the page and what the import file's `end` line carries (docs/huawei-web-import.md in the joyofit repo).

export type Rejected = { key: string; reason: string; sample: string | null; count: number };

/** `HuaweiImportSummary.toJs()` of the native importer, minus what only the phone's writing knows. */
export interface ImportSummary {
  filesRead: number;
  filesFailed: number;
  filesIgnored: number;
  badRecords: number;
  rejectedSamples: number;
  unmappedSamples: number;
  heartRateReadings: number;
  restingHeartRateReadings: number;
  spo2Readings: number;
  stressReadings: number;
  sleepSegmentsFound: number;
  metricsFound: number;
  sleepScoresFound: number;
  dayTotalsFound: number;
  mealsFound: number;
  waterDaysFound: number;
  weighInsFound: number;
  workoutsFound: number;
  rejectedReasons: Rejected[];
  badRecordReasons: { reason: string; count: number }[];
  unmappedKeys: { key: string; count: number }[];
  /** Earliest and latest time (unix seconds) of anything read; null when nothing was. */
  oldestSec: number | null;
  newestSec: number | null;
}

/** `profileFromFacts()`: only the keys the export had. */
export interface ImportProfile {
  heightCm?: number;
  weightKg?: number;
  sex?: "male" | "female";
  birthYear?: number;
}

/** Live numbers while the converter runs (a subset of [`ImportSummary`]). */
export interface FoundCounts {
  workouts: number;
  heartRateMinutes: number;
  sleepSegments: number;
  weighIns: number;
  meals: number;
  badRecords: number;
}

export interface ConvertProgress {
  /** Base name of the file being read; null before the first and after the last. */
  fileName: string | null;
  /** 1-based; 0 before the first file. */
  fileIndex: number;
  fileCount: number;
  /** 0..1 over the uncompressed bytes of all data files. */
  fraction: number;
  found: FoundCounts;
}

/** Why a conversion did not finish. `cancelled` is the person's own Cancel. */
export type ConvertErrorKind =
  | "bad_password"
  | "password_required"
  | "not_a_zip"
  | "not_an_export"
  | "cancelled"
  | "failed";

export class ConvertError extends Error {
  constructor(
    readonly kind: ConvertErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "ConvertError";
  }
}

export interface ConvertResult {
  /** The gzip NDJSON import file. */
  blob: Blob;
  /** `joyofit-import-<YYYYMMDD-HHmm>.ndjson.gz` (local time). */
  fileName: string;
  summary: ImportSummary;
  profile: ImportProfile;
  /** Rows written per batch kind, plus `workout` lines: what the phone will be handed. */
  rows: Record<string, number>;
}

export const IMPORT_CONTENT_TYPE = "application/x-joyofit-import+gzip";
