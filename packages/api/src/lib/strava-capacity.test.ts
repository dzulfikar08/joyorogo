import { d1TestDb } from "@joyorogo/db/test-d1";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  type StravaCapacity,
  connectedAthletes,
  slotCheck,
  slotRefusal,
  stravaCapacity,
} from "./strava-capacity";
import { exchangeCode, grantStatus } from "./strava-grant";
import { keepPaidReserve, releaseAthletes, releaseIdleFree, releaseNotice } from "./strava-release";

const ENV = { STRAVA_CLIENT_ID: "287873", STRAVA_CLIENT_SECRET: "secret" };
const CAP: StravaCapacity = { capacity: 10, reserve: 3, idleDays: 14 };
const NOW = new Date("2026-10-26T05:00:00Z");
const DAY = 86_400_000;

const { client, db } = await d1TestDb();

let counter = 0;
async function newUser(kind: "free" | "comp" | "paid" | "lapsed" = "free"): Promise<string> {
  counter += 1;
  const id = `u${counter}`;
  await client.execute({
    sql: `INSERT INTO "user" (id, name, email, tier, founder_until) VALUES (?, ?, ?, ?, ?)`,
    args: [
      id,
      id,
      `${id}@test.id`,
      kind === "comp" ? "founder" : "free",
      kind === "paid" ? Date.now() + 30 * DAY : kind === "lapsed" ? Date.now() - DAY : null,
    ],
  });
  return id;
}

let athleteSeq = 1000;
/** A connected JoyoFit link last used `daysAgo` days before NOW. */
async function seat(
  userId: string,
  daysAgo: number,
  athleteId = String(++athleteSeq),
): Promise<string> {
  await client.execute({
    sql: `INSERT INTO strava_account (user_id, athlete_id, access_token, refresh_token, expires_at, scope, fit_linked_at, updated_at)
          VALUES (?, ?, 'acc', ?, 0, 'activity:write', 0, ?)`,
    args: [userId, athleteId, `ref-${athleteId}-${userId}`, NOW.getTime() - daysAgo * DAY],
  });
  return athleteId;
}

/** Fills the application with `n` idle-for-`daysAgo` free athletes. */
async function fill(n: number, daysAgo = 1): Promise<string[]> {
  const athletes: string[] = [];
  for (let i = 0; i < n; i++) athletes.push(await seat(await newUser(), daysAgo));
  return athletes;
}

type Call = { url: string; body: URLSearchParams };
let calls: Call[] = [];
let strava: (call: Call) => Response;
const realFetch = globalThis.fetch;
const revokes = () => calls.filter((c) => c.url.endsWith("/oauth/revoke"));

function grant(athlete: number): Response {
  return Response.json({
    access_token: "acc-new",
    refresh_token: `ref-new-${athlete}`,
    expires_at: Math.floor(Date.now() / 1000) + 21_600,
    athlete: { id: athlete },
    scope: "activity:write",
  });
}

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
  const tokenCall = strava;
  strava = (call) => (call.url.endsWith("/oauth/token") ? grant(athlete) : tokenCall(call));
  return exchangeCode(db, ENV, {
    userId,
    product: "fit",
    code: "c",
    callbackScope: "activity:write",
    capacity: CAP,
  });
}

const accountRows = async () =>
  (await client.execute("SELECT user_id, athlete_id FROM strava_account ORDER BY athlete_id"))
    .rows as unknown as {
    user_id: string;
    athlete_id: string;
  }[];

describe("config", () => {
  test("defaults 10 / 3 / 14, garbage falls back, the reserve never exceeds the capacity", () => {
    expect(stravaCapacity({})).toEqual({ capacity: 10, reserve: 3, idleDays: 14 });
    expect(
      stravaCapacity({ STRAVA_CAPACITY: "25", STRAVA_PAID_RESERVE: "5", STRAVA_IDLE_DAYS: "30" }),
    ).toEqual({
      capacity: 25,
      reserve: 5,
      idleDays: 30,
    });
    expect(
      stravaCapacity({ STRAVA_CAPACITY: "x", STRAVA_PAID_RESERVE: "-1", STRAVA_IDLE_DAYS: "0" }),
    ).toEqual(CAP);
    expect(stravaCapacity({ STRAVA_CAPACITY: "2", STRAVA_PAID_RESERVE: "5" })).toEqual({
      capacity: 2,
      reserve: 2,
      idleDays: 14,
    });
    expect(stravaCapacity({ STRAVA_PAID_RESERVE: "0" }).reserve).toBe(0);
  });
});

