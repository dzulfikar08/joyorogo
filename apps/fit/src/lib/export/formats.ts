/**
 * The three export formats of one cloud workout, from its stored document: what is in each file is described at the top
 * of `gpx.ts`, `fit-activity.ts` and `workout-json.ts`.
 */

import type { WatchWorkoutDoc } from "@joyorogo/api/lib/watch-workout";

import { buildFit } from "./fit-activity";
import { buildGpx } from "./gpx";
import { buildWorkoutJson } from "./workout-json";

export const EXPORT_FORMATS = ["gpx", "fit", "json"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export interface ExportFile {
  name: string;
  bytes: Uint8Array;
  mime: string;
}

const MIME: Record<ExportFormat, string> = {
  gpx: "application/gpx+xml",
  fit: "application/vnd.ant.fit",
  json: "application/json",
};

const WIB_OFFSET_MS = 7 * 3_600_000;

/** `joyofit-20260914-0612-run`: WIB date and time of the start (the app shows every day in WIB) and the sport. */
export function fileBase(doc: WatchWorkoutDoc): string {
  const stamp = new Date(doc.workout.start * 1000 + WIB_OFFSET_MS).toISOString();
  const sport = (doc.analysis?.sport.name ?? doc.workout.sportName)
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return `joyofit-${stamp.slice(0, 10).replaceAll("-", "")}-${stamp.slice(11, 16).replace(":", "")}-${sport || "workout"}`;
}

export function buildExport(
  doc: WatchWorkoutDoc,
  format: ExportFormat,
  now: Date = new Date(),
): ExportFile {
  const name = `${fileBase(doc)}.${format}`;
  const mime = MIME[format];
  switch (format) {
    case "gpx":
      return { name, mime, bytes: new TextEncoder().encode(buildGpx(doc)) };
    case "fit":
      return { name, mime, bytes: buildFit(doc).bytes };
    case "json":
      return { name, mime, bytes: new TextEncoder().encode(buildWorkoutJson(doc, now)) };
  }
}
