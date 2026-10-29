// Port of `HuaweiExportImporter.kt`: reads a Huawei Privacy Centre health export and writes it through an `ImportSink` (natively the
// SQLite store; here the lines of the import file, docs/huawei-web-import.md in the joyofit repo).
//
// Every file is streamed: `RecordSplitter` cuts it into records, each record is parsed on its own and a record that fails is counted in
// `badRecords` and skipped. Minutes, sleep segments, metrics and weigh-ins are buffered and flushed between files and whenever a buffer
// reaches its limit; workouts go out one by one. The order of the writes is the native one on purpose: day totals only fill what the
// minutes written before them leave, and the first heart rate of a minute wins.

import { epochDayOf, javaJson, roundToInt } from "./java";
import { parseObject, RecordSplitter } from "./json";
import type { JObject } from "./json";
import { MetricTypes, parseHealthDetail, parseSportPerMinute } from "./health-detail";
import { newMinute } from "./model";
import type {
  Collector,
  ImportedMeal,
  ImportedMetric,
  ImportedMinute,
  ImportedSleep,
  ImportedSleepScore,
  ImportedDayTotal,
  ImportedWeighIn,
  ImportedWorkout,
  ImportSink,
  QueuedImport,
} from "./model";
import { build, fromBrokenText, fromJson, RECORD_MARKER } from "./motion-path";
import { parseSampleSequence } from "./sample-sequence";
import { parseSportsHealth } from "./sports-health";
import { ConvertError } from "./types";
import type { ImportProfile, ImportSummary, Rejected } from "./types";
import { XlsError } from "./xls";

/** Which kind of data a file holds, decided by the folder it sits in. Declared in the order the files are read. */
export const ExportKind = {
  /** `Health detail data & description`: heart rate, SpO2, sleep, stress, HRV, weigh-ins ... */
  HEALTH_DETAIL: "health_detail",
  /** `Sport per minute merged data & description`: steps and distance per minute. */
  SPORT_PER_MINUTE: "sport_per_minute",
  /** `Motion path detail data & description`: one object per tracked workout. */
  MOTION_PATH: "motion_path",
  /** `Sample sequence data & description`: sleep summaries (score) and raw sequences JoyoFit does not store. */
  SAMPLE_SEQUENCE: "sample_sequence",
  /** `SportsHealth data & desciption/SportsHealth-Data.xls`: daily totals. Last, so the per-minute rows are in first. */
  SPORTS_HEALTH: "sports_health",
} as const;
export type ExportKind = (typeof ExportKind)[keyof typeof ExportKind];

const KIND_ORDER: readonly ExportKind[] = Object.values(ExportKind);

/** The kind of the archive member `name`, or null for anything that is not one of the data files. */
export function kindOf(name: string): ExportKind | null {
  const path = name.replaceAll("\\", "/").toLowerCase();
  if (path.endsWith(".xls")) {
    return path.includes("sportshealth") && !path.includes("field description")
      ? ExportKind.SPORTS_HEALTH
      : null;
  }
  if (!path.endsWith(".json")) return null;
  if (path.includes("health detail data")) return ExportKind.HEALTH_DETAIL;
  if (path.includes("sport per minute")) return ExportKind.SPORT_PER_MINUTE;
  if (path.includes("motion path detail")) return ExportKind.MOTION_PATH;
  if (path.includes("sample sequence data")) return ExportKind.SAMPLE_SEQUENCE;
  return null;
}

/** One file inside the export archive. */
export interface ExportEntry {
  name: string;
  size: number;
}

/** A file of the archive that could not be read (damaged, wrong checksum, cut off): it costs that file only. */
export class ExportReadError extends Error {}

/** The archive of an export: its files and a way to read one in pieces. */
export interface ExportSource {
  entries(): ExportEntry[];
  /** Hands the file's bytes over in order; an error thrown by `onChunk` is passed on as it is, a damaged file throws `ExportReadError`. */
  read(entry: ExportEntry, onChunk: (bytes: Uint8Array) => void | Promise<void>): Promise<void>;
}

class Cancelled extends Error {}

const MAX_KEYS = 200;
const MAX_REASONS = 20;

