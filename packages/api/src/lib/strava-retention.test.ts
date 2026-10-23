import { call } from "@orpc/server";
import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";

import { d1TestDb } from "@joyorogo/db/test-d1";

import type { Context } from "../context";
import { stravaRouter } from "../routers/strava";
import { exchangeCode } from "./strava-grant";
import { scrubExpiredStravaRows, stravaRetentionCutoff } from "./strava-retention";

const ENV = { STRAVA_CLIENT_ID: "287873", STRAVA_CLIENT_SECRET: "secret" };
const DAY_MS = 86_400_000;

const { client, db } = await d1TestDb();

let counter = 0;
async function newUser(): Promise<string> {
  counter += 1;
  const id = `ret${counter}`;
  await client.execute({ sql: `INSERT INTO "user" (id, name, email) VALUES (?, ?, ?)`, args: [id, id, `${id}@test.id`] });
  return id;
}

async function insertRow(userId: string, id: string, source: string, date: string, createdAt: number, externalId?: string) {
  await client.execute({
    sql: `INSERT INTO exercise_log (id, user_id, date, type, name, duration_min, kcal, source, external_id, created_at)
          VALUES (?, ?, ?, 'Run', 'Lari pagi', 30, 250, ?, ?, ?)`,
    args: [id, userId, date, source, externalId ?? null, createdAt],
  });
}

async function ids(userId: string): Promise<string[]> {
  const result = await client.execute({ sql: "SELECT id FROM exercise_log WHERE user_id = ? ORDER BY id", args: [userId] });
  return result.rows.map((r) => String(r.id));
}

describe("scrubExpiredStravaRows", () => {
  // 10:00 WIB on 2026-10-17
  const now = new Date("2026-10-17T03:00:00Z");

  test("the cutoff is the WIB day seven days back", () => {
    expect(stravaRetentionCutoff(now)).toBe("2026-10-10");
    // 17:30 UTC is already the next WIB day
    expect(stravaRetentionCutoff(new Date("2026-10-17T17:30:00Z"))).toBe("2026-10-11");
  });

  test("deletes Strava rows on or before the cutoff day and leaves newer ones, other sources and other users alone", async () => {
    const u = await newUser();
    const other = await newUser();
    const fresh = now.getTime() - 3_600_000;
    await insertRow(u, "a-old", "strava", "2026-10-09", fresh, "1");
    await insertRow(u, "b-boundary", "strava", "2026-10-10", fresh, "2");
    await insertRow(u, "c-kept", "strava", "2026-10-11", fresh, "3");
    await insertRow(u, "d-today", "strava", "2026-10-17", fresh, "4");
    await insertRow(u, "e-manual-old", "manual", "2026-09-01", fresh);
    await insertRow(u, "f-hc-old", "health_connect", "2026-09-01", fresh, "hc-1");
    await insertRow(other, "g-other-old", "strava", "2026-10-01", fresh, "5");
    await insertRow(other, "h-other-kept", "strava", "2026-10-15", fresh, "6");

    const before = (await client.execute("SELECT count(*) AS n FROM exercise_log")).rows[0]?.n;
    const deleted = await scrubExpiredStravaRows(db, now);

    // a-old, b-boundary and g-other-old, whichever users were in the table before this test
    expect(await ids(u)).toEqual(["c-kept", "d-today", "e-manual-old", "f-hc-old"]);
    expect(await ids(other)).toEqual(["h-other-kept"]);
    const after = (await client.execute("SELECT count(*) AS n FROM exercise_log")).rows[0]?.n;
    expect(Number(before) - Number(after)).toBe(deleted);
    expect(deleted).toBeGreaterThanOrEqual(3);
  });

  test("is idempotent: a second run right after deletes nothing", async () => {
    const u = await newUser();
    await insertRow(u, "i-old", "strava", "2026-10-01", now.getTime() - 3_600_000, "10");
    expect(await scrubExpiredStravaRows(db, now)).toBeGreaterThanOrEqual(1);
    expect(await scrubExpiredStravaRows(db, now)).toBe(0);
    expect(await ids(u)).toEqual([]);
  });

  test("a row fetched more than seven days ago goes even when its date was edited forward", async () => {
    const u = await newUser();
    await insertRow(u, "j-edited", "strava", "2026-10-16", now.getTime() - 8 * DAY_MS, "11");
    await insertRow(u, "k-fresh", "strava", "2026-10-16", now.getTime() - 2 * DAY_MS, "12");
    await scrubExpiredStravaRows(db, now);
    expect(await ids(u)).toEqual(["k-fresh"]);
  });

  test("deletes in batches until nothing expired is left", async () => {
    const u = await newUser();
    const fresh = now.getTime() - 3_600_000;
    for (let i = 0; i < 5; i++) await insertRow(u, `l-${i}`, "strava", `2026-10-0${i + 1}`, fresh, `2${i}`);
    await insertRow(u, "m-kept", "strava", "2026-10-16", fresh, "30");
    expect(await scrubExpiredStravaRows(db, now, 2)).toBeGreaterThanOrEqual(5);
    expect(await ids(u)).toEqual(["m-kept"]);
  });
});

describe("sync after a scrub", () => {
  const realFetch = globalThis.fetch;
  let activities: unknown[] = [];

  beforeEach(() => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/athlete/activities")) return Response.json(activities);
      return Response.json({
        access_token: "acc",
        refresh_token: "ref",
        expires_at: Math.floor(Date.now() / 1000) + 10 * 86_400,
        athlete: { id: 7001 },
        scope: "read,activity:read_all",
      });
    }) as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    setSystemTime();
  });

  const startedDaysAgo = (days: number, at: number) => new Date(at - days * DAY_MS).toISOString();

  test("does not re-import a scrubbed activity and never imports one past the window", async () => {
    const userId = await newUser();
    const t0 = Date.now();
    setSystemTime(new Date(t0));
    await exchangeCode(db, ENV, { userId, product: "rogo", code: "c", callbackScope: "read,activity:read_all" });
    const ctx = { db, env: ENV, waitUntil: () => {}, session: { user: { id: userId } } } as unknown as Context;
    const sync = () => call(stravaRouter.sync, undefined, { context: ctx });

    activities = [
      { id: 9001, type: "Run", name: "Fresh", start_date: startedDaysAgo(1, t0), moving_time: 1800, calories: 200 },
      { id: 9002, type: "Ride", name: "Older", start_date: startedDaysAgo(4, t0), moving_time: 3600, calories: 400 },
      { id: 9003, type: "Run", name: "Past the window", start_date: startedDaysAgo(9, t0), moving_time: 1800, calories: 300 },
    ];
    expect(await sync()).toMatchObject({ imported: 2 });
    expect(await ids(userId)).toHaveLength(2);

    // Five days later the 4-day-old activity is 9 days old: the cron scrubs it, the 1-day-old one is 6 days old.
    setSystemTime(new Date(t0 + 5 * DAY_MS));
    expect(await scrubExpiredStravaRows(db)).toBeGreaterThanOrEqual(1);
    expect(await ids(userId)).toHaveLength(1);

    // Strava still lists all three; only the activity still in the window is known, the others stay out.
    expect(await sync()).toMatchObject({ imported: 0 });
    expect(await ids(userId)).toHaveLength(1);

    // Eight days later nothing is left and nothing comes back.
    setSystemTime(new Date(t0 + 8 * DAY_MS));
    expect(await scrubExpiredStravaRows(db)).toBeGreaterThanOrEqual(1);
    expect(await sync()).toMatchObject({ imported: 0 });
    expect(await ids(userId)).toEqual([]);
  });
});
