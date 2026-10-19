import { describe, expect, test } from "bun:test";

import {
  WATCH_WORKOUT_DOC_VERSION,
  decodePoints,
  parseDoc,
  summarize,
} from "@joyorogo/api/lib/watch-workout";

import { buildExport, fileBase } from "./formats";
import { START, indoorDoc, rideDoc, runDoc } from "./fixtures";
import { NoGpsError } from "./gpx";
import { WORKOUT_JSON_FORMAT, WORKOUT_JSON_VERSION, buildWorkoutJson } from "./workout-json";

describe("fixtures are real documents", () => {
  test("every fixture passes the server's own validation", () => {
    for (const doc of [runDoc(), rideDoc(), indoorDoc()]) {
      expect(parseDoc(JSON.parse(JSON.stringify(doc))).v).toBe(WATCH_WORKOUT_DOC_VERSION);
    }
  });
});

describe("fileBase", () => {
  test("WIB date and time of the start, and the sport", () => {
    // START is 2026-09-14 06:12:03 WIB.
    expect(fileBase(runDoc())).toBe("joyofit-20260914-0612-run");
  });

  test("accents and symbols fold to a safe name, an unusable name becomes workout", () => {
    const doc = runDoc();
    doc.analysis = null;
    doc.workout.sportName = "Lari Pagi / Çafé";
    expect(fileBase(doc)).toBe("joyofit-20260914-0612-lari-pagi-cafe");
    doc.workout.sportName = "跑步";
    expect(fileBase(doc)).toBe("joyofit-20260914-0612-workout");
  });
});

describe("buildWorkoutJson", () => {
  const doc = runDoc();
  const now = new Date("2026-10-19T03:00:00Z");
  const parsed = JSON.parse(buildWorkoutJson(doc, now)) as Record<string, unknown>;

  test("carries the whole document: record, summary, analysis and every decoded point", () => {
    expect(parsed.format).toBe(WORKOUT_JSON_FORMAT);
    expect(parsed.version).toBe(WORKOUT_JSON_VERSION);
    expect(parsed.exportedAt).toBe("2026-10-19T03:00:00.000Z");
    expect(parsed.workout).toEqual(doc.workout);
    expect(parsed.summary).toEqual(JSON.parse(JSON.stringify(summarize(doc))));
    expect(parsed.analysis).toEqual(JSON.parse(JSON.stringify(doc.analysis)));
    expect(parsed.points).toEqual(JSON.parse(JSON.stringify(decodePoints(doc.points))));
    expect((parsed.points as unknown[]).length).toBe(600);
  });

  test("a document without analysis or points writes null and an empty list", () => {
    const bare = indoorDoc();
    bare.analysis = null;
    bare.points = null;
    const out = JSON.parse(buildWorkoutJson(bare, now)) as Record<string, unknown>;
    expect(out.analysis).toBeNull();
    expect(out.points).toEqual([]);
  });

  test("one sample per line", () => {
    const lines = buildWorkoutJson(doc, now).split("\n");
    expect(lines.filter((line) => line.startsWith('    {"ts":')).length).toBe(600);
  });
});

describe("buildExport", () => {
  test("names, types and bytes of each format", () => {
    const doc = rideDoc();
    const gpx = buildExport(doc, "gpx");
    const fit = buildExport(doc, "fit");
    const json = buildExport(doc, "json");
    expect(gpx.name).toBe("joyofit-20260915-0612-ride.gpx");
    expect(fit.name).toBe("joyofit-20260915-0612-ride.fit");
    expect(json.name).toBe("joyofit-20260915-0612-ride.json");
    expect(gpx.mime).toBe("application/gpx+xml");
    expect(new TextDecoder().decode(gpx.bytes.subarray(0, 5))).toBe("<?xml");
    expect(String.fromCharCode(...fit.bytes.subarray(8, 12))).toBe(".FIT");
    expect(new TextDecoder().decode(json.bytes.subarray(0, 1))).toBe("{");
  });

  test("GPX of an indoor workout is refused, FIT and JSON are not", () => {
    const doc = indoorDoc();
    expect(() => buildExport(doc, "gpx")).toThrow(NoGpsError);
    expect(buildExport(doc, "fit").bytes.length).toBeGreaterThan(100);
    expect(buildExport(doc, "json").bytes.length).toBeGreaterThan(100);
    expect(START).toBeGreaterThan(0);
  });
});
