import { describe, expect, test } from "bun:test";
import { Encoder, Profile } from "@garmin/fitsdk";
import type { FitWebWorkout } from "@joyorogo/api/lib/fit-web";
import { decodePoints, readDoc } from "@joyorogo/api/lib/watch-workout";
import { workoutAnalysisSchema } from "@joyorogo/api/lib/workout-analysis-schema";
import { Window } from "happy-dom";

// The readers use the browser's DOMParser; bun has none.
const win = new Window();
(globalThis as { DOMParser?: unknown }).DOMParser = win.DOMParser;

import { maxHrFromAge } from "./analysis";
import { prepareFile } from "./pipeline";
import { findCollision } from "./collision";
import { buildDoc } from "./doc";
import { isImportError, type ParsedActivity } from "./types";
import { readWorkoutFile, sniff } from "./read";

const START = Date.UTC(2026, 9, 10, 23, 0, 0) / 1000; // 2026-10-11 06:00 WIB
const HR_OPTIONS = { maxHr: 185, maxHrSource: "age" as const };

/** The SDK types a message loosely; the fields below are the real FIT field names. */
const send = (encoder: Encoder, num: number, fields: object) =>
  encoder.onMesg(num, fields as never);

/** A 40 minute run along a street: 1 point per 5 s, 3.0 m/s, 150 bpm drifting up, 85 strides per minute, two laps. */
function fitRun(opts: { type?: string; sport?: string; withRecords?: boolean } = {}): Uint8Array {
  const enc = new Encoder();
  const t = (sec: number) => new Date((START + sec) * 1000);
  send(enc, Profile.MesgNum.FILE_ID, {
    type: opts.type ?? "activity",
    manufacturer: "garmin",
    product: 1,
    timeCreated: t(0),
  });
  const total = 2400;
  if (opts.withRecords !== false) {
    for (let s = 0; s <= total; s += 5) {
      send(enc, Profile.MesgNum.RECORD, {
        timestamp: t(s),
        positionLat: Math.round(((-7.98 + s * 0.00002) * 2 ** 31) / 180),
        positionLong: Math.round((112.63 * 2 ** 31) / 180),
        altitude: 440 + 10 * Math.sin(s / 300),
        heartRate: 140 + Math.round(s / 100),
        cadence: 85,
        distance: s * 3,
        speed: 3,
      });
    }
  }
  for (let n = 0; n < 2; n++) {
    send(enc, Profile.MesgNum.LAP, {
      timestamp: t((n + 1) * 1200),
      startTime: t(n * 1200),
      totalElapsedTime: 1200,
      totalTimerTime: 1200,
      totalDistance: 3600,
      avgHeartRate: 150 + n,
      maxHeartRate: 160,
    });
  }
  send(enc, Profile.MesgNum.SESSION, {
    timestamp: t(total),
    startTime: t(0),
    totalElapsedTime: total,
    totalTimerTime: total,
    totalDistance: 7200,
    totalCalories: 450,
    sport: opts.sport ?? "running",
    subSport: "generic",
    avgHeartRate: 155,
    maxHeartRate: 168,
    totalAscent: 25,
    totalDescent: 24,
  });
  return enc.close();
}

function activity(bytes: Uint8Array, name = "run.fit"): ParsedActivity {
  const result = readWorkoutFile(name, bytes);
  if (isImportError(result)) throw new Error(`import failed: ${result.reason}`);
  return result;
}

