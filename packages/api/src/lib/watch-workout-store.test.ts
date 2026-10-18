import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { call } from "@orpc/server";
import { describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";

// @libsql/client is a transitive dep of @joyorogo/db (see privacy.test.ts).
import { createClient } from "../../../db/node_modules/@libsql/client";
import type { Database } from "@joyorogo/db";

import type { Context } from "../context";
import { watchWorkoutRouter } from "../routers/watch-workout";
import { deleteAllUserData, deleteUserMedia } from "./privacy";
import type { StickersBucket } from "./sticker";
import { WATCH_WORKOUT_DOC_VERSION, WatchWorkoutDocError, decodePoints, encodePoints, readDoc, summarize, watchBlobKey } from "./watch-workout";
import type { WatchPoint, WatchWorkoutDoc } from "./watch-workout";
import { WatchWorkoutRefusal, cloudUnlocked, getBlob, putWorkout } from "./watch-workout-store";
import type { WorkoutAnalysis } from "./workout-analysis";

const client = createClient({ url: ":memory:" });
const migrationsDir = join(import.meta.dir, "../../../db/src/migrations");
for (const file of readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort()) {
  await client.executeMultiple(readFileSync(join(migrationsDir, file), "utf8"));
}
await client.executeMultiple(`
  INSERT INTO "user" (id, name, email, tier) VALUES
    ('pro', 'Pro', 'pro@test.id', 'founder'),
    ('other', 'Other', 'other@test.id', 'founder'),
    ('free', 'Free', 'free@test.id', 'free');
`);
const db = drizzle(client) as unknown as Database;

/** In-memory R2: only what the store calls. */
function fakeBucket() {
  const objects = new Map<string, ArrayBuffer>();
  const bucket: StickersBucket = {
    async put(key, value) {
      objects.set(key, value as ArrayBuffer);
    },
    async get(key) {
      const body = objects.get(key);
      return body ? { body: new Blob([body]).stream(), size: body.byteLength, arrayBuffer: async () => body } : null;
    },
    async delete(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) objects.delete(key);
    },
    async list({ prefix }) {
      return { objects: [...objects.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })), truncated: false };
    },
  };
  return { bucket, objects };
}

async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const START = 1_792_300_000;

function analysis(start: number, over: Partial<WorkoutAnalysis> = {}): WorkoutAnalysis {
  return {
    v: 1,
    sport: { name: "Jalan", kind: "walk" },
    startedAt: start * 1000,
    elapsedSec: 1526,
    movingSec: 1526,
    distanceM: 2010,
    elevation: { gainM: 24, lossM: 22, minM: 10, maxM: 31 },
    series: null,
    splits: [],
    laps: [],
    hrZones: null,
    paceZones: null,
    bestEfforts: [],
    effort: null,
    load: null,
    calories: { kcal: 143, fatG: null, carbG: null },
    comparison: null,
    stats: {
      avgHr: 127,
      maxHr: 156,
      minHr: 90,
      avgPaceSecKm: 760,
      bestPaceSecKm: 700,
      avgSpeedMs: 1.3,
      maxSpeedMs: 1.5,
      avgCad: 106,
      maxCad: 120,
      avgPower: null,
      maxPower: null,
      normalizedPower: null,
      avgStrideM: null,
    },
    ...over,
  };
}

const POINTS: WatchPoint[] = [
  { ts: START, lat: -7.98412345, lon: 112.63012345, alt: 450.37, hr: 98, speed: 1.234, cadence: 104, stride: 0.71, power: null },
  { ts: START + 1, lat: -7.98412999, lon: 112.63013999, alt: 450.41, hr: null, speed: 1.3, cadence: 106, stride: 0.72, power: null },
  { ts: START + 1, lat: null, lon: null, alt: null, hr: 101, speed: null, cadence: null, stride: null, power: 180 },
  { ts: START + 5, lat: -7.9841, lon: 112.6301, alt: 450, hr: 103, speed: 0, cadence: 0, stride: null, power: null },
];

