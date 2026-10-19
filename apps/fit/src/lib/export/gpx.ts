/**
 * One JoyoFit cloud workout as a GPX 1.1 track: a `trkpt` per recorded GPS fix with elevation and time, and the heart
 * rate and cadence of that sample in Garmin's TrackPointExtension v1 (`gpxtpx:hr`, `gpxtpx:cad`), the pair almost every
 * GPX reader (Strava, Komoot, Garmin Connect, GPS Visualizer) understands. Power has no field in that extension; it goes
 * in Garmin's PowerExtension v1 (`gpxpx:PowerInWatts`) beside it, which readers that do not know it skip.
 *
 * Only samples with a GPS fix can be track points (a `trkpt` needs `lat` and `lon`), so heart-rate-only samples between
 * fixes and every sample of an indoor workout are not in the file; the FIT and JSON exports carry them. Cadence is the
 * JoyoFit value: steps per minute on foot, rpm on a bike. Times are UTC (`Z`).
 */

import { decodePoints } from "@joyorogo/api/lib/watch-workout";
import type { WatchWorkoutDoc } from "@joyorogo/api/lib/watch-workout";

import { validFix } from "./fit-activity";

export class NoGpsError extends Error {
  constructor() {
    super("The workout has no GPS track");
    this.name = "NoGpsError";
  }
}

const XML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

// XML 1.0 forbids these code points outright (everything under 0x20 except tab, LF and CR, and U+FFFE / U+FFFF).
// eslint-disable-next-line no-control-regex
const FORBIDDEN_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;

/** Text for an element or attribute: the five XML escapes, and the characters XML 1.0 does not allow dropped. */
export function xmlText(text: string): string {
  return text.replace(FORBIDDEN_XML, "").replace(/[&<>"']/g, (c) => XML_ESCAPES[c] ?? c);
}

/** `2026-09-14T06:12:03Z` from unix seconds. */
export const isoSeconds = (unixSec: number): string =>
  `${new Date(Math.round(unixSec) * 1000).toISOString().slice(0, 19)}Z`;

/** Degrees with 7 decimals (1.1 cm), trailing zeros kept out. */
const deg = (value: number): string => String(Number(value.toFixed(7)));

/** Metres with 1 decimal. */
const metres = (value: number): string => String(Number(value.toFixed(1)));

export function buildGpx(doc: WatchWorkoutDoc): string {
  const { workout, analysis } = doc;
  const fixes = decodePoints(doc.points).filter((p) => validFix(p.lat, p.lon));
  if (fixes.length === 0) throw new NoGpsError();
  const name = analysis?.sport.name ?? workout.sportName;
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="JoyoFit Web" xmlns="http://www.topografix.com/GPX/1/1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1" xmlns:gpxpx="http://www.garmin.com/xmlschemas/PowerExtension/v1" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd http://www.garmin.com/xmlschemas/TrackPointExtension/v1 http://www.garmin.com/xmlschemas/TrackPointExtensionv1.xsd">',
    "  <metadata>",
    `    <name>${xmlText(name)}</name>`,
    `    <time>${isoSeconds(workout.start)}</time>`,
    "  </metadata>",
    "  <trk>",
    `    <name>${xmlText(name)}</name>`,
    "    <trkseg>",
  ];
  for (const p of fixes) {
    const hr = p.hr !== null && p.hr > 0 ? Math.round(p.hr) : null;
    const cad = p.cadence !== null && p.cadence > 0 ? Math.round(p.cadence) : null;
    const power = p.power !== null && p.power > 0 ? Math.round(p.power) : null;
    lines.push(`      <trkpt lat="${deg(p.lat as number)}" lon="${deg(p.lon as number)}">`);
    if (p.alt !== null && Number.isFinite(p.alt)) lines.push(`        <ele>${metres(p.alt)}</ele>`);
    lines.push(`        <time>${isoSeconds(p.ts)}</time>`);
    if (hr !== null || cad !== null || power !== null) {
      lines.push("        <extensions>");
      if (hr !== null || cad !== null) {
        lines.push("          <gpxtpx:TrackPointExtension>");
        if (hr !== null) lines.push(`            <gpxtpx:hr>${hr}</gpxtpx:hr>`);
        if (cad !== null) lines.push(`            <gpxtpx:cad>${cad}</gpxtpx:cad>`);
        lines.push("          </gpxtpx:TrackPointExtension>");
      }
      if (power !== null) {
        lines.push(
          "          <gpxpx:PowerExtension>",
          `            <gpxpx:PowerInWatts>${power}</gpxpx:PowerInWatts>`,
          "          </gpxpx:PowerExtension>",
        );
      }
      lines.push("        </extensions>");
    }
    lines.push("      </trkpt>");
  }
  lines.push("    </trkseg>", "  </trk>", "</gpx>", "");
  return lines.join("\n");
}
