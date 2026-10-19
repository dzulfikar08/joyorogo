import { describe, expect, test } from "bun:test";

import { Decoder, Stream } from "@garmin/fitsdk";
import { decodePoints } from "@joyorogo/api/lib/watch-workout";

import { buildFit, fitSportOf, validFix, withDistance } from "./fit-activity";
import { FitWriter, fitCrc, toFitTime, toSemicircles } from "./fit-encoder";
import { START, indoorDoc, rideDoc, runDoc } from "./fixtures";

/** The fields of the decoded messages these tests read (the SDK returns loosely typed records). */
interface Msg {
  timestamp: Date;
  startTime: Date;
  type?: string;
  sport?: string;
  subSport?: string;
  positionLat?: number;
  positionLong?: number;
  enhancedAltitude: number;
  enhancedSpeed: number;
  enhancedMaxSpeed: number;
  heartRate?: number;
  cadence: number;
  fractionalCadence?: number;
  power?: number;
  distance?: number;
  totalDistance: number;
  totalElapsedTime: number;
  totalTimerTime: number;
  totalCalories: number;
  totalAscent: number;
  totalDescent: number;
  totalStrides?: number;
  avgHeartRate: number;
  maxHeartRate: number;
  avgPower: number;
  maxPower: number;
  normalizedPower: number;
  numLaps: number;
  messageIndex: number;
}

function decode(bytes: Uint8Array) {
  const decoder = new Decoder(Stream.fromByteArray(Array.from(bytes)));
  expect(decoder.isFIT()).toBe(true);
  expect(decoder.checkIntegrity()).toBe(true);
  const { messages, errors } = decoder.read();
  expect(errors).toEqual([]);
  return messages as {
    fileIdMesgs: Msg[];
    recordMesgs: Msg[];
    lapMesgs: Msg[];
    sessionMesgs: Msg[];
    activityMesgs: Msg[];
    eventMesgs: Msg[];
  };
}

const seconds = (date: Date) => Math.round(date.getTime() / 1000);
/** The SDK hands positions back in semicircles. */
const degrees = (semicircles: number) => (semicircles * 180) / 2 ** 31;

describe("FitWriter", () => {
  test("the header and file CRC verify", () => {
    const writer = new FitWriter();
    const def = writer.define(0, 0, [{ num: 0, type: "enum" }]);
    writer.write(def, [4]);
    const bytes = writer.finish();
    expect(bytes[0]).toBe(14);
    expect(String.fromCharCode(...bytes.subarray(8, 12))).toBe(".FIT");
    expect(fitCrc(bytes, 0, bytes.length - 2)).toBe(
      bytes[bytes.length - 2]! | (bytes[bytes.length - 1]! << 8),
    );
  });

  test("FIT time and semicircles", () => {
    expect(toFitTime(631_065_600)).toBe(0);
    expect(toSemicircles(180)).toBe(2 ** 31);
  });
});

describe("buildFit: a run with GPS, heart rate, cadence and laps", () => {
  const doc = runDoc();
  const built = buildFit(doc);
  const fit = decode(built.bytes);
  const points = decodePoints(doc.points);

  test("one record per recorded sample, in order, with the same time, position, altitude, heart rate and speed", () => {
    expect(built.samples).toBe(points.length);
    expect(fit.recordMesgs).toHaveLength(points.length);
    fit.recordMesgs.forEach((record, i) => {
      const p = points[i]!;
      expect(seconds(record.timestamp)).toBe(p.ts);
      expect(record.heartRate).toBe(p.hr as number);
      if (p.lat === null || p.lon === null) {
        expect(record.positionLat).toBeUndefined();
        expect(record.positionLong).toBeUndefined();
      } else {
        expect(degrees(record.positionLat as number)).toBeCloseTo(p.lat, 6);
        expect(degrees(record.positionLong as number)).toBeCloseTo(p.lon, 6);
        // Altitude is stored in 0.2 m steps.
        expect(Math.abs(record.enhancedAltitude - (p.alt as number))).toBeLessThanOrEqual(
          0.1 + 1e-6,
        );
        expect(record.enhancedSpeed).toBeCloseTo(3, 3);
      }
    });
  });

  test("cadence is steps per minute in JoyoFit and per leg in FIT, the odd step in the fraction", () => {
    fit.recordMesgs.forEach((record, i) => {
      const steps = points[i]!.cadence as number;
      expect(record.cadence + (record.fractionalCadence ?? 0)).toBeCloseTo(steps / 2, 6);
    });
  });

  test("distance grows with the track and ends at the watch's total", () => {
    const distances = fit.recordMesgs.map((r) => r.distance as number | undefined);
    // Before the first fix there is no path yet: 0 m.
    expect(distances[0]).toBe(0);
    for (let i = 1; i < distances.length; i++)
      expect(distances[i]!).toBeGreaterThanOrEqual(distances[i - 1]!);
    expect(distances[distances.length - 1]).toBeCloseTo(1800, 1);
  });

  test("laps: the watch's three laps with their own totals", () => {
    expect(fit.lapMesgs).toHaveLength(3);
    fit.lapMesgs.forEach((lap, i) => {
      expect(seconds(lap.startTime)).toBe(START + i * 200);
      expect(lap.totalDistance).toBeCloseTo(600, 1);
      expect(lap.avgHeartRate).toBe(140 + i * 10);
      expect(lap.maxHeartRate).toBe(150 + i * 10);
      expect(lap.messageIndex).toBe(i);
      expect(lap.sport).toBe("running");
    });
    expect(fit.lapMesgs[0]!.totalElapsedTime).toBe(200);
  });

  test("session: the watch's totals", () => {
    const [session] = fit.sessionMesgs;
    expect(fit.sessionMesgs).toHaveLength(1);
    expect(session!.sport).toBe("running");
    expect(seconds(session!.startTime)).toBe(START);
    expect(session!.totalElapsedTime).toBe(599);
    expect(session!.totalTimerTime).toBe(599);
    expect(session!.totalDistance).toBeCloseTo(1800, 1);
    expect(session!.totalCalories).toBe(112);
    expect(session!.avgHeartRate).toBe(150);
    expect(session!.maxHeartRate).toBe(171);
    expect(session!.totalAscent).toBe(14);
    expect(session!.totalDescent).toBe(9);
    expect(session!.totalStrides).toBe(850);
    expect(session!.numLaps).toBe(3);
    expect(fit.activityMesgs[0]!.totalTimerTime).toBe(599);
    expect(fit.fileIdMesgs[0]!.type).toBe("activity");
  });
});

