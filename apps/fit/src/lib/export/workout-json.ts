/**
 * One JoyoFit cloud workout as one JSON document: everything the cloud keeps of it, with the points decoded from their
 * column form into one object per sample (units as in `WatchPoint`: unix seconds, degrees, metres, m/s, steps per
 * minute, watts). It is the stored document made readable, not a new schema: `workout` is the watch's record
 * (`summaryJson` stays the watch's own JSON text), `summary` the numbers of the list row, `analysis` the full
 * `WorkoutAnalysis` (series, splits, laps, zones, best efforts, effort, load) or null.
 */

import { decodePoints, summarize } from "@joyorogo/api/lib/watch-workout";
import type { WatchWorkoutDoc } from "@joyorogo/api/lib/watch-workout";

export const WORKOUT_JSON_FORMAT = "joyofit-workout";
export const WORKOUT_JSON_VERSION = 1;

/** The document text: top-level keys on their own lines and one sample per line, so a diff or a `grep` stays usable. */
export function buildWorkoutJson(doc: WatchWorkoutDoc, now: Date = new Date()): string {
  const points = decodePoints(doc.points);
  const indent = (text: string) => text.replaceAll("\n", "\n  ");
  const parts: [string, string][] = [
    ["format", JSON.stringify(WORKOUT_JSON_FORMAT)],
    ["version", String(WORKOUT_JSON_VERSION)],
    ["exportedAt", JSON.stringify(now.toISOString())],
    ["engineRev", String(doc.engineRev)],
    ["workout", indent(JSON.stringify(doc.workout, null, 2))],
    ["summary", indent(JSON.stringify(summarize(doc), null, 2))],
    ["analysis", doc.analysis ? indent(JSON.stringify(doc.analysis)) : "null"],
    [
      "points",
      points.length === 0
        ? "[]"
        : `[\n${points.map((p) => `    ${JSON.stringify(p)}`).join(",\n")}\n  ]`,
    ],
  ];
  return `{\n${parts.map(([key, value]) => `  ${JSON.stringify(key)}: ${value}`).join(",\n")}\n}\n`;
}
