import { d1TestDb } from "@joyorogo/db/test-d1";
import { corosAccount } from "@joyorogo/db/schema/fitness";
import { eq } from "drizzle-orm";
import { describe, expect, test } from "bun:test";

import {
  CorosGrantError,
  completeAuthorization,
  deleteImportedWorkouts,
  disconnectCoros,
  freshAccessToken,
  grantStatus,
  peekReturnTo,
  pkceChallenge,
  startAuthorization,
} from "./coros-grant";
import { CorosSyncError, externalIdOf, syncCoros, syncWindowStart } from "./coros-sync";

const ENV = { COROS_CLIENT_ID: "client-1", BETTER_AUTH_URL: "https://api.joyorogo.com" };
const ZONE = "Asia/Jakarta";
const NOW = new Date("2026-10-24T05:00:00Z");

const { client, db } = await d1TestDb();

let counter = 0;
async function newUser(): Promise<string> {
  counter += 1;
  const id = `coros-u${counter}`;
  await client.execute({ sql: `INSERT INTO "user" (id, name, email) VALUES (?, ?, ?)`, args: [id, id, `${id}@test.id`] });
  return id;
}

async function connect(userId: string, extra: Partial<typeof corosAccount.$inferInsert> = {}) {
  await db.insert(corosAccount).values({
    userId,
    accessToken: "acc-1",
    refreshToken: "ref-1",
    expiresAt: new Date(NOW.getTime() + 3_600_000),
    scope: "openid mcp.tools offline_access",
    connectedAt: NOW,
    ...extra,
  });
}

async function exerciseRows(userId: string, source?: string) {
  const result = await client.execute({
    sql: `SELECT * FROM exercise_log WHERE user_id = ? ${source ? "AND source = ?" : ""} ORDER BY date, external_id`,
    args: source ? [userId, source] : [userId],
  });
  return result.rows as unknown as Array<{ id: string; date: string; type: string; name: string; duration_min: number; kcal: number; source: string; external_id: string }>;
}

