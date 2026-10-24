import { d1TestDb } from "@joyorogo/db/test-d1";
import { garminAccount } from "@joyorogo/db/schema/fitness";
import { eq } from "drizzle-orm";
import { describe, expect, test } from "bun:test";

import {
  GarminGrantError,
  connectGarmin,
  deleteImportedData,
  disconnectGarmin,
  freshToken,
  garminStatus,
  mintToken,
  tokenExpiry,
} from "./garmin-grant";
import { shiftDate } from "./engine";
import {
  BACKFILL_ACTIVITY_START,
  BACKFILL_PAGES,
  GarminSyncError,
  dayChunks,
  externalIdOf,
  syncGarmin,
  syncPlan,
} from "./garmin-sync";
import { parseActivities } from "./garmin-parse";

const ZONE = "Asia/Jakarta";
const NOW = new Date("2026-10-24T05:00:00Z");
const KEY = "pk-live-SECRET-1234567890";

const { client, db } = await d1TestDb();

let counter = 0;
async function newUser(): Promise<string> {
  counter += 1;
  const id = `garmin-u${counter}`;
  await client.execute({ sql: `INSERT INTO "user" (id, name, email) VALUES (?, ?, ?)`, args: [id, id, `${id}@test.id`] });
  return id;
}

const b64 = (value: unknown) => btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
/** A bearer JWT the way Garmin's token endpoint answers: header.payload.signature, `exp` in seconds. */
const jwt = (expiresAt: Date, tag = "a") => `${b64({ alg: "RS256" })}.${b64({ exp: Math.floor(expiresAt.getTime() / 1000), tag })}.sig`;

async function rows(table: string, userId: string, source?: string) {
  const result = await client.execute({
    sql: `SELECT * FROM ${table} WHERE user_id = ? ${source ? "AND source = ?" : ""} ORDER BY date`,
    args: source ? [userId, source] : [userId],
  });
  return result.rows as unknown as Array<Record<string, string | number | null>>;
}

