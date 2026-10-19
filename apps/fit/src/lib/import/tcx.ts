import type { WatchPoint } from "@joyorogo/api/lib/watch-workout";

import { type ImportError, type ImportLap, type ParsedActivity } from "./types";
import { finalizeTrack, sportFromName } from "./track";
import { all, first, numberOf, parseXml, secondsOf, textOf } from "./xml";

/**
 * Garmin Training Center XML. The first `<Activity>` is the workout: its `<Lap>`s hold the totals and a `<Track>` of
 * `<Trackpoint>`s each. Heart rate is `HeartRateBpm/Value`; cadence is `Cadence` (bike) or the extension's `RunCadence`
 * (per leg); power is the extension's `Watts`; speed the extension's `Speed`.
 */
export function parseTcx(text: string): ParsedActivity | ImportError {
  const doc = parseXml(text);
  if (!doc || doc.documentElement.localName !== "TrainingCenterDatabase")
    return { ok: false, reason: "bad-xml" };
  const activity = first(doc, "Activity");
  if (!activity) return { ok: false, reason: "no-session" };

  const points: WatchPoint[] = [];
  const laps: ImportLap[] = [];
  let calories = 0;
  let timer = 0;
  let distance = 0;
  let startTs: number | null = null;
  for (const lap of all(activity, "Lap")) {
    const lapStart = secondsOf(lap.getAttribute("StartTime"));
    const total = numberOf(lap, "TotalTimeSeconds");
    const lapDistance = numberOf(lap, "DistanceMeters");
    calories += numberOf(lap, "Calories") ?? 0;
    timer += total ?? 0;
    distance += lapDistance ?? 0;
    if (lapStart !== null) {
      startTs = startTs === null ? lapStart : Math.min(startTs, lapStart);
      const avg = first(lap, "AverageHeartRateBpm");
      const max = first(lap, "MaximumHeartRateBpm");
      const cad = numberOf(lap, "Cadence");
      if (total !== null && total > 0) {
        laps.push({
          startTs: lapStart,
          endTs: Math.round(lapStart + total),
          distanceM: lapDistance !== null && lapDistance > 0 ? lapDistance : null,
          avgHr: avg ? numberOf(avg, "Value") : null,
          maxHr: max ? numberOf(max, "Value") : null,
          avgCadence: cad !== null && cad > 0 ? cad : null,
        });
      }
    }
    for (const tp of all(lap, "Trackpoint")) {
      const ts = secondsOf(textOf(tp, "Time"));
      if (ts === null) continue;
      const position = first(tp, "Position");
      const lat = position ? numberOf(position, "LatitudeDegrees") : null;
      const lon = position ? numberOf(position, "LongitudeDegrees") : null;
      const hrBox = first(tp, "HeartRateBpm");
      const hr = hrBox ? numberOf(hrBox, "Value") : null;
      const cad = numberOf(tp, "RunCadence") ?? numberOf(tp, "Cadence");
      const watts = numberOf(tp, "Watts");
      const speed = numberOf(tp, "Speed");
      points.push({
        ts,
        lat:
          lat !== null &&
          lon !== null &&
          Math.abs(lat) <= 90 &&
          Math.abs(lon) <= 180 &&
          !(lat === 0 && lon === 0)
            ? lat
            : null,
        lon:
          lat !== null &&
          lon !== null &&
          Math.abs(lat) <= 90 &&
          Math.abs(lon) <= 180 &&
          !(lat === 0 && lon === 0)
            ? lon
            : null,
        alt: numberOf(tp, "AltitudeMeters"),
        hr: hr !== null && hr > 0 && hr < 255 ? Math.round(hr) : null,
        speed: speed !== null && speed >= 0 ? speed : null,
        cadence: cad !== null && cad >= 0 ? Math.round(cad) : null,
        stride: null,
        power: watts !== null && watts >= 0 ? Math.round(watts) : null,
      });
    }
  }
  return finalizeTrack({
    format: "tcx",
    sport: sportFromName(activity.getAttribute("Sport")),
    name: null,
    points,
    laps,
    calories,
    timerSeconds: timer,
    distance,
    startTs,
  });
}