function doc(over: { start?: number; analysis?: WorkoutAnalysis | null; engineRev?: number; points?: WatchPoint[]; complete?: boolean } = {}): WatchWorkoutDoc {
  const start = over.start ?? START;
  return {
    v: WATCH_WORKOUT_DOC_VERSION,
    engineRev: over.engineRev ?? 2,
    workout: {
      workoutNumber: 7,
      start,
      end: start + 1526,
      sportType: 13,
      sportName: "Jalan",
      duration: 1523,
      distance: 2010,
      calories: 143,
      avgHr: 127,
      maxHr: 156,
      steps: 2672,
      complete: over.complete ?? true,
      imported: false,
      summaryJson: '{"gps":"ok"}',
    },
    points: encodePoints(over.points ?? POINTS),
    analysis: over.analysis === undefined ? analysis(start) : over.analysis,
  };
}

const pack = (d: WatchWorkoutDoc | unknown) => gzip(JSON.stringify(d));

describe("point columns", () => {
  test("round trip keeps every field, gaps and same-second points in order", () => {
    const back = decodePoints(encodePoints(POINTS));
    expect(back).toHaveLength(POINTS.length);
    for (const [i, p] of POINTS.entries()) {
      const got = back[i]!;
      expect(got.ts).toBe(p.ts);
      for (const key of ["lat", "lon"] as const) {
        const want = p[key];
        expect(got[key]).toEqual(want === null ? null : expect.closeTo(want, 6));
      }
      expect(got.alt).toEqual(p.alt === null ? null : expect.closeTo(p.alt, 2));
      expect(got.hr).toBe(p.hr);
      expect(got.speed).toEqual(p.speed === null ? null : expect.closeTo(p.speed, 3));
      expect(got.cadence).toBe(p.cadence);
      expect(got.stride).toEqual(p.stride === null ? null : expect.closeTo(p.stride, 3));
      expect(got.power).toBe(p.power);
    }
  });

  test("a column with no value is null and nothing at all is null", () => {
    const cols = encodePoints(POINTS.map((p) => ({ ...p, power: null })));
    expect(cols?.power).toBeNull();
    expect(encodePoints([])).toBeNull();
    expect(decodePoints(null)).toEqual([]);
  });

  test("deltas stay small, so gzip has little to store", () => {
    const track: WatchPoint[] = Array.from({ length: 3600 }, (_, i) => ({
      ts: START + i,
      lat: -7.98 + i * 0.000009,
      lon: 112.63 + i * 0.000004,
      alt: 450 + Math.sin(i / 60) * 5,
      hr: 120 + (i % 20),
      speed: 2.5,
      cadence: 160,
      stride: 1,
      power: null,
    }));
    const cols = encodePoints(track)!;
    expect(Math.max(...cols.dts)).toBe(1);
    expect(Math.max(...cols.lat!.slice(1).map((v) => Math.abs(v!)))).toBeLessThan(200);
  });
});

describe("document", () => {
  test("reads a valid document and derives every list number from the analysis", async () => {
    const parsed = await readDoc(await pack(doc()));
    const s = summarize(parsed);
    expect(s).toMatchObject({
      start: START,
      sportKind: "walk",
      elapsedSec: 1526,
      movingSec: 1526,
      distanceM: 2010,
      elevGainM: 24,
      elevLossM: 22,
      avgHr: 127,
      maxHr: 156,
      pointCount: 4,
      hasGps: true,
      hasAnalysis: true,
      engineRev: 2,
    });
  });

  test("without an analysis the row falls back to the watch's own numbers", async () => {
    const s = summarize(await readDoc(await pack(doc({ analysis: null, engineRev: 0 }))));
    expect(s).toMatchObject({ hasAnalysis: false, sportKind: "other", movingSec: 1523, elapsedSec: 1526, distanceM: 2010, elevGainM: null });
  });

  test("refuses what is not a document", async () => {
    await expect(readDoc(new TextEncoder().encode("plain text"))).rejects.toMatchObject({ code: "bad_gzip" });
    await expect(readDoc(await gzip("{nope"))).rejects.toMatchObject({ code: "bad_json" });
    await expect(readDoc(await pack({ v: 2 }))).rejects.toMatchObject({ code: "bad_doc" });
    const short = doc();
    short.points!.hr = [1, 2];
    await expect(readDoc(await pack(short))).rejects.toMatchObject({ code: "bad_doc" });
  });

  test("an analysis the strict schema rejects, or one of another workout, is refused", async () => {
    const broken = analysis(START, { movingSec: -5 });
    await expect(readDoc(await pack(doc({ analysis: broken })))).rejects.toMatchObject({ code: "analysis_invalid" });
    await expect(readDoc(await pack(doc({ analysis: analysis(START + 9999) })))).rejects.toMatchObject({ code: "analysis_mismatch" });
  });

  test("a document that expands past the ceiling is stopped while reading", async () => {
    const huge = await gzip(" ".repeat(31_000_000));
    expect(huge.byteLength).toBeLessThan(200_000);
    await expect(readDoc(huge)).rejects.toBeInstanceOf(WatchWorkoutDocError);
    await expect(readDoc(huge)).rejects.toMatchObject({ code: "too_large" });
  });
});