async function insertExercise(userId: string, row: { date: string; type: string; durationMin: number; source: string; externalId: string }) {
  await client.execute({
    sql: `INSERT INTO exercise_log (id, user_id, date, type, name, duration_min, kcal, source, external_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [crypto.randomUUID(), userId, row.date, row.type, "x", row.durationMin, 100, row.source, row.externalId],
  });
}

// ---- A fake Garmin: the token endpoint and the three data endpoints in one fetch ----

type Fake = {
  fetcher: (url: string, init?: RequestInit) => Promise<Response>;
  mints: string[];
  calls: Array<{ path: string; params: URLSearchParams; auth: string }>;
};

type FakeOptions = {
  activities?: unknown[];
  weights?: unknown;
  summaries?: unknown;
  /** keys the token endpoint accepts */
  validKeys?: string[];
  /** bearer tokens the data endpoints accept; others get 401 */
  validTokens?: (token: string) => boolean;
  tokenExpiresAt?: Date;
  outage?: boolean;
};

function fakeGarmin(options: FakeOptions = {}): Fake {
  const fake: Fake = { fetcher: async () => new Response(), mints: [], calls: [] };
  let minted = 0;
  fake.fetcher = async (url, init) => {
    const parsed = new URL(url);
    const auth = new Headers(init?.headers).get("authorization") ?? "";
    if (parsed.pathname.endsWith("/personal-api-key/token")) {
      expect(init?.method).toBe("POST");
      const key = auth.replace("ApiKey ", "");
      fake.mints.push(key);
      if (options.outage) return new Response("down", { status: 503 });
      if (!(options.validKeys ?? [KEY]).includes(key)) return new Response(null, { status: 401 });
      minted += 1;
      return new Response(jwt(options.tokenExpiresAt ?? new Date(NOW.getTime() + 24 * 3_600_000), `t${minted}`), { status: 200 });
    }
    fake.calls.push({ path: parsed.pathname, params: parsed.searchParams, auth });
    if (options.validTokens && !options.validTokens(auth.replace("Bearer ", ""))) return new Response(null, { status: 401 });
    if (options.outage) return new Response("down", { status: 503 });
    if (parsed.pathname.endsWith("/activities/search/activities")) {
      const start = Number(parsed.searchParams.get("start"));
      const limit = Number(parsed.searchParams.get("limit"));
      return Response.json((options.activities ?? []).slice(start, start + limit));
    }
    if (parsed.pathname.includes("/weight-service/weight/range/")) return Response.json(options.weights ?? { dailyWeightSummaries: [] });
    if (parsed.pathname.endsWith("/dailysummaries")) {
      // Only the days inside the requested range, as Garmin answers.
      const from = parsed.searchParams.get("startDate")!;
      const to = parsed.searchParams.get("endDate")!;
      const data = ((options.summaries as { data?: Array<{ calendarDate: string }> } | undefined)?.data ?? []).filter((d) => d.calendarDate >= from && d.calendarDate <= to);
      return Response.json({ data });
    }
    return new Response(null, { status: 404 });
  };
  return fake;
}

const activity = (id: number, typeKey: string, local: string, durationSec: number, calories: number | null, bmrCalories: number | null) => ({
  activityId: id,
  activityType: { typeKey },
  startTimeLocal: local,
  startTimeGMT: local,
  duration: durationSec,
  calories,
  bmrCalories,
});

const ACTIVITIES = [
  activity(1001, "walking", "2026-10-23 06:50:57", 1487, 145, 41),
  activity(1002, "treadmill_running", "2026-10-22 09:38:26", 1420, 228, 40),
  activity(1003, "paddelball", "2026-10-20 07:13:42", 2410, 387, 46),
];

const weighIn = (date: string, grams: number) => ({ summaryDate: date, latestWeight: { calendarDate: date, weight: grams } });
const summary = (date: string, steps: number) => ({
  calendarDate: date,
  includesWellnessData: true,
  movement: { steps: { value: steps, distanceInMeters: steps * 0.7 } },
  calories: { burnedActive: 150 },
  intensityMinutes: { moderate: 5, vigorous: 2 },
});

async function connected(options: FakeOptions = {}, extra: Partial<typeof garminAccount.$inferInsert> = {}) {
  const userId = await newUser();
  const fake = fakeGarmin(options);
  await connectGarmin(db, userId, KEY, { now: NOW }, fake.fetcher);
  if (Object.keys(extra).length > 0) await db.update(garminAccount).set(extra).where(eq(garminAccount.userId, userId));
  return { userId, fake };
}

const run = (userId: string, fake: Fake, now = NOW) => syncGarmin({ db, userId, zone: ZONE, locale: "id", now, fetcher: fake.fetcher });

describe("connect and token", () => {
  test("a wrong key is refused with a typed error and stores nothing", async () => {
    const userId = await newUser();
    const fake = fakeGarmin();
    const error = await connectGarmin(db, userId, "wrong-key-123456", { now: NOW }, fake.fetcher).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GarminGrantError);
    expect((error as GarminGrantError).failure).toBe("rejected");
    expect((error as Error).message).not.toContain("wrong-key");
    expect(await garminStatus(db, userId)).toEqual({ connected: false });
    expect(await db.select().from(garminAccount).where(eq(garminAccount.userId, userId))).toHaveLength(0);
  });

  test("an outage while connecting is 'unavailable', not a bad key", async () => {
    const userId = await newUser();
    const error = await connectGarmin(db, userId, KEY, { now: NOW }, fakeGarmin({ outage: true }).fetcher).catch((e: unknown) => e);
    expect((error as GarminGrantError).failure).toBe("unavailable");
  });

  test("a good key stores the key, the token and its own expiry; the status carries no secret", async () => {
    const expires = new Date(NOW.getTime() + 24 * 3_600_000);
    const { userId, fake } = await connected({ tokenExpiresAt: expires });
    const [row] = await db.select().from(garminAccount).where(eq(garminAccount.userId, userId));
    expect(row).toMatchObject({ authKind: "personal_key", apiKey: KEY });
    expect(row!.tokenExpiresAt!.getTime()).toBe(Math.floor(expires.getTime() / 1000) * 1000);
    const status = await garminStatus(db, userId);
    expect(status.connected).toBe(true);
    expect(JSON.stringify(status)).not.toContain(KEY);
    expect(JSON.stringify(status)).not.toContain(row!.token!);
    expect(fake.mints).toEqual([KEY]);
  });

  test("reconnecting with a new key replaces the key and keeps the sync history", async () => {
    const { userId } = await connected({}, { lastSyncAt: NOW });
    const fake = fakeGarmin({ validKeys: ["second-key-abcdef"] });
    await connectGarmin(db, userId, "second-key-abcdef", { now: NOW }, fake.fetcher);
    const [row] = await db.select().from(garminAccount).where(eq(garminAccount.userId, userId));
    expect(row!.apiKey).toBe("second-key-abcdef");
    expect(row!.lastSyncAt).toEqual(NOW);
  });

  test("the token is cached until an hour before it expires, then minted again", async () => {
    const { userId, fake } = await connected();
    const first = await freshToken(db, userId, { now: NOW }, fake.fetcher);
    const again = await freshToken(db, userId, { now: new Date(NOW.getTime() + 22 * 3_600_000) }, fake.fetcher);
    expect(again).toBe(first);
    expect(fake.mints).toHaveLength(1);
    const late = await freshToken(db, userId, { now: new Date(NOW.getTime() + 23.5 * 3_600_000) }, fake.fetcher);
    expect(late).not.toBe(first);
    expect(fake.mints).toHaveLength(2);
    const [row] = await db.select().from(garminAccount).where(eq(garminAccount.userId, userId));
    expect(row!.token).toBe(late);
  });

  test("a key Garmin stops accepting ends the connection but keeps what was imported", async () => {
    const { userId } = await connected();
    await insertExercise(userId, { date: "2026-10-20", type: "Walk", durationMin: 30, source: "garmin", externalId: "garmin-1" });
    const revoked = fakeGarmin({ validKeys: [] });
    const error = await freshToken(db, userId, { now: NOW, force: true }, revoked.fetcher).catch((e: unknown) => e);
    expect((error as GarminGrantError).failure).toBe("rejected");
    expect(await garminStatus(db, userId)).toEqual({ connected: false });
    expect(await rows("exercise_log", userId, "garmin")).toHaveLength(1);
  });

  test("tokenExpiry reads exp and refuses what is not a JWT; mintToken wants a JWT back", async () => {
    expect(tokenExpiry(jwt(new Date("2026-10-25T00:00:00Z")))?.toISOString()).toBe("2026-10-25T00:00:00.000Z");
    expect(tokenExpiry("not-a-jwt")).toBeNull();
    expect(tokenExpiry("a.b.c")).toBeNull();
    const html = async () => new Response("<html>", { status: 200 });
    const error = await mintToken(KEY, html).catch((e: unknown) => e);
    expect((error as GarminGrantError).failure).toBe("unavailable");
  });
});

describe("sync windows", () => {
  const plan = (last?: Date) => syncPlan("2026-10-24", last, NOW);

  test("the first sync backfills: all history of workouts, 2 years of weigh-ins, a year of days", () => {
    expect(plan()).toEqual({
      backfill: true,
      activityStart: BACKFILL_ACTIVITY_START,
      weightStart: "2024-10-24",
      dayStart: "2025-10-25",
      pages: BACKFILL_PAGES,
    });
  });

  test("later: since the last sync minus two days, never past 30 days (90 for weigh-ins)", () => {
    const hourAgo = new Date(NOW.getTime() - 3_600_000);
    expect(plan(hourAgo)).toMatchObject({ backfill: false, activityStart: "2026-10-21", weightStart: "2026-10-21", dayStart: "2026-10-21", pages: 5 });
    expect(plan(new Date(NOW.getTime() - 10 * 86_400_000))).toMatchObject({ activityStart: "2026-10-12", weightStart: "2026-10-12" });
    expect(plan(new Date("2026-01-01T00:00:00Z"))).toMatchObject({ activityStart: "2026-09-24", weightStart: "2026-07-26", dayStart: "2026-09-24" });
  });

  test("day chunks: consecutive, at most 90 days, the last clipped to the end", () => {
    expect(dayChunks("2026-01-01", "2026-01-10", 90)).toEqual([["2026-01-01", "2026-01-10"]]);
    expect(dayChunks("2026-01-01", "2026-03-31", 90)).toEqual([["2026-01-01", "2026-03-31"]]);
    expect(dayChunks("2026-01-01", "2026-04-01", 90)).toEqual([
      ["2026-01-01", "2026-03-31"],
      ["2026-04-01", "2026-04-01"],
    ]);
    const year = dayChunks("2025-10-25", "2026-10-24", 90);
    expect(year).toHaveLength(5);
    expect(year[0]![0]).toBe("2025-10-25");
    expect(year.at(-1)![1]).toBe("2026-10-24");
    for (let i = 1; i < year.length; i++) expect(shiftDate(year[i - 1]![1], 1)).toBe(year[i]![0]);
  });
});

describe("sync: workouts", () => {
  test("imports as source garmin with calories net of resting energy and the diary's types", async () => {
    const { userId, fake } = await connected({ activities: ACTIVITIES });
    const result = await run(userId, fake);
    expect(result).toMatchObject({ imported: 3, skipped: 0, weights: 0, days: 0, unparsed: 0 });
    const stored = await rows("exercise_log", userId, "garmin");
    expect(stored.map((r) => [r.external_id, r.date, r.type, r.kcal])).toEqual([
      ["garmin-1003", "2026-10-20", "OtherWorkout", 341],
      ["garmin-1002", "2026-10-22", "Treadmill", 188],
      ["garmin-1001", "2026-10-23", "Walk", 104],
    ]);
    expect(stored.find((r) => r.external_id === "garmin-1001")!.duration_min).toBeCloseTo(1487 / 60, 5);
    expect(externalIdOf(parseActivities(ACTIVITIES).activities[0]!)).toBe("garmin-1001");
  });

  test("a workout without bmrCalories loses the resting estimate (1 MET at the person's weight); without calories it is a MET estimate", async () => {
    const { userId, fake } = await connected({
      activities: [activity(2001, "street_running", "2026-10-23 17:00:00", 3600, 600, null), activity(2002, "walking", "2026-10-23 08:00:00", 3600, null, null)],
    });
    // 70 kg (no profile, no weigh-in): resting 70 kcal in the hour; walking MET 5.0 * 3.5 * 70 * 60 / 200 = 368.
    await run(userId, fake);
    const byId = Object.fromEntries((await rows("exercise_log", userId, "garmin")).map((r) => [r.external_id, r.kcal]));
    expect(byId).toEqual({ "garmin-2001": 530, "garmin-2002": 368 });
  });

  test("the name follows the type (Garmin's own title, which carries the city, is not used)", async () => {
    const { userId, fake } = await connected({ activities: ACTIVITIES });
    await run(userId, fake);
    const names = Object.fromEntries((await rows("exercise_log", userId, "garmin")).map((r) => [r.external_id, r.name]));
    expect(names["garmin-1001"]).toBe("Jalan cepat (Garmin)");
    expect(names["garmin-1003"]).toBe("Paddelball (Garmin)");
  });

  test("a second sync is a no-op and records the sync time", async () => {
    const { userId, fake } = await connected({ activities: ACTIVITIES });
    await run(userId, fake);
    const again = await run(userId, fake, new Date(NOW.getTime() + 3_600_000));
    // The later window (since the last sync minus two days) no longer reaches the 20th.
    expect(again).toMatchObject({ imported: 0, skipped: 2 });
    expect(await rows("exercise_log", userId, "garmin")).toHaveLength(3);
    const status = await garminStatus(db, userId);
    expect(status.connected && status.lastSyncAt).toEqual(new Date(NOW.getTime() + 3_600_000));
  });

  const manyActivities = (n: number) =>
    Array.from({ length: n }, (_, i) => activity(5000 + i, "walking", `${2020 + (i % 6)}-0${1 + (i % 9)}-1${i % 9} ${String(i % 24).padStart(2, "0")}:00:00`, 600 + i, 50, 10));

  test("the first sync reads the whole history in pages of 100 and stops at a short one", async () => {
    const { userId, fake } = await connected({ activities: manyActivities(250) });
    const first = await run(userId, fake);
    expect(first.imported).toBe(250);
    const listed = fake.calls.filter((c) => c.path.endsWith("/activities/search/activities"));
    expect(listed.map((c) => c.params.get("start"))).toEqual(["0", "100", "200"]);
    expect(listed[0]!.params.get("startDate")).toBe(BACKFILL_ACTIVITY_START);
    expect(listed[0]!.params.get("endDate")).toBe("2026-10-24");
  });

  test("a history that is an exact multiple of a page costs one more, empty, page", async () => {
    const { userId, fake } = await connected({ activities: manyActivities(200) });
    await run(userId, fake);
    expect(fake.calls.filter((c) => c.path.endsWith("/activities/search/activities")).map((c) => c.params.get("start"))).toEqual(["0", "100", "200"]);
  });

  test("the first sync stops at the page cap (the newest 1000 come first)", async () => {
    const { userId, fake } = await connected({ activities: manyActivities(BACKFILL_PAGES * 100 + 50) });
    const first = await run(userId, fake);
    expect(fake.calls.filter((c) => c.path.endsWith("/activities/search/activities"))).toHaveLength(BACKFILL_PAGES);
    expect(first.imported).toBe(BACKFILL_PAGES * 100);
  });

  test("the first sync asks for 2 years of weigh-ins and a year of days in 90-day requests; Garmin gets the owner-sized request count", async () => {
    const { userId, fake } = await connected({ activities: manyActivities(150), weights: { dailyWeightSummaries: [weighIn("2025-01-01", 72000)] } });
    await run(userId, fake);
    expect(fake.calls.find((c) => c.path.includes("/weight/range/"))!.path).toContain("/2024-10-24/2026-10-24");
    const days = fake.calls.filter((c) => c.path.endsWith("/dailysummaries")).map((c) => [c.params.get("startDate"), c.params.get("endDate")]);
    expect(days).toHaveLength(5);
    expect(days[0]![0]).toBe("2025-10-25");
    expect(days.at(-1)![1]).toBe("2026-10-24");
    // 150 activities: 2 activity pages + 1 weigh-in request + 5 day requests; the token was minted when connecting.
    expect(fake.calls).toHaveLength(8);
    expect(fake.mints).toHaveLength(1);
    // The weigh-in older than the later window is part of the backfill.
    expect((await rows("weight_log", userId)).map((r) => r.date)).toEqual(["2025-01-01"]);
  });

  test("later syncs ask for the short window only", async () => {
    const { userId, fake } = await connected({ activities: manyActivities(60) });
    await run(userId, fake);
    fake.calls.length = 0;
    await run(userId, fake, new Date(NOW.getTime() + 3_600_000));
    const acts = fake.calls.filter((c) => c.path.endsWith("/activities/search/activities"));
    expect(acts).toHaveLength(1);
    expect(acts[0]!.params.get("startDate")).toBe("2026-10-21");
    expect(fake.calls.filter((c) => c.path.endsWith("/dailysummaries"))).toHaveLength(1);
    expect(fake.calls).toHaveLength(3);
  });

  test("an import of 1000 workouts stays inside D1's limits and is idempotent", async () => {
    const { userId, fake } = await connected({ activities: manyActivities(1000) });
    expect((await run(userId, fake)).imported).toBe(1000);
    expect(await rows("exercise_log", userId, "garmin")).toHaveLength(1000);
  });

  test("a workout another source already holds is not imported (same day, kind, duration within two minutes)", async () => {
    const { userId, fake } = await connected({ activities: ACTIVITIES });
    // Strava holds the walk (Run vs Walk are different kinds), Health Connect the treadmill run as a Run.
    await insertExercise(userId, { date: "2026-10-23", type: "Walk", durationMin: 24, source: "strava", externalId: "s1" });
    await insertExercise(userId, { date: "2026-10-22", type: "Run", durationMin: 24, source: "health_connect", externalId: "h1" });
    await insertExercise(userId, { date: "2026-10-20", type: "Walk", durationMin: 40, source: "strava", externalId: "s2" });
    const result = await run(userId, fake);
    expect(result.imported).toBe(1);
    expect((await rows("exercise_log", userId, "garmin")).map((r) => r.external_id)).toEqual(["garmin-1003"]);
  });

  test("one stored row absorbs only one Garmin workout", async () => {
    const { userId, fake } = await connected({
      activities: [activity(3001, "walking", "2026-10-23 06:00:00", 1800, 100, 20), activity(3002, "walking", "2026-10-23 18:00:00", 1800, 100, 20)],
    });
    await insertExercise(userId, { date: "2026-10-23", type: "Walk", durationMin: 30, source: "strava", externalId: "s1" });
    const result = await run(userId, fake);
    expect(result.imported).toBe(1);
  });

  test("a Garmin row stored before the other source's copy arrived is removed on the next sync", async () => {
    const { userId, fake } = await connected({ activities: ACTIVITIES });
    await run(userId, fake);
    await insertExercise(userId, { date: "2026-10-23", type: "jalan_cepat", durationMin: 25, source: "health_connect", externalId: "h9" });
    await run(userId, fake, new Date(NOW.getTime() + 3_600_000));
    expect((await rows("exercise_log", userId, "garmin")).map((r) => r.external_id)).toEqual(["garmin-1003", "garmin-1002"]);
  });

  test("records that cannot be read are counted, the rest is imported", async () => {
    const { userId, fake } = await connected({ activities: [ACTIVITIES[0], { activityId: 9, startTimeLocal: "x" }] });
    const result = await run(userId, fake);
    expect(result).toMatchObject({ imported: 1, unparsed: 1 });
  });
});

describe("sync: weigh-ins and days", () => {
  test("weigh-ins go to weight_log as source garmin, kilograms", async () => {
    const { userId, fake } = await connected({ weights: { dailyWeightSummaries: [weighIn("2026-10-20", 72500), weighIn("2026-09-01", 73000)] } });
    const result = await run(userId, fake);
    expect(result.weights).toBe(2);
    expect((await rows("weight_log", userId)).map((r) => [r.date, r.weight_kg, r.source])).toEqual([
      ["2026-09-01", 73, "garmin"],
      ["2026-10-20", 72.5, "garmin"],
    ]);
  });

  test("a day that already holds the person's own weigh-in is left alone; a Garmin day is refreshed when it changed", async () => {
    const { userId, fake } = await connected({ weights: { dailyWeightSummaries: [weighIn("2026-10-23", 72500), weighIn("2026-10-24", 72000)] } });
    await client.execute({
      sql: `INSERT INTO weight_log (id, user_id, date, weight_kg, source) VALUES (?, ?, ?, ?, 'manual')`,
      args: [crypto.randomUUID(), userId, "2026-10-23", 80],
    });
    expect((await run(userId, fake)).weights).toBe(1);
    expect((await run(userId, fake)).weights).toBe(0);
    const changed = fakeGarmin({ weights: { dailyWeightSummaries: [weighIn("2026-10-23", 72500), weighIn("2026-10-24", 71500)] } });
    expect((await run(userId, changed)).weights).toBe(1);
    expect((await rows("weight_log", userId)).map((r) => [r.date, r.weight_kg, r.source])).toEqual([
      ["2026-10-23", 80, "manual"],
      ["2026-10-24", 71.5, "garmin"],
    ]);
  });

  test("daily steps go to daily_activity; another source's row is replaced only by at least as many steps", async () => {
    const { userId, fake } = await connected({
      summaries: { data: [summary("2026-10-21", 6000), summary("2026-10-22", 3000), summary("2026-10-23", 4000)] },
    });
    const insert = (date: string, steps: number, source: string) =>
      client.execute({ sql: `INSERT INTO daily_activity (id, user_id, date, steps, source) VALUES (?, ?, ?, ?, ?)`, args: [crypto.randomUUID(), userId, date, steps, source] });
    await insert("2026-10-22", 5000, "health_connect");
    await insert("2026-10-23", 4000, "apple_health");
    const result = await run(userId, fake);
    expect(result.days).toBe(2);
    expect((await rows("daily_activity", userId)).map((r) => [r.date, r.steps, r.source])).toEqual([
      ["2026-10-21", 6000, "garmin"],
      ["2026-10-22", 5000, "health_connect"],
      ["2026-10-23", 4000, "garmin"],
    ]);
    expect((await rows("daily_activity", userId, "garmin"))[0]).toMatchObject({ active_calories: 150, exercise_minutes: 7, distance_meters: 4200 });
    expect((await run(userId, fake)).days).toBe(0);
  });
});

describe("sync: failures", () => {
  test("a token Garmin refuses is minted again once, then the sync goes on", async () => {
    const { userId } = await connected();
    const fake = fakeGarmin({ activities: ACTIVITIES, validTokens: (token) => token.includes(b64({ exp: Math.floor((NOW.getTime() + 24 * 3_600_000) / 1000), tag: "t2" })) });
    await connectGarmin(db, userId, KEY, { now: NOW }, fake.fetcher);
    const result = await run(userId, fake);
    expect(result.imported).toBe(3);
    expect(fake.mints).toHaveLength(2);
  });

  test("a revoked key during a sync says 'expired' and disconnects; a Garmin outage says 'unavailable' and keeps the connection", async () => {
    const { userId } = await connected();
    const revoked = fakeGarmin({ validKeys: [] });
    await db.update(garminAccount).set({ tokenExpiresAt: new Date(NOW.getTime() - 1000) }).where(eq(garminAccount.userId, userId));
    const expired = await run(userId, revoked).catch((e: unknown) => e);
    expect(expired).toBeInstanceOf(GarminSyncError);
    expect((expired as GarminSyncError).failure).toBe("expired");
    expect((await garminStatus(db, userId)).connected).toBe(false);

    const other = await connected();
    const down = await run(other.userId, fakeGarmin({ outage: true })).catch((e: unknown) => e);
    expect((down as GarminSyncError).failure).toBe("unavailable");
    const status = await garminStatus(db, other.userId);
    expect(status.connected && status.lastError).toBeTruthy();
    if (status.connected) expect(status.lastError).not.toContain(KEY);
    // The next good sync clears it.
    const ok = fakeGarmin({ activities: ACTIVITIES });
    await run(other.userId, ok);
    const after = await garminStatus(db, other.userId);
    expect(after.connected && after.lastError).toBeUndefined();
  });

  test("not connected", async () => {
    const userId = await newUser();
    const error = await run(userId, fakeGarmin()).catch((e: unknown) => e);
    expect((error as GarminSyncError).failure).toBe("not_connected");
  });
});

describe("disconnect", () => {
  test("removes the key and token and every row imported from Garmin, nothing else", async () => {
    const { userId, fake } = await connected({
      activities: ACTIVITIES,
      weights: { dailyWeightSummaries: [weighIn("2026-10-21", 72000)] },
      summaries: { data: [summary("2026-10-22", 3000)] },
    });
    await client.execute({ sql: `INSERT INTO weight_log (id, user_id, date, weight_kg, source) VALUES (?, ?, '2026-10-19', 79, 'manual')`, args: [crypto.randomUUID(), userId] });
    await insertExercise(userId, { date: "2026-10-19", type: "Run", durationMin: 30, source: "strava", externalId: "s1" });
    await run(userId, fake);
    expect(await rows("exercise_log", userId, "garmin")).toHaveLength(3);

    const other = await newUser();
    await insertExercise(other, { date: "2026-10-20", type: "Walk", durationMin: 30, source: "garmin", externalId: "garmin-1001" });

    await disconnectGarmin(db, userId);
    expect(await db.select().from(garminAccount).where(eq(garminAccount.userId, userId))).toHaveLength(0);
    expect(await rows("exercise_log", userId, "garmin")).toHaveLength(0);
    expect(await rows("weight_log", userId, "garmin")).toHaveLength(0);
    expect(await rows("daily_activity", userId, "garmin")).toHaveLength(0);
    expect((await rows("exercise_log", userId)).map((r) => r.source)).toEqual(["strava"]);
    expect((await rows("weight_log", userId)).map((r) => r.source)).toEqual(["manual"]);
    expect(await rows("exercise_log", other, "garmin")).toHaveLength(1);
  });

  test("deleteImportedData alone leaves the connection", async () => {
    const { userId, fake } = await connected({ activities: ACTIVITIES });
    await run(userId, fake);
    await deleteImportedData(db, userId);
    expect(await rows("exercise_log", userId, "garmin")).toHaveLength(0);
    expect((await garminStatus(db, userId)).connected).toBe(true);
  });
});