describe("FIT", () => {
  test("a run is read with its session totals, points and laps; running cadence counts steps", () => {
    const a = activity(fitRun());
    expect(a.format).toBe("fit");
    expect(a.sport.kind).toBe("RUNNING");
    expect(a.name).toBe("Run (Garmin)");
    expect(a.start).toBe(START);
    expect(a.end).toBe(START + 2400);
    expect(a.distance).toBe(7200);
    expect(a.timerSeconds).toBe(2400);
    expect(a.calories).toBe(450);
    expect(a.avgHr).toBe(155);
    expect(a.maxHr).toBe(168);
    expect(a.ascent).toBe(25);
    expect(a.points).toHaveLength(481);
    expect(a.points[0]).toMatchObject({ hr: 140, cadence: 170 });
    expect(a.points[0]?.lat).toBeCloseTo(-7.98, 4);
    expect(a.laps).toHaveLength(2);
    expect(a.laps[1]).toMatchObject({ distanceM: 3600, avgHr: 151 });
  });

  test("a cycling file is a ride, its cadence stays in rpm", () => {
    const a = activity(fitRun({ sport: "cycling" }));
    expect(a.sport.kind).toBe("CYCLING");
    expect(a.points[0]?.cadence).toBe(85);
  });

  test("failures are values: not FIT, damaged, not an activity, no session", () => {
    expect(
      readWorkoutFile("a.fit", new TextEncoder().encode("hello, this is not a fit file at all")),
    ).toEqual({ ok: false, reason: "not-fit" });
    const bytes = fitRun();
    const damaged = bytes.slice();
    damaged[40] = (damaged[40] as number) ^ 0xff;
    expect(readWorkoutFile("a.fit", damaged)).toEqual({ ok: false, reason: "corrupt" });
    expect(readWorkoutFile("a.fit", fitRun({ type: "settings" }))).toEqual({
      ok: false,
      reason: "not-activity",
    });
    const noSession = new Encoder();
    send(noSession, Profile.MesgNum.FILE_ID, {
      type: "activity",
      manufacturer: "garmin",
      product: 1,
      timeCreated: new Date(START * 1000),
    });
    expect(readWorkoutFile("a.fit", noSession.close())).toEqual({
      ok: false,
      reason: "no-session",
    });
  });

  test("empty and oversized files and other formats are refused before parsing", () => {
    expect(readWorkoutFile("a.fit", new Uint8Array())).toEqual({ ok: false, reason: "empty" });
    expect(readWorkoutFile("notes.txt", new TextEncoder().encode("plain text"))).toEqual({
      ok: false,
      reason: "unsupported",
    });
  });
});

const GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">
  <trk><name>Pagi di Malang</name><type>running</type><trkseg>
${Array.from({ length: 121 }, (_, i) => {
  const time = new Date((START + i * 10) * 1000).toISOString();
  return `    <trkpt lat="${(-7.98 + i * 0.00005).toFixed(6)}" lon="112.630000"><ele>${(440 + (i % 10)).toFixed(1)}</ele><time>${time}</time><extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>${130 + (i % 30)}</gpxtpx:hr><gpxtpx:cad>85</gpxtpx:cad></gpxtpx:TrackPointExtension></extensions></trkpt>`;
}).join("\n")}
  </trkseg></trk>
</gpx>`;

describe("GPX", () => {
  test("track points become points; distance and speed are worked out; the name and sport come from the track", () => {
    const a = activity(new TextEncoder().encode(GPX), "morning.gpx");
    expect(a.format).toBe("gpx");
    expect(a.name).toBe("Pagi di Malang");
    expect(a.sport.kind).toBe("RUNNING");
    expect(a.start).toBe(START);
    expect(a.end).toBe(START + 1200);
    expect(a.points).toHaveLength(121);
    // 120 steps of 0.00005 degrees of latitude: about 667 m.
    expect(a.distance).toBeGreaterThan(640);
    expect(a.distance).toBeLessThan(700);
    expect(a.points[10]?.speed).toBeGreaterThan(0.4);
    expect(a.points[0]?.hr).toBe(130);
    // Running cadence that never passes 120 is per leg: doubled to steps.
    expect(a.points[0]?.cadence).toBe(170);
    expect(a.timerSeconds).toBe(1200);
  });

  test("not XML, XML that is not GPX, and a track without times are refused", () => {
    expect(readWorkoutFile("a.gpx", new TextEncoder().encode("<gpx><trk>"))).toMatchObject({
      ok: false,
    });
    expect(
      readWorkoutFile(
        "a.gpx",
        new TextEncoder().encode(
          '<?xml version="1.0"?><gpx><trk><trkseg><trkpt lat="1" lon="2"/></trkseg></trk></gpx>',
        ),
      ),
    ).toEqual({ ok: false, reason: "no-points" });
  });
});

const TCX = `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2" xmlns:ns3="http://www.garmin.com/xmlschemas/ActivityExtension/v2">
  <Activities><Activity Sport="Biking"><Id>${new Date(START * 1000).toISOString()}</Id>
${[0, 1]
  .map(
    (
      lap,
    ) => `    <Lap StartTime="${new Date((START + lap * 300) * 1000).toISOString()}"><TotalTimeSeconds>300</TotalTimeSeconds><DistanceMeters>2000</DistanceMeters><Calories>60</Calories>
      <AverageHeartRateBpm><Value>140</Value></AverageHeartRateBpm><MaximumHeartRateBpm><Value>160</Value></MaximumHeartRateBpm><Track>
${Array.from({ length: 31 }, (_, i) => {
  const s = lap * 300 + i * 10;
  return `        <Trackpoint><Time>${new Date((START + s) * 1000).toISOString()}</Time><Position><LatitudeDegrees>${(-7.98 + s * 0.00006).toFixed(6)}</LatitudeDegrees><LongitudeDegrees>112.63</LongitudeDegrees></Position><AltitudeMeters>450</AltitudeMeters><DistanceMeters>${s * 6.6}</DistanceMeters><HeartRateBpm><Value>${140 + (i % 5)}</Value></HeartRateBpm><Cadence>88</Cadence><Extensions><ns3:TPX><ns3:Watts>210</ns3:Watts></ns3:TPX></Extensions></Trackpoint>`;
}).join("\n")}
      </Track></Lap>`,
  )
  .join("\n")}
  </Activity></Activities>