/** What an import found. Counted while it runs; progress reports hand out the live numbers. */
export class HuaweiImportSummary {
  filesRead = 0;
  filesFailed = 0;
  filesIgnored = 0;
  /** Records that were not usable JSON and could not be repaired, plus oversize ones. */
  badRecords = 0;
  /** Sample points of a known kind whose value was missing or implausible. */
  rejectedSamples = 0;
  /** Sample points of kinds the importer does not use (exercise intensity ...). */
  unmappedSamples = 0;
  readonly rejectedReasons = new Map<string, Rejected>();
  readonly badRecordReasons = new Map<string, number>();
  readonly unmappedKeys = new Map<string, number>();
  heartRateReadings = 0;
  restingHeartRateReadings = 0;
  spo2Readings = 0;
  stressReadings = 0;
  sleepSegmentsFound = 0;
  metricsFound = 0;
  sleepScoresFound = 0;
  dayTotalsFound = 0;
  mealsFound = 0;
  waterDaysFound = 0;
  weighInsFound = 0;
  workoutsFound = 0;
  /** Earliest and latest time (unix seconds) of anything read. */
  oldestSec: number | null = null;
  newestSec: number | null = null;
  cancelled = false;

  reject(key: string, reason: string, sample: string | null) {
    this.rejectedSamples++;
    const id = `${key}|${reason}`;
    let entry = this.rejectedReasons.get(id);
    if (!entry) {
      entry = { key, reason, sample, count: 0 };
      this.rejectedReasons.set(id, entry);
    }
    entry.count++;
  }

  badRecord(reason: string) {
    this.badRecords++;
    this.badRecordReasons.set(reason, (this.badRecordReasons.get(reason) ?? 0) + 1);
  }

  unmapped(key: string) {
    this.unmappedSamples++;
    // The export has a handful of keys; a cap keeps a corrupt one from growing the map without bound.
    if (this.unmappedKeys.size < MAX_KEYS || this.unmappedKeys.has(key)) {
      this.unmappedKeys.set(key, (this.unmappedKeys.get(key) ?? 0) + 1);
    }
  }

  seen(tsSec: number) {
    if (this.oldestSec === null || tsSec < this.oldestSec) this.oldestSec = tsSec;
    if (this.newestSec === null || tsSec > this.newestSec) this.newestSec = tsSec;
  }

  /** The keys of `HuaweiImportSummary.toJs()` that the reading decides (the phone adds what writing did). */
  toJson(): ImportSummary {
    const top = <T>(items: T[], count: (item: T) => number) =>
      [...items].sort((a, b) => count(b) - count(a)).slice(0, MAX_REASONS);
    return {
      filesRead: this.filesRead,
      filesFailed: this.filesFailed,
      filesIgnored: this.filesIgnored,
      badRecords: this.badRecords,
      rejectedSamples: this.rejectedSamples,
      unmappedSamples: this.unmappedSamples,
      heartRateReadings: this.heartRateReadings,
      restingHeartRateReadings: this.restingHeartRateReadings,
      spo2Readings: this.spo2Readings,
      stressReadings: this.stressReadings,
      sleepSegmentsFound: this.sleepSegmentsFound,
      metricsFound: this.metricsFound,
      sleepScoresFound: this.sleepScoresFound,
      dayTotalsFound: this.dayTotalsFound,
      mealsFound: this.mealsFound,
      waterDaysFound: this.waterDaysFound,
      weighInsFound: this.weighInsFound,
      workoutsFound: this.workoutsFound,
      rejectedReasons: top([...this.rejectedReasons.values()], (r) => r.count).map((r) => ({
        ...r,
      })),
      badRecordReasons: top([...this.badRecordReasons], ([, n]) => n).map(([reason, count]) => ({
        reason,
        count,
      })),
      unmappedKeys: top([...this.unmappedKeys], ([, n]) => n).map(([key, count]) => ({
        key,
        count,
      })),
      oldestSec: this.oldestSec,
      newestSec: this.newestSec,
    };
  }
}

/** A progress report: `phase` is `reading` while files are processed and `done` at the end. */
export interface ImportProgress {
  phase: "reading" | "done";
  fileName: string | null;
  fileIndex: number;
  fileCount: number;
  /** 0..1 over the uncompressed bytes of all data files. */
  fraction: number;
  summary: HuaweiImportSummary;
}

