/**
 * Bulk export: many workouts, one format, fetched one after the other (the API and the browser's memory both prefer a
 * queue to a burst), with progress and a cancel. The result is the list of files; the caller puts several of them in one
 * ZIP. A workout that fails (deleted meanwhile, an unreadable document, no GPS for a GPX) is reported and skipped, but a
 * sign-out ends the run: every later fetch would fail the same way.
 */

import type { WatchWorkoutDoc } from "@joyorogo/api/lib/watch-workout";

import { buildExport } from "./formats";
import type { ExportFile, ExportFormat } from "./formats";
import { NoGpsError } from "./gpx";
import { SourceError } from "./source";

/** One archive holds at most this many workouts: the files stay in memory until the ZIP is built. */
export const BULK_LIMIT = 100;

export interface BulkItem {
  start: number;
  /** From the list row: lets a GPX export skip an indoor workout without fetching its document. */
  hasGps: boolean;
}

export type BulkProblem = "no_gps" | "not_found" | "unreadable" | "unavailable" | "network";

export interface BulkProgress {
  /** Workouts handled so far (exported, skipped or failed). */
  done: number;
  total: number;
  exported: number;
}

export interface BulkResult {
  files: ExportFile[];
  problems: { start: number; problem: BulkProblem }[];
  cancelled: boolean;
  /** The session ended: nothing after this point could be fetched. */
  unauthorized: boolean;
}

const aborted = (signal: AbortSignal | undefined) => signal?.aborted === true;

/** What went wrong with one workout, in the words the page has copy for. */
function problemOf(error: unknown): BulkProblem {
  if (error instanceof NoGpsError) return "no_gps";
  if (
    error instanceof SourceError &&
    error.kind !== "bad_document" &&
    error.kind !== "unauthorized"
  )
    return error.kind;
  return "unreadable";
}

export async function runBulk(options: {
  items: readonly BulkItem[];
  format: ExportFormat;
  load: (start: number, signal?: AbortSignal) => Promise<WatchWorkoutDoc>;
  signal?: AbortSignal;
  onProgress?: (progress: BulkProgress) => void;
  now?: Date;
}): Promise<BulkResult> {
  const { items, format, load, signal, onProgress } = options;
  const result: BulkResult = { files: [], problems: [], cancelled: false, unauthorized: false };
  const names = new Set<string>();
  const report = (done: number) =>
    onProgress?.({ done, total: items.length, exported: result.files.length });
  report(0);
  for (const [index, item] of items.entries()) {
    if (aborted(signal)) {
      result.cancelled = true;
      break;
    }
    if (format === "gpx" && !item.hasGps) {
      result.problems.push({ start: item.start, problem: "no_gps" });
      report(index + 1);
      continue;
    }
    try {
      const file = buildExport(await load(item.start, signal), format, options.now);
      // Two workouts in the same minute of the same sport must not overwrite each other in the archive.
      let name = file.name;
      for (let n = 2; names.has(name); n++) name = file.name.replace(/(\.[a-z]+)$/, `-${n}$1`);
      names.add(name);
      result.files.push({ ...file, name });
    } catch (error) {
      if (aborted(signal) || (error instanceof DOMException && error.name === "AbortError")) {
        result.cancelled = true;
        break;
      }
      if (error instanceof SourceError && error.kind === "unauthorized") {
        result.unauthorized = true;
        break;
      }
      result.problems.push({ start: item.start, problem: problemOf(error) });
    }
    report(index + 1);
  }
  return result;
}
