// The whole conversion on an AES-256 encrypted ZIP built in the test: header, batch order, rows and the end line of the import file, and
// the errors a person can run into (wrong password, not a ZIP, not a Huawei export, cancel).

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { convertExport } from "./convert";
import { IMPORT_CONTENT_TYPE, ConvertError } from "./types";
import type { ConvertProgress, ConvertResult } from "./types";
import { buildSyntheticExport, HEALTH_FILE, zipExport } from "./synthetic-export";
import type { ExpectedExport } from "./synthetic-export";

const PASSWORD = "s3cret-Pass é";
const xls = new Uint8Array(
  readFileSync(new URL("./fixtures/sports-health-synthetic.xls", import.meta.url)),
);
const NOW = new Date(2026, 9, 22, 11, 20, 5);
const NAME = "HUAWEI_HEALTH_20261022112019.zip";

async function gunzipLines(blob: Blob): Promise<unknown[]> {
  const text = await new Response(
    blob.stream().pipeThrough(new DecompressionStream("gzip")),
  ).text();
  expect(text.endsWith("\n")).toBe(true);
  return text
    .slice(0, -1)
    .split("\n")
    .map((line) => JSON.parse(line));
}

interface Line {
  t?: string;
  rows?: unknown[][];
  w?: Record<string, unknown> & { points: unknown[][] };
  summary?: Record<string, unknown>;
  profile?: Record<string, unknown>;
}

async function convert(heartRateMinutes: number) {
  const synthetic = buildSyntheticExport({ heartRateMinutes, sportsHealthXls: xls });
  const zip = await zipExport(synthetic.files, PASSWORD);
  const progress: ConvertProgress[] = [];
  const result = await convertExport({
    file: new File([zip], NAME),
    exportName: NAME,
    password: PASSWORD,
    now: NOW,
    onProgress: (p) => progress.push(p),
  });
  const [header, ...lines] = (await gunzipLines(result.blob)) as [
    Record<string, unknown>,
    ...Line[],
  ];
  return { synthetic, result, progress, header, lines };
}

function expectConversion(
  expected: ExpectedExport,
  result: ConvertResult,
  header: Record<string, unknown>,
  lines: Line[],
) {
  expect(header).toEqual({
    format: "joyofit-import",
    version: 1,
    source: "huawei-export",
    createdAt: NOW.getTime(),
    exportName: NAME,
  });
  expect(result.fileName).toBe("joyofit-import-20261022-1120.ndjson.gz");
  // Batch order is the native importer's.
  expect(lines.map((l) => l.t)).toEqual(expected.lineKinds);
  const batches = (kind: string) => lines.filter((l) => l.t === kind).flatMap((l) => l.rows ?? []);
  expect(lines.filter((l) => l.t === "minutes").map((l) => l.rows?.length)).toEqual(
    expected.minuteBatches,
  );
  for (const kind of [
    "minutes",
    "sleep",
    "metrics",
    "sleepScores",
    "queue",
    "weighIns",
    "dayTotals",
  ]) {
    expect(batches(kind)).toHaveLength(expected.rows[kind] as number);
  }
  expect(result.rows).toEqual({ ...expected.rows });

  const workouts = lines.filter((l) => l.t === "workout").map((l) => l.w as NonNullable<Line["w"]>);
  expect(
    workouts.map((w) => ({
      start: w.start,
      sportType: w.sportType,
      sportName: w.sportName,
      distance: w.distance,
      calories: w.calories,
      avgHr: w.avgHr,
      maxHr: w.maxHr,
      points: w.points.length,
    })),
  ).toEqual(expected.workouts);
  for (const w of workouts) {
    expect(typeof w.summaryJson).toBe("string");
    expect(JSON.parse(w.summaryJson as string).source).toBe("huawei-export");
    const times = w.points.map((p) => p[0] as number);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    for (const p of w.points) expect(p).toHaveLength(9);
  }

  const end = lines.at(-1) as Line;
  expect(end.t).toBe("end");
  expect(end.summary).toMatchObject(expected.summary);
  expect(end.summary?.oldestSec).toBe(expected.oldestSec);
  expect(end.summary?.newestSec).toBe(expected.newestSec);
  expect(end.profile).toEqual(expected.profile);
  expect(result.summary).toEqual(end.summary as never);
  expect(result.profile).toEqual(end.profile as never);
}