export const FLUSH_MINUTES = 20_000;
export const FLUSH_ROWS = 5_000;
export const PROGRESS_INTERVAL_MS = 250;
/** One glass in JoyoRogo's water log, ml. */
export const WATER_GLASS_ML = 250;

/** 2000-01-01 in minutes since the epoch, the earliest time the parsers accept. */
const FIRST_MINUTE = 946_684_800 / 60;

/**
 * The minutes (unix seconds of a whole minute) a kind of reading was counted for, one bit per minute since 2000: under 7 MB per set
 * until 2100, where a `Set<number>` of six years of per-minute heart rate would take hundreds of MB.
 */
class MinuteSet {
  private bits = new Uint32Array(1024);
  private readonly outside = new Set<number>();

  /** True when `minuteSec` was not in the set yet. */
  add(minuteSec: number): boolean {
    const index = Math.trunc(minuteSec / 60) - FIRST_MINUTE;
    if (!(index >= 0 && index <= 2147483647)) {
      if (this.outside.has(minuteSec)) return false;
      this.outside.add(minuteSec);
      return true;
    }
    const word = index >>> 5;
    if (word >= this.bits.length) {
      const grown = new Uint32Array(Math.max(word + 1, this.bits.length * 2));
      grown.set(this.bits);
      this.bits = grown;
    }
    const mask = 1 << (index & 31);
    if (((this.bits[word] as number) & mask) !== 0) return false;
    this.bits[word] = (this.bits[word] as number) | mask;
    return true;
  }
}

export interface ImporterOptions {
  onProgress?: (progress: ImportProgress) => void;
  isCancelled?: () => boolean;
  nowMs?: () => number;
}

export class HuaweiExportImporter {
  private readonly summary = new HuaweiImportSummary();
  private readonly minutes = new Map<number, ImportedMinute>();
  private sleep: ImportedSleep[] = [];
  private readonly heartRateMinutes = new MinuteSet();
  private readonly restingMinutes = new MinuteSet();
  private readonly spo2Minutes = new MinuteSet();
  private readonly weighInMinutes = new Set<number>();
  private queue: QueuedImport[] = [];
  private readonly waterKeys = new Set<string>();
  private readonly waterMl = new Map<string, number>();
  /** Newest value (and its time) per kind of profile fact. */
  private readonly facts = new Map<string, [tsMs: number, value: number]>();
  private metrics: ImportedMetric[] = [];
  private readonly metricKeys = new Set<string>();
  private sleepScores: ImportedSleepScore[] = [];
  private dayTotals: ImportedDayTotal[] = [];
  private weighIns: ImportedWeighIn[] = [];

  private fileIndex = 0;
  private fileCount = 0;
  private fileName: string | null = null;
  private totalBytes = 0;
  private doneBytes = 0;
  private lastProgressMs = 0;

  private readonly onProgress: (progress: ImportProgress) => void;
  private readonly isCancelled: () => boolean;
  private readonly nowMs: () => number;

  constructor(
    private readonly sink: ImportSink,
    options: ImporterOptions = {},
  ) {
    this.onProgress = options.onProgress ?? (() => {});
    this.isCancelled = options.isCancelled ?? (() => false);
    this.nowMs = options.nowMs ?? Date.now;
  }

  private minute(tsSec: number): ImportedMinute {
    this.summary.seen(tsSec);
    const key = Math.trunc(tsSec / 60) * 60;
    let m = this.minutes.get(key);
    if (!m) {
      m = newMinute(key);
      this.minutes.set(key, m);
    }
    return m;
  }

