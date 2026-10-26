import { d1TestDb } from "@joyorogo/db/test-d1";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { connectedAthletes, slotsFull, stravaCapacity } from "./strava-capacity";
import { exchangeCode, grantStatus } from "./strava-grant";
import { releaseAthletes, releasedAt } from "./strava-release";

const ENV = { STRAVA_CLIENT_ID: "287873", STRAVA_CLIENT_SECRET: "secret" };
const CAPACITY = 5;
const NOW = new Date("2026-10-26T05:00:00Z");
const DAY = 86_400_000;

const { client, db } = await d1TestDb();

let counter = 0;
async function newUser(kind: "free" | "comp" | "paid" = "free"): Promise<string> {
  counter += 1;
  const id = `u${counter}`;
  await client.execute({
    sql: `INSERT INTO "user" (id, name, email, tier, founder_until) VALUES (?, ?, ?, ?, ?)`,
    args: [
      id,
      id,
      `${id}@test.id`,
      kind === "comp" ? "founder" : "free",
      kind === "paid" ? Date.now() + 30 * DAY : null,
    ],
  });
  return id;
}

let athleteSeq = 1000;
/** A connected JoyoFit link last refreshed `daysAgo` days before NOW. */
async function seat(
  userId: string,
  daysAgo = 1,
  athleteId = String(++athleteSeq),
): Promise<string> {
  await client.execute({
    sql: `INSERT INTO strava_account (user_id, athlete_id, access_token, refresh_token, expires_at, scope, fit_linked_at, updated_at)
          VALUES (?, ?, 'acc', ?, 0, 'activity:write', 0, ?)`,
    args: [userId, athleteId, `ref-${athleteId}-${userId}`, NOW.getTime() - daysAgo * DAY],
  });
  return athleteId;
}

async function fill(n: number): Promise<string[]> {
  const athletes: string[] = [];
  for (let i = 0; i < n; i++) athletes.push(await seat(await newUser()));
  return athletes;
}

type Call = { url: string; body: URLSearchParams };
let calls: Call[] = [];
let strava: (call: Call) => Response;
const realFetch = globalThis.fetch;
const revokes = () => calls.filter((c) => c.url.endsWith("/oauth/revoke"));

beforeEach(async () => {
  calls = [];
  strava = (call) =>
    call.url.endsWith("/oauth/revoke")
      ? new Response(null, { status: 200 })
      : new Response("unexpected", { status: 500 });
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: String(input), body: new URLSearchParams(String(init?.body ?? "")) };
    calls.push(call);
    return strava(call);
  }) as typeof fetch;
  await client.execute("DELETE FROM strava_account");
  await client.execute("DELETE FROM strava_release");
  await client.execute("DELETE FROM exercise_log");
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

async function exchangeFor(userId: string, athlete: number) {
  const other = strava;
  strava = (call) =>
    call.url.endsWith("/oauth/token")
      ? Response.json({
          access_token: "acc-new",
          refresh_token: `ref-new-${athlete}`,
          expires_at: Math.floor(Date.now() / 1000) + 21_600,
          athlete: { id: athlete },
          scope: "activity:write",
        })
      : other(call);
  return exchangeCode(db, ENV, {
    userId,
    product: "fit",
    code: "c",
    callbackScope: "activity:write",
    capacity: CAPACITY,
  });
}

const athletesLeft = async () =>
  (await client.execute("SELECT DISTINCT athlete_id FROM strava_account")).rows
    .map((r) => String(r.athlete_id))
    .sort();

describe("config", () => {
  test("STRAVA_CAPACITY defaults to 10; garbage falls back", () => {
    expect(stravaCapacity({})).toBe(10);
    expect(stravaCapacity({ STRAVA_CAPACITY: "9999" })).toBe(9999);
    expect(stravaCapacity({ STRAVA_CAPACITY: "x" })).toBe(10);
    expect(stravaCapacity({ STRAVA_CAPACITY: "0" })).toBe(10);
    expect(stravaCapacity({ STRAVA_CAPACITY: "2.5" })).toBe(10);
  });
});

describe("slotsFull (before the authorize page)", () => {
  test("counts athletes, not accounts; full only when every slot is taken; the plan never matters", async () => {
    const athletes = await fill(CAPACITY - 1);
    const twin = await newUser();
    await seat(twin, 1, athletes[0]); // a second account of an athlete already counted
    expect(await connectedAthletes(db)).toBe(CAPACITY - 1);
    expect(await slotsFull(db, await newUser(), CAPACITY)).toBe(false);
    await fill(1);
    for (const kind of ["free", "paid", "comp"] as const)
      expect(await slotsFull(db, await newUser(kind), CAPACITY)).toBe(true);
    // Someone who already holds a slot is never told it is full.
    expect(await slotsFull(db, twin, CAPACITY)).toBe(false);
  });
});