describe("slotRefusal (paid vs free, reserve boundary)", () => {
  test("a free user connects only while more than the reserve is free", () => {
    expect(slotRefusal(false, 6, CAP)).toBeNull(); // 4 free > 3
    expect(slotRefusal(false, 7, CAP)).toBe("reserved_for_paid"); // 3 free = reserve
    expect(slotRefusal(false, 9, CAP)).toBe("reserved_for_paid");
    expect(slotRefusal(false, 10, CAP)).toBe("full");
  });

  test("a paying user connects while any slot is free", () => {
    expect(slotRefusal(true, 7, CAP)).toBeNull();
    expect(slotRefusal(true, 9, CAP)).toBeNull();
    expect(slotRefusal(true, 10, CAP)).toBe("full");
    expect(slotRefusal(true, 11, CAP)).toBe("full");
  });

  test("with no reserve, free users take every slot", () => {
    expect(slotRefusal(false, 9, { ...CAP, reserve: 0 })).toBeNull();
  });
});

describe("slotCheck (before the authorize page)", () => {
  test("counts athletes, not accounts, and spares users who already hold a slot", async () => {
    const athletes = await fill(6);
    const twin = await newUser();
    await seat(twin, 1, athletes[0]); // a second account of an athlete already counted
    expect(await connectedAthletes(db)).toBe(6);
    expect(await slotCheck(db, await newUser(), CAP)).toEqual({ slotsFull: false });
    await fill(1);
    expect(await slotCheck(db, await newUser(), CAP)).toEqual({
      slotsFull: true,
      slotsReason: "reserved_for_paid",
    });
    expect(await slotCheck(db, await newUser("paid"), CAP)).toEqual({ slotsFull: false });
    expect(await slotCheck(db, await newUser("comp"), CAP)).toEqual({ slotsFull: false });
    expect(await slotCheck(db, await newUser("lapsed"), CAP)).toEqual({
      slotsFull: true,
      slotsReason: "reserved_for_paid",
    });
    expect(await slotCheck(db, twin, CAP)).toEqual({ slotsFull: false });
    await fill(3);
    expect(await slotCheck(db, await newUser("paid"), CAP)).toEqual({
      slotsFull: true,
      slotsReason: "full",
    });
  });
});

describe("exchangeCode under the slot rule", () => {
  test("a refused free user's fresh grant is revoked and never stored", async () => {
    await fill(7);
    const userId = await newUser();
    await expect(exchangeFor(userId, 777)).rejects.toMatchObject({
      failure: "slots_full",
      slotsReason: "reserved_for_paid",
    });
    expect(revokes()).toHaveLength(1);
    expect(revokes()[0]?.body.get("token")).toBe("ref-new-777");
    expect(await connectedAthletes(db)).toBe(7);
    expect((await grantStatus(db, userId, "fit")).connected).toBe(false);
  });

  test("a free user connects while one slot more than the reserve is free", async () => {
    await fill(6);
    const userId = await newUser();
    await exchangeFor(userId, 778);
    expect(revokes()).toHaveLength(0);
    expect(await connectedAthletes(db)).toBe(7);
  });

  test("a paying user takes the reserve, but not a slot that does not exist", async () => {
    await fill(9);
    await exchangeFor(await newUser("paid"), 779);
    expect(await connectedAthletes(db)).toBe(10);
    const late = await newUser("comp");
    await expect(exchangeFor(late, 780)).rejects.toMatchObject({
      failure: "slots_full",
      slotsReason: "full",
    });
    expect(revokes().map((c) => c.body.get("token"))).toEqual(["ref-new-780"]);
  });

  test("re-authorizing a held slot or an athlete another account holds needs no new slot", async () => {
    const athletes = await fill(10);
    const holder = (await accountRows()).find((r) => r.athlete_id === athletes[0])!.user_id;
    await exchangeFor(holder, Number(athletes[0]));
    await exchangeFor(await newUser(), Number(athletes[1]));
    expect(revokes()).toHaveLength(0);
    expect(await connectedAthletes(db)).toBe(10);
  });

  test("connecting again clears the released notice", async () => {
    const userId = await newUser();
    const athlete = await seat(userId, 30);
    await releaseAthletes(db, ENV, [athlete], { now: NOW });
    expect(await releaseNotice(db, userId)).toMatchObject({ reason: "released_for_pro" });
    await exchangeFor(userId, Number(athlete));
    expect(await releaseNotice(db, userId)).toBeNull();
  });
});