describe("storing", () => {
  test("first upload creates, the same bytes change nothing, different bytes replace (version up)", async () => {
    const { bucket, objects } = fakeBucket();
    const body = await pack(doc({ start: START + 100, analysis: analysis(START + 100) }));
    const first = await putWorkout(db, bucket, "pro", START + 100, body);
    expect(first).toMatchObject({ status: "created", version: 1, start: START + 100 });
    expect(objects.has(watchBlobKey("pro", START + 100))).toBe(true);

    expect(await putWorkout(db, bucket, "pro", START + 100, body)).toMatchObject({ status: "unchanged", version: 1 });

    const edited = await pack(doc({ start: START + 100, analysis: analysis(START + 100, { distanceM: 2015 }), engineRev: 3 }));
    const second = await putWorkout(db, bucket, "pro", START + 100, edited);
    expect(second).toMatchObject({ status: "updated", version: 2 });

    const rows = await client.execute("select distance_m, engine_rev, version from watch_workout where user_id='pro' and start=" + (START + 100));
    expect(rows.rows[0]).toMatchObject({ distance_m: 2015, engine_rev: 3, version: 2 });
    const stored = await getBlob(db, bucket, "pro", START + 100);
    expect(Array.from(new Uint8Array(stored!))).toEqual(Array.from(edited));
  });

  test("the address must be the document's own start", async () => {
    const { bucket } = fakeBucket();
    const body = await pack(doc({ start: START + 200, analysis: analysis(START + 200) }));
    await expect(putWorkout(db, bucket, "pro", START + 201, body)).rejects.toMatchObject({ code: "bad_doc" });
  });

  test("two accounts with the same start keep their own workouts", async () => {
    const { bucket } = fakeBucket();
    const a = await pack(doc({ start: START + 300, analysis: analysis(START + 300) }));
    const b = await pack(doc({ start: START + 300, analysis: analysis(START + 300, { distanceM: 9999 }) }));
    await putWorkout(db, bucket, "pro", START + 300, a);
    await putWorkout(db, bucket, "other", START + 300, b);
    const rows = await client.execute("select user_id, distance_m from watch_workout where start=" + (START + 300) + " order by user_id");
    expect(rows.rows.map((r: Record<string, unknown>) => [r.user_id, r.distance_m])).toEqual([
      ["other", 9999],
      ["pro", 2010],
    ]);
    expect(await getBlob(db, bucket, "other", START + 999)).toBeNull();
  });

  test("the Pro gate is the account's tier", async () => {
    expect(await cloudUnlocked(db, {}, "pro")).toBe(true);
    expect(await cloudUnlocked(db, { FREE_DAILY_SCANS: "3", FOUNDER_DAILY_CAP: "100" }, "free")).toBe(false);
    expect(await cloudUnlocked(db, { FREE_DAILY_SCANS: "3", FOUNDER_DAILY_CAP: "100" }, "pro")).toBe(true);
  });
});

const as = (userId: string, bucket: StickersBucket) =>
  ({
    context: {
      db,
      env: { STICKERS: bucket, FREE_DAILY_SCANS: "3", FOUNDER_DAILY_CAP: "100" },
      locale: "id",
      waitUntil: () => {},
      session: { user: { id: userId } },
    } as unknown as Context,
  });

