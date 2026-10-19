import type { WatchPoint } from "@joyorogo/api/lib/watch-workout";

import { type ImportError, type ParsedActivity } from "./types";
import { finalizeTrack, sportFromName } from "./track";
import { all, first, numberOf, parseXml, secondsOf, textOf } from "./xml";

/**
 * GPX 1.0 / 1.1: every `<trkpt>` of every `<trk>` and `<trkseg>` is a point. Heart rate, cadence and power come from
 * the Garmin TrackPointExtension (`hr`, `cad`) or the usual vendor tags (`power`, `watts`). A point needs a time.
 */
export function parseGpx(text: string): ParsedActivity | ImportError {
  const doc = parseXml(text);
  if (!doc || doc.documentElement.localName !== "gpx") return { ok: false, reason: "bad-xml" };
  const track = first(doc, "trk");
  const points: WatchPoint[] = [];
  for (const pt of all(doc, "trkpt")) {
    const ts = secondsOf(textOf(pt, "time"));
    const lat = Number(pt.getAttribute("lat"));
    const lon = Number(pt.getAttribute("lon"));
    if (
      ts === null ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      Math.abs(lat) > 90 ||
      Math.abs(lon) > 180
    )
      continue;
    const hr = numberOf(pt, "hr");
    const cad = numberOf(pt, "cad");
    const power = numberOf(pt, "power") ?? numberOf(pt, "watts");
    points.push({
      ts,
      lat,
      lon,
      alt: numberOf(pt, "ele"),
      hr: hr !== null && hr > 0 && hr < 255 ? Math.round(hr) : null,
      speed: null,
      cadence: cad !== null && cad >= 0 ? Math.round(cad) : null,
      stride: null,
      power: power !== null && power >= 0 ? Math.round(power) : null,
    });
  }
  const sport = sportFromName((track ? textOf(track, "type") : null) ?? textOf(doc, "type"));
  return finalizeTrack({
    format: "gpx",
    sport,
    name: track ? textOf(track, "name") : null,
    points,
  });
}