</TrainingCenterDatabase>`;

describe("TCX", () => {
  test("laps give the totals and the laps; trackpoints the samples with heart rate, cadence and watts", () => {
    const a = activity(new TextEncoder().encode(TCX), "ride.tcx");
    expect(a.format).toBe("tcx");
    expect(a.sport.kind).toBe("CYCLING");
    expect(a.timerSeconds).toBe(600);
    expect(a.distance).toBe(4000);
    expect(a.calories).toBe(120);
    expect(a.laps).toHaveLength(2);
    expect(a.laps[0]).toMatchObject({ distanceM: 2000, avgHr: 140, maxHr: 160 });
    expect(a.points[0]).toMatchObject({ hr: 140, cadence: 88, power: 210 });
    expect(a.avgPower).toBe(210);
  });
});

describe("sniff", () => {
  test("tells the formats apart by content, whatever the extension", () => {
    expect(sniff(fitRun())).toBe("fit");
    expect(sniff(new TextEncoder().encode(GPX))).toBe("gpx");
    expect(sniff(new TextEncoder().encode(TCX))).toBe("tcx");
    expect(sniff(new TextEncoder().encode("\uFEFF  <gpx version='1.1'>"))).toBe("gpx");
    expect(sniff(new TextEncoder().encode("<html></html>"))).toBeNull();
    expect(readWorkoutFile("renamed.txt", fitRun())).toMatchObject({ format: "fit" });
  });
});

describe("the document", () => {
  test("a FIT run becomes a document the server accepts, with an analysis the strict schema accepts", async () => {
    const built = await buildDoc(activity(fitRun()), HR_OPTIONS);
    if ("ok" in built) throw new Error(built.reason);
    expect(built.start).toBe(START);
    expect(built.hasAnalysis).toBe(true);
    const doc = await readDoc(built.gzip);
    expect(doc.workout).toMatchObject({
      imported: true,
      workoutNumber: 0,
      sportName: "Run (Garmin)",
      distance: 7200,
      duration: 2400,
      steps: 0,
    });
    expect(decodePoints(doc.points)).toHaveLength(481);
    const analysis = doc.analysis;
    expect(analysis).not.toBeNull();
    expect(workoutAnalysisSchema.safeParse(analysis).success).toBe(true);
    expect(analysis?.sport).toEqual({ name: "Run (Garmin)", kind: "run" });
    expect(analysis?.startedAt).toBe(START * 1000);
    expect(analysis?.distanceM).toBe(7200);
    expect(analysis?.series?.n).toBe(601);
    expect(analysis?.series?.stepSec).toBe(4);
    expect(analysis?.series?.track?.[0]).not.toBeNull();
    expect(analysis?.series?.cad?.[0]).toBe(170);
    expect(analysis?.laps).toHaveLength(2);
    // 7.2 km at 3 m/s: 8 splits (7 whole kilometres and one of 200 m), the whole ones at 5:33 per km.
    expect(analysis?.splits).toHaveLength(8);
    expect(analysis?.splits[0]?.paceSecKm).toBeCloseTo(333.3, 0);
    expect(analysis?.splits[7]?.distM).toBe(200);
    expect(analysis?.stats.avgPaceSecKm).toBeCloseTo(333.3, 0);
    expect(analysis?.hrZones?.maxHr).toBe(185);
    expect(analysis?.hrZones?.sec.reduce((a, b) => a + b, 0)).toBeGreaterThan(2300);
    expect(analysis?.effort?.strain).toBeGreaterThan(5);
    // The 1 km best effort of a steady 3 m/s run is about 333 s.
    expect(analysis?.bestEfforts.find((e) => e.key === "1k")?.sec).toBeCloseTo(333, -1);
    expect(analysis?.comparison).toBeNull();
    expect(analysis?.load).toBeNull();
  });

  test("GPX and TCX files become valid documents too", async () => {
    for (const [name, text] of [
      ["a.gpx", GPX],
      ["a.tcx", TCX],
    ] as const) {
      const built = await buildDoc(activity(new TextEncoder().encode(text), name), HR_OPTIONS);
      if ("ok" in built) throw new Error(`${name}: ${built.reason}`);
      expect(built.hasAnalysis).toBe(true);
      expect((await readDoc(built.gzip)).analysis?.series?.track?.length).toBeGreaterThan(1);
    }
  });

  test("a file with no records still imports from its session, without an analysis", async () => {
    const built = await buildDoc(activity(fitRun({ withRecords: false })), HR_OPTIONS);
    if ("ok" in built) throw new Error(built.reason);
    expect(built.hasAnalysis).toBe(false);
    const doc = await readDoc(built.gzip);
    expect(doc.points).toBeNull();
    expect(doc.workout.distance).toBe(7200);
  });

  test("maximum heart rate follows the app's age rule, clamped", () => {
    expect(maxHrFromAge(null)).toBe(185);
    expect(maxHrFromAge(40)).toBe(180);
    expect(maxHrFromAge(5)).toBe(215);
    expect(maxHrFromAge(120)).toBe(120);
  });
});

describe("collisions with what the account already has", () => {
  const stored = (start: number, elapsedSec: number): FitWebWorkout => ({
    start,
    date: "2026-10-11",
    sportName: "Outdoor Run",
    sportKind: "run",
    elapsedSec,
    movingSec: elapsedSec,
    distanceM: 5000,
    elevGainM: 0,
    avgHr: 150,
    maxHr: 170,
    calories: 300,
    hasGps: true,
    hasAnalysis: true,
    imported: false,
  });
  const file = { start: START, end: START + 2400 };

  test("the same start is a duplicate (the cloud would replace it)", () => {
    expect(findCollision(file, [stored(START, 1800)])).toMatchObject({ kind: "duplicate" });
  });

  test("a stored workout over most of the file's span is an overlap; a small touch or a neighbour is not", () => {
    expect(findCollision(file, [stored(START + 60, 2300)])).toMatchObject({ kind: "overlap" });
    expect(findCollision(file, [stored(START + 2200, 1800)])).toBeNull();
    expect(findCollision(file, [stored(START - 5000, 1800)])).toBeNull();
    expect(findCollision(file, [])).toBeNull();
  });
});

describe("prepareFile", () => {
  const fileOf = (name: string, bytes: Uint8Array) => ({
    name,
    size: bytes.byteLength,
    arrayBuffer: async () => bytes.slice().buffer as ArrayBuffer,
  });
  const none = async () => [];

  test("a good file is ready, with the existing-workout lookup asked for the days around it", async () => {
    const asked: [string, string][] = [];
    const prepared = await prepareFile(
      fileOf("run.fit", fitRun()),
      HR_OPTIONS,
      async (from, to) => {
        asked.push([from, to]);
        return [];
      },
    );
    expect(prepared.kind).toBe("ready");
    // START is 2026-10-11 06:00 WIB and the run lasts 40 minutes.
    expect(asked).toEqual([["2026-10-10", "2026-10-12"]]);
    if (prepared.kind === "ready") expect(prepared.collision).toBeNull();
  });

  test("a stored workout with the same start makes it a duplicate, not an upload", async () => {
    const stored = {
      start: START,
      date: "2026-10-11",
      sportName: "x",
      sportKind: "run",
      elapsedSec: 2400,
      movingSec: 2400,
      distanceM: 1,
      elevGainM: 0,
      avgHr: 1,
      maxHr: 1,
      calories: 1,
      hasGps: true,
      hasAnalysis: true,
      imported: false,
    };
    const prepared = await prepareFile(fileOf("run.fit", fitRun()), HR_OPTIONS, async () => [
      stored,
    ]);
    expect(prepared).toMatchObject({ kind: "ready", collision: { kind: "duplicate" } });
  });

  test("bad files fail with the reason and never ask the server", async () => {
    let asked = false;
    const lookup = async () => {
      asked = true;
      return [];
    };
    expect(
      await prepareFile(fileOf("a.txt", new TextEncoder().encode("hi")), HR_OPTIONS, lookup),
    ).toEqual({ kind: "failed", reason: "unsupported" });
    expect(
      await prepareFile(
        { name: "big.fit", size: 61 * 1024 * 1024, arrayBuffer: async () => new ArrayBuffer(0) },
        HR_OPTIONS,
        lookup,
      ),
    ).toEqual({ kind: "failed", reason: "too-large" });
    expect(asked).toBe(false);
    expect(await prepareFile(fileOf("a.fit", fitRun()), HR_OPTIONS, none)).toMatchObject({
      kind: "ready",
    });
  });
});