describe("exchangeCode under the capacity", () => {
  test("the last slot goes to whoever comes first", async () => {
    await fill(CAPACITY - 1);
    await exchangeFor(await newUser(), 777);
    expect(revokes()).toHaveLength(0);
    expect(await connectedAthletes(db)).toBe(CAPACITY);
  });

  test("with every slot taken a fresh grant is revoked and never stored, whatever the plan", async () => {
    await fill(CAPACITY);
    for (const [kind, athlete] of [
      ["free", 778],
      ["paid", 779],
    ] as const) {
      const userId = await newUser(kind);
      await expect(exchangeFor(userId, athlete)).rejects.toMatchObject({ failure: "slots_full" });
      expect((await grantStatus(db, userId, "fit")).connected).toBe(false);
    }
    expect(revokes().map((c) => c.body.get("token"))).toEqual(["ref-new-778", "ref-new-779"]);
    expect(await connectedAthletes(db)).toBe(CAPACITY);
  });

  test("re-authorizing a held slot or an athlete another account holds needs no new slot", async () => {
    const athletes = await fill(CAPACITY - 1);
    const holder = await newUser();
    const held = await seat(holder);
    await exchangeFor(holder, Number(held));
    await exchangeFor(await newUser(), Number(athletes[0]));
    expect(revokes()).toHaveLength(0);
    expect(await connectedAthletes(db)).toBe(CAPACITY);
  });

  test("connecting again clears the released notice", async () => {
    const userId = await newUser();
    const athlete = await seat(userId, 30);
    await releaseAthletes(db, ENV, [athlete], { now: NOW });
    expect(await releasedAt(db, userId)).toEqual(NOW);
    await exchangeFor(userId, Number(athlete));
    expect(await releasedAt(db, userId)).toBeNull();
  });
});

describe("releaseAthletes (the owner's manual tool)", () => {
  test("releases the named athletes, refuses Pro-linked ones as a safety guard, reports unknown ids", async () => {
    const free = await seat(await newUser(), 10);
    const paid = await seat(await newUser("paid"), 50);
    const owner = await seat(await newUser("comp"), 50);
    const results = await releaseAthletes(db, ENV, [free, paid, owner, "999999"], { now: NOW });
    expect(results.map((r) => [r.athleteId, r.outcome])).toEqual([
      [free, "released"],
      [paid, "protected"],
      [owner, "protected"],
      ["999999", "not_found"],
    ]);
    expect(revokes()).toHaveLength(1);
    expect(await athletesLeft()).toEqual([paid, owner].sort());
  });

  test("a dry run changes nothing", async () => {
    const athlete = await seat(await newUser(), 10);
    expect(await releaseAthletes(db, ENV, [athlete], { dryRun: true, now: NOW })).toEqual([
      {
        athleteId: athlete,
        outcome: "would_release",
        users: 1,
        lastUsedAt: new Date(NOW.getTime() - 10 * DAY).toISOString(),
      },
    ]);
    expect(revokes()).toHaveLength(0);
    expect(await athletesLeft()).toEqual([athlete]);
  });

  test("a release drops every account of the athlete, the imported Strava rows, leaves the notice, and reports Strava's answer", async () => {
    const [a, b] = [await newUser(), await newUser()];
    const athlete = await seat(a, 30);
    await seat(b, 20, athlete);
    for (const [id, owner, source] of [
      ["s1", a, "strava"],
      ["s2", b, "strava"],
      ["m1", a, "manual"],
    ] as const) {
      await client.execute({
        sql: "INSERT INTO exercise_log (id, user_id, date, name, kcal, source) VALUES (?, ?, '2026-10-20', 'x', 100, ?)",
        args: [id, owner, source],
      });
    }
    strava = () => new Response("nope", { status: 401 });
    const [result] = await releaseAthletes(db, ENV, [athlete], { now: NOW });
    expect(result).toMatchObject({
      athleteId: athlete,
      outcome: "released",
      revoked: false,
      users: 2,
    });
    expect(await athletesLeft()).toEqual([]);
    const left = await client.execute("SELECT id FROM exercise_log");
    expect(left.rows.map((r) => r.id)).toEqual(["m1"]);
    expect(await releasedAt(db, a)).toEqual(NOW);
    expect(await releasedAt(db, b)).toEqual(NOW);
    const reasons = await client.execute("SELECT DISTINCT reason FROM strava_release");
    expect(reasons.rows.map((r) => r.reason)).toEqual(["idle"]);
  });
});