  private readonly collector: Collector = {
    // The export writes most readings twice, under two numeric types and in different files: only the first reading of a minute counts,
    // over the whole run (the minute buffer is flushed between files).
    heartRate: (tsSec, bpm) => {
      const m = this.minute(tsSec);
      if (m.heartRate === null) m.heartRate = bpm;
      if (this.heartRateMinutes.add(m.ts)) this.summary.heartRateReadings++;
    },
    restingHeartRate: (tsSec, bpm) => {
      const m = this.minute(tsSec);
      if (m.restingHeartRate === null) m.restingHeartRate = bpm;
      if (this.restingMinutes.add(m.ts)) this.summary.restingHeartRateReadings++;
    },
    spo2: (tsSec, percent) => {
      const m = this.minute(tsSec);
      if (m.spo2 === null) m.spo2 = percent;
      if (this.spo2Minutes.add(m.ts)) this.summary.spo2Readings++;
    },
    sleep: (segment) => {
      this.summary.sleepSegmentsFound++;
      this.summary.seen(segment.start);
      this.summary.seen(segment.end);
      this.sleep.push(segment);
    },
    metric: (point) => {
      if (this.metricKeys.has(`${point.type}|${point.ts}`)) return;
      this.metricKeys.add(`${point.type}|${point.ts}`);
      if (point.type === MetricTypes.STRESS) this.summary.stressReadings++;
      else this.summary.metricsFound++;
      this.summary.seen(point.ts);
      this.metrics.push(point);
    },
    sleepScore: (score) => {
      this.summary.sleepScoresFound++;
      this.summary.seen(score.start);
      this.sleepScores.push(score);
    },
    dayTotal: (total) => {
      this.summary.dayTotalsFound++;
      this.summary.seen(total.noonSec);
      this.dayTotals.push(total);
    },
    steps: (minuteSec, steps, distance, calories) => {
      const m = this.minute(minuteSec);
      if (steps > m.steps) m.steps = steps;
      if (distance > m.distance) m.distance = distance;
      if (calories > m.calories) m.calories = calories;
    },
    weighIn: (weighIn) => {
      // Weigh-ins come under two numeric types too; a weighing is one per minute.
      const minute = Math.trunc(weighIn.tsMs / 60_000);
      if (this.weighInMinutes.has(minute)) return;
      this.weighInMinutes.add(minute);
      this.summary.weighInsFound++;
      this.summary.seen(Math.trunc(weighIn.tsMs / 1000));
      this.weighIns.push(weighIn);
    },
    meal: (meal) => {
      this.summary.mealsFound++;
      this.summary.seen(
        meal.eatenAtMs !== null ? Math.trunc(meal.eatenAtMs / 1000) : noonOf(meal.date),
      );
      this.queue.push({ kind: "meal", key: meal.key, payload: mealPayload(meal) });
    },
    water: (date, ml, key) => {
      if (this.waterKeys.has(key)) return;
      this.waterKeys.add(key);
      this.waterMl.set(date, (this.waterMl.get(date) ?? 0) + ml);
    },
    profileFact: (kind, value, tsMs) => {
      const have = this.facts.get(kind);
      if (!have || tsMs >= have[0]) this.facts.set(kind, [tsMs, value]);
    },
    unmapped: (key) => this.summary.unmapped(key),
    rejected: (key, reason, sample) => this.summary.reject(key, reason, sample),
  };

  async run(source: ExportSource): Promise<HuaweiImportSummary> {
    const entries = source.entries();
    const files = entries
      .map((entry) => ({ kind: kindOf(entry.name), entry }))
      .filter((f): f is { kind: ExportKind; entry: ExportEntry } => f.kind !== null)
      .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
    this.summary.filesIgnored = entries.length - files.length;
    if (files.length === 0) {
      throw new ConvertError(
        "not_an_export",
        'No Health data folders found in this file (expected "Health detail data", "Sport per minute" or "Motion path detail")',
      );
    }
    this.fileCount = files.length;
    this.totalBytes = Math.max(
      1,
      files.reduce((total, f) => total + Math.max(0, f.entry.size), 0),
    );
    try {
      for (const [index, file] of files.entries()) {
        this.fileIndex = index + 1;
        this.fileName = file.entry.name.split("/").pop()?.split("\\").pop() ?? file.entry.name;
        const before = this.doneBytes;
        try {
          await this.readFile(file.kind, file.entry, source);
          this.summary.filesRead++;
        } catch (e) {
          if (e instanceof Cancelled) throw e;
          // A damaged or unreadable member costs that file only.
          if (!(e instanceof ExportReadError)) throw e;
          this.summary.filesFailed++;
        }
        await this.flush();
        this.doneBytes = before + Math.max(0, file.entry.size);
        this.report("reading", true);
      }
    } catch (e) {
      if (!(e instanceof Cancelled)) throw e;
      this.summary.cancelled = true;
      await this.flush();
    }
    // A cancelled run has only part of a day's drinks: queueing that sum would fix the day at too little.
    if (!this.summary.cancelled) await this.queueWater();
    this.fileName = null;
    this.doneBytes = this.totalBytes;
    this.report("done", true);
    return this.summary;
  }

