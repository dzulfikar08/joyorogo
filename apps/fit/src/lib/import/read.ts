// Picks the reader for a file by its extension, then by what is inside, and reads it.

import { parseFit } from "./fit";
import { parseGpx } from "./gpx";
import { parseTcx } from "./tcx";
import { type ImportError, type ImportFormat, type ParsedActivity } from "./types";

/** A workout file is a few MB at most (a day-long ride at 1 Hz is under 10 MB); this stops a wrong file before it is read. */
export const MAX_FILE_BYTES = 60 * 1024 * 1024;

export const ACCEPTED_EXTENSIONS = [".fit", ".gpx", ".tcx"] as const;

/** `.fit` bytes carry ".FIT" at offset 8 of the header; XML starts with `<` after optional whitespace or a BOM. */
export function sniff(bytes: Uint8Array): ImportFormat | null {
  if (
    bytes.length >= 12 &&
    bytes[8] === 0x2e &&
    bytes[9] === 0x46 &&
    bytes[10] === 0x49 &&
    bytes[11] === 0x54
  )
    return "fit";
  const head = new TextDecoder()
    .decode(bytes.subarray(0, 2048))
    .replace(/^\uFEFF/, "")
    .trimStart();
  if (!head.startsWith("<")) return null;
  if (/<gpx[\s>]/i.test(head)) return "gpx";
  if (/<TrainingCenterDatabase[\s>]/.test(head)) return "tcx";
  return null;
}

function formatOf(name: string, bytes: Uint8Array): ImportFormat | null {
  const ext = name.toLowerCase().slice(name.lastIndexOf("."));
  const sniffed = sniff(bytes);
  if (sniffed) return sniffed;
  // A .fit that is not FIT (a renamed file) is reported as such, not as "unsupported".
  return ext === ".fit" ? "fit" : null;
}

export function readWorkoutFile(name: string, bytes: Uint8Array): ParsedActivity | ImportError {
  if (bytes.byteLength === 0) return { ok: false, reason: "empty" };
  if (bytes.byteLength > MAX_FILE_BYTES) return { ok: false, reason: "too-large" };
  const format = formatOf(name, bytes);
  if (format === "fit") return parseFit(bytes);
  if (format === "gpx") return parseGpx(new TextDecoder().decode(bytes));
  if (format === "tcx") return parseTcx(new TextDecoder().decode(bytes));
  return { ok: false, reason: "unsupported" };
}