describe("router", () => {
  test("list is newest first and paged; changes pull in change order and carry deletes; remove leaves a tombstone that refuses uploads", async () => {
    const { bucket } = fakeBucket();
    const base = START + 10_000;
    for (let i = 0; i < 3; i++) await putWorkout(db, bucket, "other", base + i * 100, await pack(doc({ start: base + i * 100, analysis: analysis(base + i * 100) })));

    const list = await call(watchWorkoutRouter.list, {}, as("other", bucket));
    expect(list.items.map((i) => i.start).filter((s) => s >= base)).toEqual([base + 200, base + 100, base]);
    expect(list.nextCursor).toBeNull();

    const first = await call(watchWorkoutRouter.changes, { since: null }, as("other", bucket));
    const mine = first.items.filter((i) => i.start >= base);
    expect(mine.map((i) => i.start)).toEqual([base, base + 100, base + 200]);
    expect(first.hasMore).toBe(false);

    const removed = await call(watchWorkoutRouter.remove, { start: base + 100 }, as("other", bucket));
    expect(removed).toEqual({ removed: true });
    expect(await call(watchWorkoutRouter.remove, { start: base + 100 }, as("other", bucket))).toEqual({ removed: false });

    const after = await call(watchWorkoutRouter.changes, { since: first.cursor }, as("other", bucket));
    expect(after.items).toHaveLength(1);
    expect(after.items[0]).toMatchObject({ start: base + 100, blobBytes: 0 });
    expect(after.items[0]?.deletedAt).not.toBeNull();

    const listed = await call(watchWorkoutRouter.list, {}, as("other", bucket));
    expect(listed.items.map((i) => i.start)).not.toContain(base + 100);
    await expect(call(watchWorkoutRouter.detail, { start: base + 100 }, as("other", bucket))).rejects.toThrow();

    const body = await pack(doc({ start: base + 100, analysis: analysis(base + 100) }));
    await expect(putWorkout(db, bucket, "other", base + 100, body)).rejects.toBeInstanceOf(WatchWorkoutRefusal);
  });

  test("detail returns the analysis; status counts what is stored; a stranger sees nothing", async () => {
    const { bucket } = fakeBucket();
    const start = START + 20_000;
    await putWorkout(db, bucket, "pro", start, await pack(doc({ start, analysis: analysis(start) })));
    const detail = await call(watchWorkoutRouter.detail, { start }, as("pro", bucket));
    expect(detail.analysis?.distanceM).toBe(2010);
    expect(detail.item).toMatchObject({ start, hasAnalysis: true });

    const status = await call(watchWorkoutRouter.status, {}, as("pro", bucket));
    expect(status.unlocked).toBe(true);
    expect(status.count).toBeGreaterThan(0);
    expect(status.bytes).toBeGreaterThan(0);

    await expect(call(watchWorkoutRouter.detail, { start }, as("free", bucket))).rejects.toThrow();
    expect((await call(watchWorkoutRouter.list, {}, as("free", bucket))).items).toEqual([]);
  });

  test("wipe removes rows and documents, leaves no tombstone, and a later upload works again", async () => {
    const { bucket, objects } = fakeBucket();
    const start = START + 30_000;
    await putWorkout(db, bucket, "free", start, await pack(doc({ start, analysis: analysis(start) })));
    expect(objects.size).toBe(1);
    expect(await call(watchWorkoutRouter.wipe, {}, as("free", bucket))).toEqual({ deleted: 1 });
    expect(objects.size).toBe(0);
    expect((await call(watchWorkoutRouter.changes, { since: null }, as("free", bucket))).items).toEqual([]);
    expect(await putWorkout(db, bucket, "free", start, await pack(doc({ start, analysis: analysis(start) })))).toMatchObject({ status: "created" });
  });

  test("deleting the account's data takes the rows and the documents", async () => {
    const { bucket, objects } = fakeBucket();
    const start = START + 40_000;
    await putWorkout(db, bucket, "other", start, await pack(doc({ start, analysis: analysis(start) })));
    await deleteAllUserData(db, "other");
    await deleteUserMedia(bucket, "other", []);
    const rows = await client.execute("select count(*) as n from watch_workout where user_id='other'");
    expect(rows.rows[0].n).toBe(0);
    expect([...objects.keys()].filter((k) => k.includes("/other/"))).toEqual([]);
  });
});