async function insertExercise(userId: string, row: { date: string; type: string; durationMin: number; source: string; externalId: string; kcal?: number }) {
  await client.execute({
    sql: `INSERT INTO exercise_log (id, user_id, date, type, name, duration_min, kcal, source, external_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [crypto.randomUUID(), userId, row.date, row.type, "x", row.durationMin, row.kcal ?? 100, row.source, row.externalId],
  });
}

// ---- A fake COROS: the token endpoint and the MCP server in one fetch ----

type Fake = {
  fetcher: (url: string, init?: RequestInit) => Promise<Response>;
  tokenCalls: URLSearchParams[];
  revokeCalls: URLSearchParams[];
  toolCalls: Array<{ name: string; args: Record<string, unknown> }>;
  mcpAuth: string[];
};

type FakeOptions = {
  records?: string;
  details?: Record<string, string>;
  /** access tokens the MCP server accepts; others get 401 */
  validTokens?: string[];
  token?: (params: URLSearchParams) => Response | Promise<Response>;
  revoke?: () => Response;
};

function fakeCoros(options: FakeOptions = {}): Fake {
  const fake: Fake = { fetcher: async () => new Response(), tokenCalls: [], revokeCalls: [], toolCalls: [], mcpAuth: [] };
  fake.fetcher = async (url, init) => {
    if (url.endsWith("/oauth2/token")) {
      const params = new URLSearchParams(String(init?.body));
      fake.tokenCalls.push(params);
      return options.token ? await options.token(params) : Response.json({ access_token: "acc-new", refresh_token: "ref-new", expires_in: 3600, scope: "openid mcp.tools offline_access" });
    }
    if (url.endsWith("/oauth2/revoke")) {
      fake.revokeCalls.push(new URLSearchParams(String(init?.body)));
      return options.revoke ? options.revoke() : new Response(null, { status: 200 });
    }
    // MCP
    const auth = new Headers(init?.headers).get("authorization") ?? "";
    fake.mcpAuth.push(auth);
    if (options.validTokens && !options.validTokens.includes(auth.replace("Bearer ", ""))) return new Response("unauthorized", { status: 401 });
    const body = JSON.parse(String(init?.body)) as { id?: number; method: string; params?: { name: string; arguments: Record<string, unknown> } };
    if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
    if (body.method === "initialize") return Response.json({ jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2025-06-18" } });
    const { name, arguments: args } = body.params!;
    fake.toolCalls.push({ name, args });
    let text = "";
    if (name === "querySportRecords") text = options.records ?? "Sport Records (0 records)";
    if (name === "getActivityDetail") text = options.details?.[String(args.labelId)] ?? "Sport Activity Details\n\nWorkout Time: 10:00";
    return Response.json({ jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text }] } });
  };
  return fake;
}

const RECORDS = `Sport Records — 2026-10-10 to 2026-10-24 (3 records)

1. Sport(100) — 2026-10-23
   Duration: 45:00 | Distance: 8.00 km
   Label ID: 111
2. Sport(200) — 2026-10-22
   Duration: 1:30:00 | Distance: 40.00 km
   Label ID: 222
3. Sport(9807) — 2026-10-20
   Duration: 20:00 | Distance: 3 km
   Label ID: 333`;
const DETAILS = {
  "111": "Sport(100) Activity Details\n\nWorkout Time: 45:00\nAverage Heart Rate: 150 bpm\nCalories: 512 kcal",
  // 222 has no calories line: the MET estimate covers it.
  "222": "Sport(200) Activity Details\n\nWorkout Time: 1:30:00",
};

const sync = (userId: string, fake: Fake, now = NOW) => syncCoros({ db, env: ENV, userId, zone: ZONE, locale: "id", now, fetcher: fake.fetcher });

describe("syncWindowStart", () => {
  test("14 days on the first sync, then the last sync minus 2 days, at most 30", () => {
    expect(syncWindowStart("2026-10-24", undefined, NOW)).toBe("2026-10-10");
    expect(syncWindowStart("2026-10-24", new Date("2026-10-24T01:00:00Z"), NOW)).toBe("2026-10-21");
    expect(syncWindowStart("2026-10-24", new Date("2026-10-20T01:00:00Z"), NOW)).toBe("2026-10-17");
    expect(syncWindowStart("2026-10-24", new Date("2026-06-01T00:00:00Z"), NOW)).toBe("2026-09-24");
  });
});

describe("authorization: PKCE and state", () => {
  test("the authorize URL carries a S256 challenge of the stored verifier and a state bound to the user", async () => {
    const userId = await newUser();
    const { url } = await startAuthorization(db, ENV, { userId, returnTo: "native", now: NOW });
    const q = new URL(url).searchParams;
    expect(url.startsWith("https://mcpus.coros.com/oauth2/authorize?")).toBe(true);
    expect(q.get("client_id")).toBe("client-1");
    expect(q.get("redirect_uri")).toBe("https://api.joyorogo.com/api/coros/callback");
    expect(q.get("scope")).toBe("openid mcp.tools offline_access");
    expect(q.get("response_type")).toBe("code");
    expect(q.get("code_challenge_method")).toBe("S256");
    const state = q.get("state")!;
    expect(state.length).toBeGreaterThanOrEqual(40);
    const stored = (await client.execute({ sql: "SELECT * FROM coros_auth_state WHERE state = ?", args: [state] })).rows[0] as unknown as { code_verifier: string; user_id: string };
    expect(stored.user_id).toBe(userId);
    expect(await pkceChallenge(stored.code_verifier)).toBe(q.get("code_challenge")!);
    expect(await peekReturnTo(db, state, NOW)).toBe("native");
    expect(await peekReturnTo(db, "nope", NOW)).toBeNull();
    expect(await peekReturnTo(db, state, new Date(NOW.getTime() + 11 * 60_000))).toBeNull();
  });

  test("the code is exchanged with the verifier and the public client id (no secret), and the tokens are stored", async () => {
    const userId = await newUser();
    const { url } = await startAuthorization(db, ENV, { userId, returnTo: "web", now: NOW });
    const state = new URL(url).searchParams.get("state")!;
    const fake = fakeCoros();
    await completeAuthorization(db, ENV, { userId, code: "the-code", state, now: NOW }, fake.fetcher);
    const call = fake.tokenCalls[0]!;
    expect(call.get("grant_type")).toBe("authorization_code");
    expect(call.get("code")).toBe("the-code");
    expect(call.get("client_id")).toBe("client-1");
    expect(call.get("redirect_uri")).toBe("https://api.joyorogo.com/api/coros/callback");
    expect(call.get("code_verifier")!.length).toBeGreaterThanOrEqual(43);
    expect(call.has("client_secret")).toBe(false);
    const [account] = await db.select().from(corosAccount).where(eq(corosAccount.userId, userId));
    expect(account).toMatchObject({ accessToken: "acc-new", refreshToken: "ref-new" });
    expect((await grantStatus(db, userId)).connected).toBe(true);
  });

  test("a tampered, unknown, replayed, expired or another user's state is refused and never reaches COROS", async () => {
    const userId = await newUser();
    const other = await newUser();
    const fake = fakeCoros();
    const start = async () => new URL((await startAuthorization(db, ENV, { userId, returnTo: "web", now: NOW })).url).searchParams.get("state")!;
    const refused = (input: { userId: string; state: string; now?: Date }) =>
      completeAuthorization(db, ENV, { code: "c", now: NOW, ...input }, fake.fetcher).then(
        () => "accepted",
        (error: unknown) => (error instanceof CorosGrantError ? error.failure : "other"),
      );

    const state = await start();
    expect(await refused({ userId, state: `${state}x` })).toBe("bad_state");
    expect(await refused({ userId, state: state.slice(1) })).toBe("bad_state");
    expect(await refused({ userId, state: "" })).toBe("bad_state");
    // Another user's session cannot use it, and trying does not burn the real owner's state.
    expect(await refused({ userId: other, state })).toBe("bad_state");
    expect(fake.tokenCalls).toHaveLength(0);

    expect(await refused({ userId, state })).toBe("accepted");
    // Used once: a replay is refused.
    expect(await refused({ userId, state })).toBe("bad_state");
    expect(fake.tokenCalls).toHaveLength(1);

    const stale = await start();
    expect(await refused({ userId, state: stale, now: new Date(NOW.getTime() + 11 * 60_000) })).toBe("bad_state");
    expect(fake.tokenCalls).toHaveLength(1);
  });

  test("COROS refusing the code is `rejected`, a COROS outage is `unavailable`; neither stores tokens", async () => {
    const userId = await newUser();
    const run = async (token: () => Response) => {
      const state = new URL((await startAuthorization(db, ENV, { userId, returnTo: "web", now: NOW })).url).searchParams.get("state")!;
      return completeAuthorization(db, ENV, { userId, code: "c", state, now: NOW }, fakeCoros({ token }).fetcher).catch((error: CorosGrantError) => error.failure);
    };
    expect(await run(() => Response.json({ error: "invalid_grant" }, { status: 400 }))).toBe("rejected");
    expect(await run(() => new Response("down", { status: 503 }))).toBe("unavailable");
    expect((await grantStatus(db, userId)).connected).toBe(false);
  });
});

describe("tokens", () => {
  test("a fresh token is used as is; one about to expire is refreshed with the refresh token", async () => {
    const userId = await newUser();
    await connect(userId);
    const fake = fakeCoros();
    expect(await freshAccessToken(db, ENV, userId, { now: NOW }, fake.fetcher)).toEqual({ accessToken: "acc-1" });
    expect(fake.tokenCalls).toHaveLength(0);

    const later = new Date(NOW.getTime() + 3_570_000);
    expect(await freshAccessToken(db, ENV, userId, { now: later }, fake.fetcher)).toEqual({ accessToken: "acc-new" });
    expect(fake.tokenCalls[0]!.get("grant_type")).toBe("refresh_token");
    expect(fake.tokenCalls[0]!.get("refresh_token")).toBe("ref-1");
    expect(fake.tokenCalls[0]!.get("client_id")).toBe("client-1");
    const [account] = await db.select().from(corosAccount).where(eq(corosAccount.userId, userId));
    expect(account).toMatchObject({ accessToken: "acc-new", refreshToken: "ref-new" });
  });

  test("invalid_grant ends the grant: the row goes, what was imported stays", async () => {
    const userId = await newUser();
    await connect(userId, { expiresAt: new Date(NOW.getTime() - 1000) });
    await insertExercise(userId, { date: "2026-10-23", type: "Run", durationMin: 30, source: "coros", externalId: "coros-1" });
    const fake = fakeCoros({ token: () => Response.json({ error: "invalid_grant" }, { status: 400 }) });
    await expect(freshAccessToken(db, ENV, userId, { now: NOW }, fake.fetcher)).rejects.toMatchObject({ failure: "rejected" });
    expect((await grantStatus(db, userId)).connected).toBe(false);
    expect(await exerciseRows(userId, "coros")).toHaveLength(1);
    expect(await freshAccessToken(db, ENV, userId, { now: NOW }, fake.fetcher)).toBeNull();
  });

  test("a refresh that lost the race to a newer refresh token uses the winner's token instead of ending the grant", async () => {
    const userId = await newUser();
    await connect(userId, { expiresAt: new Date(NOW.getTime() - 1000) });
    const fake = fakeCoros({
      token: async () => {
        // Meanwhile another request refreshed and stored a newer pair.
        await client.execute({ sql: "UPDATE coros_account SET refresh_token = 'ref-winner', access_token = 'acc-winner' WHERE user_id = ?", args: [userId] });
        return Response.json({ error: "invalid_grant" }, { status: 400 });
      },
    });
    expect(await freshAccessToken(db, ENV, userId, { now: NOW }, fake.fetcher)).toEqual({ accessToken: "acc-winner" });
    expect((await grantStatus(db, userId)).connected).toBe(true);
  });
});

describe("syncCoros", () => {
  test("imports the activities with measured calories, the MET estimate without, and is idempotent", async () => {
    const userId = await newUser();
    await connect(userId);
    const fake = fakeCoros({ records: RECORDS, details: DETAILS });

    const first = await sync(userId, fake);
    expect(first).toEqual({ imported: 3, skipped: 0, unparsed: 0 });
    const rows = await exerciseRows(userId, "coros");
    expect(rows.map((r) => [r.date, r.type, r.external_id])).toEqual([
      ["2026-10-20", "OtherWorkout", "coros-333"],
      ["2026-10-22", "Ride", "coros-222"],
      ["2026-10-23", "Run", "coros-111"],
    ]);
    const byId = Object.fromEntries(rows.map((r) => [r.external_id, r]));
    expect(byId["coros-111"]).toMatchObject({ kcal: 512, duration_min: 45, name: "Lari (COROS)" });
    // 90 min of cycling (MET 6.8) at the 70 kg fallback weight: 6.8 * 3.5 * 70 * 90 / 200 = 750
    expect(byId["coros-222"]!.kcal).toBe(750);
    expect(byId["coros-333"]).toMatchObject({ name: "Latihan COROS" });
    const listCall = fake.toolCalls.find((c) => c.name === "querySportRecords")!;
    expect(listCall.args).toMatchObject({ startDate: "20261010", endDate: "", sportTypeCodes: [65535], limit: 50 });
    expect(fake.toolCalls.filter((c) => c.name === "getActivityDetail")).toHaveLength(3);
    expect((await grantStatus(db, userId)).lastSyncAt).toEqual(NOW);

    // Again: nothing new, no detail call for what is stored, the window starts at the last sync minus 2 days.
    const again = fakeCoros({ records: RECORDS, details: DETAILS });
    const later = new Date(NOW.getTime() + 3_600_000);
    expect(await sync(userId, again, later)).toEqual({ imported: 0, skipped: 2, unparsed: 0 });
    expect(again.toolCalls.filter((c) => c.name === "getActivityDetail")).toHaveLength(0);
    expect(again.toolCalls.find((c) => c.name === "querySportRecords")!.args).toMatchObject({ startDate: "20261021" });
    expect(await exerciseRows(userId, "coros")).toHaveLength(3);
  });

  test("a workout Health Connect, Apple Health or Strava already holds is not imported again", async () => {
    const userId = await newUser();
    await connect(userId);
    // 111 (run, 45 min) is in Health Connect with a 1-minute difference; 222 (ride, 90 min) is on Strava as a "Ride" of 89 min.
    await insertExercise(userId, { date: "2026-10-23", type: "Run", durationMin: 46, source: "health_connect", externalId: "hc-1" });
    await insertExercise(userId, { date: "2026-10-22", type: "Ride", durationMin: 89, source: "strava", externalId: "9001" });
    const fake = fakeCoros({ records: RECORDS, details: DETAILS });
    expect(await sync(userId, fake)).toEqual({ imported: 1, skipped: 2, unparsed: 0 });
    expect((await exerciseRows(userId, "coros")).map((r) => r.external_id)).toEqual(["coros-333"]);
    // No detail call is spent on a duplicate.
    expect(fake.toolCalls.filter((c) => c.name === "getActivityDetail").map((c) => c.args.labelId)).toEqual(["333"]);
  });

  test("two real workouts of one kind in a day: one stored copy of the other source absorbs only one of them", async () => {
    const userId = await newUser();
    await connect(userId);
    const text = `1. Sport(100) — 2026-10-23\n   Duration: 30:00\n   Label ID: 1\n2. Sport(100) — 2026-10-23\n   Duration: 30:00\n   Label ID: 2`;
    await insertExercise(userId, { date: "2026-10-23", type: "Run", durationMin: 30, source: "apple_health", externalId: "ah-1" });
    const fake = fakeCoros({ records: text });
    expect(await sync(userId, fake)).toMatchObject({ imported: 1, skipped: 1 });
  });

  test("a COROS row stored before the other source's copy arrived is removed on the next sync", async () => {
    const userId = await newUser();
    await connect(userId);
    expect(await sync(userId, fakeCoros({ records: RECORDS, details: DETAILS }))).toMatchObject({ imported: 3 });
    // Health Connect now delivers the same run.
    await insertExercise(userId, { date: "2026-10-23", type: "Run", durationMin: 45, source: "health_connect", externalId: "hc-2" });
    const later = new Date(NOW.getTime() + 3_600_000);
    expect(await sync(userId, fakeCoros({ records: RECORDS, details: DETAILS }), later)).toEqual({ imported: 0, skipped: 2, unparsed: 0 });
    expect((await exerciseRows(userId, "coros")).map((r) => r.external_id)).toEqual(["coros-333", "coros-222"]);
    expect(await exerciseRows(userId, "health_connect")).toHaveLength(1);
    // And it stays out on the sync after that.
    expect(await sync(userId, fakeCoros({ records: RECORDS, details: DETAILS }), new Date(later.getTime() + 3_600_000))).toMatchObject({ imported: 0 });
  });

  test("a record that cannot be read is counted and skipped; a detail that fails costs only the measured calories", async () => {
    const userId = await newUser();
    await connect(userId);
    const text = `1. Sport(100) — 2026-10-23\n   Duration: 30:00\n   Label ID: 7\n2. Sport(100) — 2026-10-22\n   Distance: 5 km`;
    const fake = fakeCoros({ records: text });
    const original = fake.fetcher;
    fake.fetcher = async (url, init) => {
      const body = String(init?.body ?? "");
      if (body.includes('"getActivityDetail"')) return Response.json({ jsonrpc: "2.0", id: JSON.parse(body).id, result: { isError: true, content: [{ type: "text", text: "boom" }] } });
      return original(url, init);
    };
    expect(await sync(userId, fake)).toEqual({ imported: 1, skipped: 0, unparsed: 1 });
    // 30 min of running (MET 9.8) at 70 kg: 9.8 * 3.5 * 70 * 30 / 200 = 360
    expect((await exerciseRows(userId, "coros"))[0]!.kcal).toBe(360);
  });

  test("records without an identifier get a stable fallback id, so a second sync adds nothing", async () => {
    const userId = await newUser();
    await connect(userId);
    const fake = () => fakeCoros({ records: "1. Sport(9807) — 2026-10-03\n   Duration: 2:12:38 | Distance: 12.03 km" });
    expect(await sync(userId, fake(), new Date("2026-10-05T05:00:00Z"))).toMatchObject({ imported: 1 });
    expect(await sync(userId, fake(), new Date("2026-10-05T06:00:00Z"))).toMatchObject({ imported: 0, skipped: 1 });
    expect(externalIdOf({ labelId: null, sportType: 9807, date: "2026-10-03", name: null, startedAt: null, durationSec: 7958 })).toBe("coros-2026-10-03-9807-x-7958");
  });

  test("a refused access token is refreshed once and the sync goes on; a refused refresh asks to reconnect", async () => {
    const userId = await newUser();
    await connect(userId);
    const fake = fakeCoros({ records: RECORDS, details: DETAILS, validTokens: ["acc-new"] });
    expect(await sync(userId, fake)).toMatchObject({ imported: 3 });
    expect(fake.tokenCalls).toHaveLength(1);
    expect(fake.mcpAuth[0]).toBe("Bearer acc-1");
    expect(fake.mcpAuth.at(-1)).toBe("Bearer acc-new");

    const user2 = await newUser();
    await connect(user2);
    const dead = fakeCoros({ records: RECORDS, validTokens: [], token: () => Response.json({ error: "invalid_grant" }, { status: 400 }) });
    await expect(sync(user2, dead)).rejects.toMatchObject({ failure: "expired" });
    expect((await grantStatus(db, user2)).connected).toBe(false);
  });

  test("a COROS outage fails the sync, keeps the connection and notes the failure", async () => {
    const userId = await newUser();
    await connect(userId);
    const down = fakeCoros();
    down.fetcher = async () => new Response("bad gateway", { status: 502 });
    await expect(sync(userId, down)).rejects.toMatchObject({ failure: "unavailable" });
    const status = await grantStatus(db, userId);
    expect(status.connected).toBe(true);
    expect(status.lastError).toBeDefined();
    // The next good sync clears it.
    await sync(userId, fakeCoros({ records: RECORDS, details: DETAILS }));
    expect((await grantStatus(db, userId)).lastError).toBeUndefined();
  });

  test("not connected", async () => {
    const userId = await newUser();
    await expect(sync(userId, fakeCoros())).rejects.toBeInstanceOf(CorosSyncError);
  });

  test("more activities than one statement or one detail budget can take are all imported", async () => {
    const userId = await newUser();
    await connect(userId);
    const lines = Array.from({ length: 50 }, (_, i) => `${i + 1}. Sport(100) — 2026-10-${String(10 + (i % 14)).padStart(2, "0")}\n   Duration: ${10 + i}:00\n   Label ID: ${1000 + i}`);
    const fake = fakeCoros({ records: lines.join("\n") });
    expect(await sync(userId, fake)).toMatchObject({ imported: 50 });
    // Detail calls are capped at 30 per sync; the other 20 use the MET estimate.
    expect(fake.toolCalls.filter((c) => c.name === "getActivityDetail")).toHaveLength(30);
    expect(await exerciseRows(userId, "coros")).toHaveLength(50);
  });
});

describe("disconnect", () => {
  test("revokes at COROS, deletes the tokens and every COROS row, and leaves other sources alone", async () => {
    const userId = await newUser();
    await connect(userId);
    await sync(userId, fakeCoros({ records: RECORDS, details: DETAILS }));
    await insertExercise(userId, { date: "2026-10-23", type: "Walk", durationMin: 20, source: "health_connect", externalId: "hc-9" });
    await startAuthorization(db, ENV, { userId, returnTo: "web", now: NOW });

    const fake = fakeCoros();
    expect(await disconnectCoros(db, ENV, userId, fake.fetcher)).toEqual({ revoked: true });
    await deleteImportedWorkouts(db, userId);
    expect(fake.revokeCalls[0]!.get("token")).toBe("ref-1");
    expect(fake.revokeCalls[0]!.get("client_id")).toBe("client-1");
    expect((await grantStatus(db, userId)).connected).toBe(false);
    expect(await exerciseRows(userId, "coros")).toHaveLength(0);
    expect(await exerciseRows(userId, "health_connect")).toHaveLength(1);
    expect((await client.execute({ sql: "SELECT count(*) AS n FROM coros_auth_state WHERE user_id = ?", args: [userId] })).rows[0]!.n).toBe(0);
  });

  test("tokens go even when COROS refuses the revocation (a public client may not be allowed to revoke)", async () => {
    const userId = await newUser();
    await connect(userId);
    const fake = fakeCoros({ revoke: () => new Response(null, { status: 401 }) });
    expect(await disconnectCoros(db, ENV, userId, fake.fetcher)).toEqual({ revoked: false });
    expect((await grantStatus(db, userId)).connected).toBe(false);
    // Disconnecting twice is harmless.
    expect(await disconnectCoros(db, ENV, userId, fake.fetcher)).toEqual({ revoked: false });
  });
});