describe("releaseIdleFree", () => {
  test("idle free athletes go oldest use first; paying users and the owner never", async () => {
    const owner = await newUser("comp");
    await seat(owner, 90); // the owner, idlest of all
    await seat(await newUser("paid"), 60);
    const a20 = await seat(await newUser(), 20);
    const a40 = await seat(await newUser(), 40);
    const a30 = await seat(await newUser(), 30);
    await seat(await newUser(), 3); // active

    const dry = await releaseIdleFree(db, ENV, {
      olderThanDays: 14,
      max: 2,
      dryRun: true,
      now: NOW,
    });
    expect(dry.map((r) => [r.athleteId, r.outcome])).toEqual([
      [a40, "would_release"],
      [a30, "would_release"],
    ]);
    expect(revokes()).toHaveLength(0);
    expect(await connectedAthletes(db)).toBe(6);

    const done = await releaseIdleFree(db, ENV, { olderThanDays: 14, max: 10, now: NOW });
    expect(done.map((r) => [r.athleteId, r.outcome, r.revoked])).toEqual([
      [a40, "released", true],
      [a30, "released", true],
      [a20, "released", true],
    ]);
    expect(await connectedAthletes(db)).toBe(3);
    expect(await grantStatus(db, owner, "fit")).toMatchObject({ connected: true });
  });

  test("an athlete is idle only when every account linking it is", async () => {
    const athlete = await seat(await newUser(), 40);
    await seat(await newUser(), 2, athlete);
    expect(await releaseIdleFree(db, ENV, { olderThanDays: 14, max: 5, now: NOW })).toEqual([]);
  });

  test("a release drops the grant, the imported Strava rows and leaves the notice; Strava's answer is reported", async () => {
    const userId = await newUser();
    const athlete = await seat(userId, 30);
    for (const [id, source] of [
      ["s1", "strava"],
      ["m1", "manual"],
    ] as const) {
      await client.execute({
        sql: "INSERT INTO exercise_log (id, user_id, date, name, kcal, source) VALUES (?, ?, '2026-10-20', 'x', 100, ?)",
        args: [id, userId, source],
      });
    }
    strava = () => new Response("nope", { status: 401 });
    const [result] = await releaseIdleFree(db, ENV, { olderThanDays: 14, max: 1, now: NOW });
    expect(result).toMatchObject({
      athleteId: athlete,
      outcome: "released",
      revoked: false,
      users: 1,
    });
    expect(revokes()[0]?.body.get("token")).toBe(`ref-${athlete}-${userId}`);
    expect(await accountRows()).toEqual([]);
    const left = await client.execute("SELECT id FROM exercise_log");
    expect((left.rows as unknown as { id: string }[]).map((r) => r.id)).toEqual(["m1"]);
    expect(await releaseNotice(db, userId)).toEqual({ at: NOW, reason: "released_for_pro" });
  });
});

describe("releaseAthletes (the owner's explicit ids)", () => {
  test("releases named free athletes whatever their idle time, refuses paying ones, reports unknown ids", async () => {
    const recent = await seat(await newUser(), 1);
    const paid = await seat(await newUser("paid"), 50);
    const owner = await seat(await newUser("comp"), 50);
    const results = await releaseAthletes(db, ENV, [recent, paid, owner, "999999"], { now: NOW });
    expect(results.map((r) => [r.athleteId, r.outcome])).toEqual([
      [recent, "released"],
      [paid, "paid"],
      [owner, "paid"],
      ["999999", "not_found"],
    ]);
    expect(revokes()).toHaveLength(1);
    expect((await accountRows()).map((r) => r.athlete_id).sort()).toEqual([paid, owner].sort());
  });
});

describe("keepPaidReserve (cron)", () => {
  test("does nothing while the reserve is free, then releases just enough idle free athletes", async () => {
    await fill(7, 30);
    expect(await keepPaidReserve(db, ENV, CAP, NOW)).toEqual([]);
    await seat(await newUser("paid"), 0);
    await seat(await newUser("paid"), 0);
    // 9 connected, 1 free: two idle free athletes go to win the reserve of 3 back.
    const released = await keepPaidReserve(db, ENV, CAP, NOW);
    expect(released.map((r) => r.outcome)).toEqual(["released", "released"]);
    expect(await connectedAthletes(db)).toBe(7);
  });

  test("with nobody idle long enough, nothing is released", async () => {
    await fill(10, 5);
    expect(await keepPaidReserve(db, ENV, CAP, NOW)).toEqual([]);
    expect(revokes()).toHaveLength(0);
  });
});