describe("convertExport", () => {
  test("an encrypted export becomes an import file: header, batches in native order, workouts, end line", async () => {
    const { synthetic, result, header, lines, progress } = await convert(90);
    expectConversion(synthetic.expected, result, header, lines);

    // Rows have the contract's positions.
    const first = lines.find((l) => l.t === "minutes")?.rows?.[0] as unknown[];
    // [ts, steps, calories, distance, heartRate, spo2, restingHeartRate]: minute 0 has heart rate 60 (the first reading of the minute),
    // SpO2 96 and the resting rate 58.
    expect(first).toEqual([1_749_920_400 + 9 * 3600, 0, 0, 0, 60, 96, 58]);
    const sleep = lines.find((l) => l.t === "sleep")?.rows as unknown[][];
    expect(sleep[0]).toEqual([1_749_920_400, 1_749_920_400 + 3600, 0x06, "light"]);
    expect(sleep.map((r) => r[3])).toEqual(["light", "deep", "rem", "awake"]);
    const metrics = lines.find((l) => l.t === "metrics")?.rows as unknown[][];
    expect(metrics[0]).toEqual([
      "emotion",
      1_749_920_400 + 4 * 3600,
      20,
      '{"score":20,"source":"huawei-export"}',
    ]);
    expect(metrics.map((r) => r[0])).toEqual(["emotion", "emotion", "emotion", "hrv"]);
    expect(lines.find((l) => l.t === "sleepScores")?.rows).toEqual([
      [1_749_920_400, 1_749_920_400 + 8 * 3600, 85, 97],
    ]);
    const weighIns = lines.find((l) => l.t === "weighIns")?.rows as unknown[][];
    expect(weighIns[0]?.slice(0, 3)).toEqual([(1_749_920_400 + 7 * 3600) * 1000, 71.5, null]);
    expect(JSON.parse(weighIns[0]?.[3] as string)).toEqual({ bodyFatPct: 21.3, bmi: 24.7 });
    const queue = lines.filter((l) => l.t === "queue");
    expect(queue[0]?.rows?.map((r) => r[0])).toEqual(["meal"]);
    expect(queue[1]?.rows).toEqual([
      ["water", "2025-06-15", '{"date":"2025-06-15","glasses":3}'],
      ["water", "2025-06-16", '{"date":"2025-06-16","glasses":1}'],
    ]);
    const dayTotals = lines.find((l) => l.t === "dayTotals")?.rows as unknown[][];
    expect(dayTotals[0]?.slice(3)).toEqual([1711, 1087, 66726]);

    // Progress: file by file, ends at 1, found counts never go down.
    expect(progress.length).toBeGreaterThan(1);
    const last = progress.at(-1) as ConvertProgress;
    expect(last.fraction).toBe(1);
    expect(last.fileCount).toBe(5);
    expect(last.found).toEqual({
      workouts: 3,
      heartRateMinutes: 90,
      sleepSegments: 4,
      weighIns: 1,
      meals: 1,
      badRecords: 2,
    });
    for (const [i, p] of progress.entries()) {
      if (i > 0)
        expect(p.fraction).toBeGreaterThanOrEqual((progress[i - 1] as ConvertProgress).fraction);
    }
    expect(result.blob.size).toBeGreaterThan(100);
    expect(IMPORT_CONTENT_TYPE).toBe("application/x-joyofit-import+gzip");
  });

  test("more than 20 000 minutes go out in more than one batch, in the native order", async () => {
    const { synthetic, result, header, lines } = await convert(21_000);
    expect(synthetic.expected.minuteBatches).toEqual([20_000, 1000, 30]);
    expectConversion(synthetic.expected, result, header, lines);
    // Everything but heart rate is in the first record, so the first flush carries it, right after its minutes.
    expect(lines.slice(0, 5).map((l) => l.t)).toEqual([
      "minutes",
      "sleep",
      "metrics",
      "queue",
      "weighIns",
    ]);
  });

  test("a wrong password fails before any work", async () => {
    const synthetic = buildSyntheticExport({ sportsHealthXls: xls });
    const zip = await zipExport(synthetic.files, PASSWORD);
    const error = await convertExport({
      file: new File([zip], NAME),
      exportName: NAME,
      password: "wrong",
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConvertError);
    expect((error as ConvertError).kind).toBe("bad_password");
  });

  test("no password for an encrypted ZIP asks for one", async () => {
    const synthetic = buildSyntheticExport({ sportsHealthXls: xls });
    const zip = await zipExport(synthetic.files, PASSWORD);
    const error = await convertExport({
      file: new File([zip], NAME),
      exportName: NAME,
      password: "",
    }).catch((e: unknown) => e);
    expect((error as ConvertError).kind).toBe("password_required");
  });

  test("a file that is not a ZIP is rejected", async () => {
    const error = await convertExport({
      file: new File(["hello, this is not a zip file".repeat(10)], "x.zip"),
      exportName: "x.zip",
      password: "x",
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConvertError);
    expect((error as ConvertError).kind).toBe("not_a_zip");
  });

  test("a ZIP without the Health data folders is not an export", async () => {
    const zip = await zipExport({ "photos/cat.json": "[]", "readme.txt": "hi" }, PASSWORD);
    const error = await convertExport({
      file: new File([zip], "x.zip"),
      exportName: "x.zip",
      password: PASSWORD,
    }).catch((e: unknown) => e);
    expect((error as ConvertError).kind).toBe("not_an_export");
    expect((error as ConvertError).message).toContain("Health detail data");
  });

  test("cancelling stops the run and keeps nothing", async () => {
    const synthetic = buildSyntheticExport({ heartRateMinutes: 21_000, sportsHealthXls: xls });
    const zip = await zipExport(synthetic.files, PASSWORD);
    const controller = new AbortController();
    const error = await convertExport({
      file: new File([zip], NAME),
      exportName: NAME,
      password: PASSWORD,
      signal: controller.signal,
      // After the first file starts, the person presses Cancel.
      onProgress: () => controller.abort(),
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConvertError);
    expect((error as ConvertError).kind).toBe("cancelled");
  });

  test("an already cancelled run never opens the file", async () => {
    const controller = new AbortController();
    controller.abort();
    const error = await convertExport({
      file: new File(["x"], "x.zip"),
      exportName: "x.zip",
      password: "x",
      signal: controller.signal,
    }).catch((e: unknown) => e);
    expect((error as ConvertError).kind).toBe("cancelled");
  });

  test("a damaged member costs that file only", async () => {
    const synthetic = buildSyntheticExport({ sportsHealthXls: xls });
    const zip = new Uint8Array(await (await zipExport(synthetic.files, PASSWORD)).arrayBuffer());
    // Flip bytes in the middle of the first member's data (its local header is 30 bytes + name + AES extra field).
    const at = 30 + HEALTH_FILE.length + 11 + 40;
    for (let i = 0; i < 16; i++) zip[at + i] = (zip[at + i] as number) ^ 0xff;
    const result = await convertExport({
      file: new File([zip], NAME),
      exportName: NAME,
      password: PASSWORD,
      now: NOW,
    });
    expect(result.summary.filesFailed).toBe(1);
    expect(result.summary.filesRead).toBe(4);
    expect(result.summary.workoutsFound).toBe(3);
  });
});
