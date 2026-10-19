/**
 * What the buttons call: fetch the stored document(s) from the API, build the file(s) in the browser, download. It is
 * the one module the pages load on demand (`import("@/lib/export/run")`), so the encoders, the schema validation and the
 * ZIP writer stay out of the main bundle until someone exports.
 */

import { SERVER_URL } from "../env";
import { runBulk } from "./bulk";
import type { BulkItem, BulkProgress, BulkResult } from "./bulk";
import { downloadFile } from "./download";
import { buildExport } from "./formats";
import type { ExportFormat } from "./formats";
import { fetchWorkoutDoc } from "./source";
import { ZIP_MAX_ENTRIES, zip } from "./zip";

/** Downloads one workout; resolves to the file's name. Throws `SourceError` or `NoGpsError`. */
export async function exportWorkout(start: number, format: ExportFormat): Promise<string> {
  const file = buildExport(await fetchWorkoutDoc(start, { baseUrl: SERVER_URL }), format);
  downloadFile(file);
  return file.name;
}

export type BulkOutcome = Pick<BulkResult, "problems" | "cancelled" | "unauthorized"> & {
  /** Files built. One is downloaded as it is, several as one ZIP, none is nothing. */
  files: number;
  /** The files would not fit one ZIP without zip64. */
  tooBig: boolean;
};

export async function exportWorkouts(options: {
  items: readonly BulkItem[];
  format: ExportFormat;
  /** Date window the archive name carries: `from` and `to` as `YYYY-MM-DD`. */
  from: string;
  to: string;
  signal: AbortSignal;
  onProgress: (progress: BulkProgress) => void;
  onZipping: () => void;
}): Promise<BulkOutcome> {
  const result = await runBulk({
    items: options.items,
    format: options.format,
    load: (start, signal) => fetchWorkoutDoc(start, { baseUrl: SERVER_URL, signal }),
    signal: options.signal,
    onProgress: options.onProgress,
  });
  const outcome: BulkOutcome = {
    problems: result.problems,
    cancelled: result.cancelled,
    unauthorized: result.unauthorized,
    files: result.files.length,
    tooBig: false,
  };
  // A cancel or a sign-out downloads nothing: half an archive would look like the whole export.
  const [only] = result.files;
  if (result.cancelled || result.unauthorized || !only) return outcome;
  if (result.files.length === 1) {
    downloadFile(only);
    return outcome;
  }
  options.onZipping();
  try {
    if (result.files.length > ZIP_MAX_ENTRIES) throw new RangeError("too many files");
    const bytes = zip(result.files.map((file) => ({ name: file.name, data: file.bytes })));
    downloadFile({
      name: `joyofit-export-${options.from}_${options.to}-${options.format}.zip`,
      mime: "application/zip",
      bytes,
    });
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return { ...outcome, tooBig: true };
  }
  return outcome;
}