describe("buildFit: a ride with power", () => {
  const doc = rideDoc();
  const fit = decode(buildFit(doc).bytes);
  const points = decodePoints(doc.points);

  test("power and cadence come back as recorded, cadence is not halved on a bike", () => {
    expect(fit.recordMesgs).toHaveLength(points.length);
    fit.recordMesgs.forEach((record, i) => {
      expect(record.power).toBe(points[i]!.power as number);
      expect(record.cadence).toBe(85);
      expect(record.fractionalCadence).toBeUndefined();
    });
  });

  test("one lap for the whole ride, session carries power and speed", () => {
    expect(fit.lapMesgs).toHaveLength(1);
    const [session] = fit.sessionMesgs;
    expect(session!.sport).toBe("cycling");
    expect(session!.avgPower).toBe(200);
    expect(session!.maxPower).toBe(249);
    expect(session!.normalizedPower).toBe(205);
    expect(session!.totalDistance).toBeCloseTo(2250, 1);
    expect(session!.enhancedMaxSpeed).toBeCloseTo(9, 3);
    expect(session!.totalStrides).toBeUndefined();
  });
});

describe("buildFit: an indoor run without GPS or analysis", () => {
  const doc = indoorDoc();
  const fit = decode(buildFit(doc).bytes);

  test("records carry heart rate and speed, no position, and the speed-based distance ends at the total", () => {
    expect(fit.recordMesgs).toHaveLength(120);
    expect(fit.recordMesgs.every((r) => r.positionLat === undefined)).toBe(true);
    expect(fit.recordMesgs[0]!.heartRate).toBe(110);
    expect(fit.recordMesgs[119]!.distance).toBeCloseTo(595, 1);
  });

  test("session from the watch's record: treadmill, elapsed and active time", () => {
    const [session] = fit.sessionMesgs;
    expect(session!.sport).toBe("running");
    expect(session!.subSport).toBe("treadmill");
    expect(session!.totalElapsedTime).toBe(238);
    expect(session!.totalCalories).toBe(30);
  });
});

describe("pause: active time shorter than elapsed by 30 s or more becomes the timer time", () => {
  test("a 50 s pause", () => {
    const doc = runDoc();
    doc.workout.duration = 549;
    const [session] = decode(buildFit(doc).bytes).sessionMesgs;
    expect(session!.totalElapsedTime).toBe(599);
    expect(session!.totalTimerTime).toBe(549);
  });
});

describe("helpers", () => {
  test("sport: the watch's type first, then the analysis kind, then training", () => {
    expect(fitSportOf(5, "run")).toEqual([1, 1]);
    expect(fitSportOf(9999, "ride")).toEqual([2, 0]);
    expect(fitSportOf(9999, "other")).toEqual([10, 0]);
  });

  test("a fix is on the globe and not (0, 0)", () => {
    expect(validFix(-6.2, 106.8)).toBe(true);
    expect(validFix(0, 0)).toBe(false);
    expect(validFix(91, 0)).toBe(false);
    expect(validFix(null, 1)).toBe(false);
  });

  test("distance without a path or speed is left out", () => {
    const samples = [0, 1, 2].map((i) => ({
      ts: i,
      lat: null,
      lon: null,
      alt: null,
      hr: 100,
      speed: null,
      cadence: null,
      power: null,
      distance: null as number | null,
    }));
    withDistance(samples, 100);
    expect(samples.every((s) => s.distance === null)).toBe(true);
  });
});
