// The import file of docs/huawei-web-import.md (joyofit repo): gzip of UTF-8 NDJSON, a header line, batch lines in the order the native
// importer writes them, one line per workout, and the `end` line. `ImportFileSink` is the importer's `ImportSink` that writes those lines.

import type {
  ImportedDayTotal,
  ImportedMetric,
  ImportedMinute,
  ImportedSleep,
  ImportedSleepScore,
  ImportedWeighIn,
  ImportedWorkout,
  ImportSink,
  QueuedImport,
} from "./model";
import type { ImportProfile, ImportSummary } from "./types";

export const FORMAT = "joyofit-import";
export const VERSION = 1;

/** `joyofit-import-<YYYYMMDD-HHmm>.ndjson.gz`, local time. */
export function importFileName(date: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `joyofit-import-${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}.ndjson.gz`;
}

export function headerLine(exportName: string, createdAtMs: number): string {
  return JSON.stringify({
    format: FORMAT,
    version: VERSION,
    source: "huawei-export",
    createdAt: createdAtMs,
    exportName,
  });
}

export function endLine(summary: ImportSummary, profile: ImportProfile): string {
  return JSON.stringify({ t: "end", summary, profile });
}

const encoder = new TextEncoder();

export class ImportFileSink implements ImportSink {
  private pending: string[] = [];
  /** Rows written per batch kind (`workout` counts lines, `workoutPoints` their points). */
  readonly rows: Record<string, number> = {};

  constructor(private readonly out: { write(chunk: Uint8Array<ArrayBuffer>): Promise<void> }) {}

  line(text: string) {
    this.pending.push(text);
  }

  private batch(kind: string, rows: unknown[]) {
    this.rows[kind] = (this.rows[kind] ?? 0) + rows.length;
    this.line(JSON.stringify({ t: kind, rows }));
  }

  writeMinutes(rows: ImportedMinute[]) {
    this.batch(
      "minutes",
      rows.map((m) => [
        m.ts,
        m.steps,
        m.calories,
        m.distance,
        m.heartRate,
        m.spo2,
        m.restingHeartRate,
      ]),
    );
  }

  writeSleep(rows: ImportedSleep[]) {
    this.batch(
      "sleep",
      rows.map((s) => [s.start, s.end, s.type, s.stage]),
    );
  }

  writeMetrics(rows: ImportedMetric[]) {
    this.batch(
      "metrics",
      rows.map((m) => [m.type, m.ts, m.value, m.json]),
    );
  }

  writeSleepScores(rows: ImportedSleepScore[]) {
    this.batch(
      "sleepScores",
      rows.map((s) => [s.start, s.end, s.score, s.efficiency]),
    );
  }

  queueForRogo(rows: QueuedImport[]) {
    this.batch(
      "queue",
      rows.map((q) => [q.kind, q.key, q.payload]),
    );
  }

  writeWeighIns(rows: ImportedWeighIn[]) {
    this.batch(
      "weighIns",
      rows.map((w) => [w.tsMs, w.weightKg, w.impedanceOhm, w.reportedJson]),
    );
  }

  writeDayTotals(rows: ImportedDayTotal[]) {
    this.batch(
      "dayTotals",
      rows.map((d) => [d.dayStartSec, d.dayEndSec, d.noonSec, d.steps, d.distance, d.calories]),
    );
  }

  writeWorkout(w: ImportedWorkout) {
    this.rows.workout = (this.rows.workout ?? 0) + 1;
    this.rows.workoutPoints = (this.rows.workoutPoints ?? 0) + w.points.length;
    this.line(
      JSON.stringify({
        t: "workout",
        w: {
          start: w.start,
          end: w.end,
          sportType: w.sportType,
          sportName: w.sportName,
          duration: w.duration,
          distance: w.distance,
          calories: w.calories,
          steps: w.steps,
          avgHr: w.avgHr,
          maxHr: w.maxHr,
          summaryJson: w.summaryJson,
          points: w.points.map((p) => [
            p.ts,
            p.lat,
            p.lon,
            p.alt,
            p.hr,
            p.speed,
            p.cadence,
            p.stride,
            p.power,
          ]),
        },
      }),
    );
  }

  /** Hands what has been written so far to the output (and waits for it, so a slow compressor holds the reading back). */
  async drain() {
    if (this.pending.length === 0) return;
    const bytes = encoder.encode(`${this.pending.join("\n")}\n`);
    this.pending = [];
    await this.out.write(bytes);
  }
}