  /** `heightCm`, `weightKg`, `sex` and `birthYear` (the year of the newest weigh-in minus the age it carried), where the export says them. */
  profile(): ImportProfile {
    const out: ImportProfile = {};
    const height = this.facts.get("height");
    if (height) out.heightCm = roundToInt(height[1]);
    const weight = this.facts.get("weight");
    if (weight) out.weightKg = Math.round(weight[1] * 10) / 10;
    const male = this.facts.get("male");
    if (male) out.sex = male[1] === 1 ? "male" : "female";
    const age = this.facts.get("age");
    if (age) out.birthYear = new Date(age[0]).getUTCFullYear() - roundToInt(age[1]);
    return out;
  }

  /** The summed water of each local day, in glasses of 250 ml, as one queue item per day (a day under 125 ml is no glass). */
  private async queueWater() {
    this.summary.waterDaysFound = this.waterMl.size;
    const items: QueuedImport[] = [];
    for (const [date, ml] of [...this.waterMl].sort((a, b) =>
      a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0,
    )) {
      const glasses = Math.min(40, roundToInt(ml / WATER_GLASS_ML));
      if (glasses >= 1)
        items.push({ kind: "water", key: date, payload: javaJson({ date, glasses }) });
    }
    if (items.length > 0) {
      this.sink.queueForRogo(items);
      await this.sink.drain?.();
    }
    this.waterMl.clear();
  }

  private async readFile(kind: ExportKind, entry: ExportEntry, source: ExportSource) {
    if (kind === ExportKind.SPORTS_HEALTH) {
      await this.readSpreadsheet(entry, source);
      return;
    }
    const decoder = new TextDecoder("utf-8");
    const splitter = new RecordSplitter(
      (text) => this.handleRecord(kind, text),
      (text) => this.recover(kind, text),
      () => this.summary.badRecord(`${kind}/oversized`),
    );
    await source.read(entry, async (bytes) => {
      this.doneBytes += bytes.length;
      splitter.push(decoder.decode(bytes, { stream: true }));
      await this.sink.drain?.();
    });
    splitter.push(decoder.decode());
    splitter.finish();
  }

  /** The `.xls` summary is read whole (under a megabyte); a file that is not readable costs that file only. */
  private async readSpreadsheet(entry: ExportEntry, source: ExportSource) {
    const parts: Uint8Array[] = [];
    let length = 0;
    await source.read(entry, (bytes) => {
      this.doneBytes += bytes.length;
      parts.push(bytes.slice());
      length += bytes.length;
    });
    const bytes = new Uint8Array(length);
    let at = 0;
    for (const part of parts) {
      bytes.set(part, at);
      at += part.length;
    }
    try {
      parseSportsHealth(bytes, this.collector);
    } catch (e) {
      if (!(e instanceof XlsError)) throw e;
      this.summary.badRecord(`${ExportKind.SPORTS_HEALTH}/${e.message}`);
    }
    this.report("reading", false);
  }

  private handleRecord(kind: ExportKind, text: string) {
    if (this.isCancelled()) throw new Cancelled();
    const record = parseObject(text);
    if (!record) {
      this.recover(kind, text);
    } else {
      // Only reading the record is guarded: a bad record is skipped.
      let workout: ImportedWorkout | null = null;
      let readable = true;
      try {
        workout = this.readRecord(kind, record);
      } catch {
        readable = false;
      }
      if (!readable) {
        this.summary.badRecord(`${kind}/parser-error`);
      } else if (kind === ExportKind.MOTION_PATH) {
        if (workout === null) this.summary.badRecord(`${kind}/no-start-or-duration`);
        else this.writeWorkout(workout);
      }
    }
    if (
      this.minutes.size >= FLUSH_MINUTES ||
      this.sleep.length >= FLUSH_ROWS ||
      this.metrics.length >= FLUSH_ROWS ||
      this.weighIns.length >= FLUSH_ROWS
    ) {
      this.flushNow();
    }
    this.report("reading", false);
  }

  private readRecord(kind: ExportKind, record: JObject): ImportedWorkout | null {
    switch (kind) {
      case ExportKind.HEALTH_DETAIL:
        parseHealthDetail(record, this.collector);
        return null;
      case ExportKind.SPORT_PER_MINUTE:
        parseSportPerMinute(record, this.collector);
        return null;
      case ExportKind.SAMPLE_SEQUENCE:
        parseSampleSequence(record, this.collector);
        return null;
      case ExportKind.SPORTS_HEALTH:
        return null;
      case ExportKind.MOTION_PATH:
        return build(fromJson(record));
    }
  }

  /**
   * A record that is not valid JSON. Motion paths are read off the raw text (the line records inside do not need the JSON around
   * them), and when a stray quote merged several workouts into one text it is cut at the next workout's first key. Other kinds have
   * nothing to salvage.
   */
  private recover(kind: ExportKind, text: string) {
    if (kind !== ExportKind.MOTION_PATH) {
      this.summary.badRecord(`${kind}/invalid-json`);
      return;
    }
    const starts: number[] = [];
    let at = text.indexOf(RECORD_MARKER);
    while (at >= 0) {
      starts.push(at);
      at = text.indexOf(RECORD_MARKER, at + 1);
    }
    const pieces =
      starts.length <= 1
        ? [text]
        : starts.map((from, i) => text.slice(from, starts[i + 1] ?? text.length));
    for (const piece of pieces) {
      let workout: ImportedWorkout | null;
      try {
        const raw = fromBrokenText(piece);
        workout = raw ? build(raw) : null;
      } catch {
        workout = null;
      }
      if (workout === null) this.summary.badRecord(`${kind}/unrecoverable`);
      else this.writeWorkout(workout);
    }
  }

  private writeWorkout(workout: ImportedWorkout) {
    this.summary.workoutsFound++;
    this.summary.seen(workout.start);
    this.summary.seen(workout.end);
    this.sink.writeWorkout(workout);
  }

  /** The native `flush()`: minutes, sleep, metrics, sleep scores, queue, weigh-ins, then day totals (they only fill what the minutes leave). */
  private flushNow() {
    if (this.minutes.size > 0) {
      this.sink.writeMinutes([...this.minutes.values()]);
      this.minutes.clear();
    }
    if (this.sleep.length > 0) {
      this.sink.writeSleep(this.sleep);
      this.sleep = [];
    }
    if (this.metrics.length > 0) {
      this.sink.writeMetrics(this.metrics);
      this.metrics = [];
    }
    if (this.sleepScores.length > 0) {
      this.sink.writeSleepScores(this.sleepScores);
      this.sleepScores = [];
    }
    if (this.queue.length > 0) {
      this.sink.queueForRogo(this.queue);
      this.queue = [];
    }
    if (this.weighIns.length > 0) {
      this.sink.writeWeighIns(this.weighIns);
      this.weighIns = [];
    }
    if (this.dayTotals.length > 0) {
      this.sink.writeDayTotals(this.dayTotals);
      this.dayTotals = [];
    }
  }

  private async flush() {
    this.flushNow();
    await this.sink.drain?.();
  }

  private report(phase: "reading" | "done", force: boolean) {
    const now = this.nowMs();
    if (!force && now - this.lastProgressMs < PROGRESS_INTERVAL_MS) return;
    this.lastProgressMs = now;
    this.onProgress({
      phase,
      fileName: this.fileName,
      fileIndex: this.fileIndex,
      fileCount: this.fileCount,
      fraction: Math.min(1, Math.max(0, this.doneBytes / this.totalBytes)),
      summary: this.summary,
    });
  }
}

/** 12:00 UTC of a `YYYY-MM-DD` day, unix seconds. */
function noonOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return (epochDayOf(y as number, m as number, d as number) as number) * 86_400 + 43_200;
}

/** The queue payload of a meal: `JSONObject` order, optional fields only when present. */
function mealPayload(meal: ImportedMeal): string {
  const json: Record<string, unknown> = {
    key: meal.key,
    date: meal.date,
    meal: meal.meal,
    name: meal.name,
    kcal: meal.kcal,
  };
  if (meal.protein !== null) json.protein = meal.protein;
  if (meal.carbs !== null) json.carbs = meal.carbs;
  if (meal.fat !== null) json.fat = meal.fat;
  if (meal.eatenAtMs !== null) json.eatenAt = meal.eatenAtMs;
  return javaJson(json);
}
