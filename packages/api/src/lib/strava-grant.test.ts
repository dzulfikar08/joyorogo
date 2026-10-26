import { d1TestDb } from "@joyorogo/db/test-d1";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";


import {
  StravaGrantError,
  disconnectProduct,
  dropAthlete,
  exchangeCode,
  freshAccessToken,
  grantStatus,
  isJoyofitUpload,
  requestedScope,
  revokeGrant,
} from "./strava-grant";

const ENV = { STRAVA_CLIENT_ID: "287873", STRAVA_CLIENT_SECRET: "secret" };
/** Slot rules are tested in strava-capacity.test.ts; here every grant fits. */
const OPEN = { capacity: 10_000, reserve: 0, idleDays: 14 };
const ATHLETE = 4242;

const { client, db } = await d1TestDb();

let counter = 0;
async function newUser(): Promise<string> {
  counter += 1;
  const id = `u${counter}`;
  await client.execute({ sql: `INSERT INTO "user" (id, name, email) VALUES (?, ?, ?)`, args: [id, id, `${id}@test.id`] });
  return id;
}

type Call = { url: string; body: URLSearchParams };
let calls: Call[] = [];
let strava: (call: Call) => Response;
const realFetch = globalThis.fetch;

function grant(access: string, refresh: string, scope: string, expiresInS = 21_600, athlete = ATHLETE): Response {
  return Response.json({
    access_token: access,
    refresh_token: refresh,
    expires_at: Math.floor(Date.now() / 1000) + expiresInS,
    athlete: { id: athlete },
    scope,
  });
}

beforeEach(() => {
  calls = [];
  strava = () => new Response("unexpected", { status: 500 });
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: String(input), body: new URLSearchParams(String(init?.body ?? "")) };
    calls.push(call);
    return strava(call);
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const revokes = () => calls.filter((c) => c.url.endsWith("/oauth/revoke"));

async function row(userId: string) {
  const result = await client.execute({ sql: "SELECT * FROM strava_account WHERE user_id = ?", args: [userId] });
  return result.rows[0] as unknown as
    | { access_token: string; refresh_token: string; scope: string; rogo_linked_at: number | null; fit_linked_at: number | null }
    | undefined;
}

async function connectRogo(userId: string, scope = "read,activity:read_all") {
  strava = () => grant("acc-1", "ref-1", scope);
  return exchangeCode(db, ENV, { userId, product: "rogo", code: "c", callbackScope: scope, capacity: OPEN });
}

describe("scopes", () => {
  test("each product asks for its own scopes plus whatever is already granted", () => {
    expect(requestedScope("rogo", null)).toBe("read,activity:read_all");
    expect(requestedScope("fit", null)).toBe("activity:write");
    expect(requestedScope("fit", "read activity:read_all")).toBe("activity:write,read,activity:read_all");
    expect(requestedScope("rogo", "activity:write")).toBe("read,activity:read_all,activity:write");
    expect(requestedScope("rogo", "read activity:read_all activity:write")).toBe("read,activity:read_all,activity:write");
  });

  test("JoyoFit uploads are recognised by their external_id prefix", () => {
    expect(isJoyofitUpload("joyofit-2026-10-16T01:02:03.000Z")).toBe(true);
    expect(isJoyofitUpload("joyofit-2026-10-16T01:02:03.000Z.fit")).toBe(true);
    expect(isJoyofitUpload("garmin_push_123")).toBe(false);
    expect(isJoyofitUpload(undefined)).toBe(false);
  });
});

describe("exchangeCode", () => {
  test("links the product, stores the granted scope and leaves the other product's link alone", async () => {
    const userId = await newUser();
    await connectRogo(userId);
    expect(await grantStatus(db, userId, "rogo")).toMatchObject({ connected: true, athleteId: String(ATHLETE) });
    // JoyoFit is not linked yet, and read-only scopes cannot upload.
    expect((await grantStatus(db, userId, "fit")).connected).toBe(false);

    strava = () => grant("acc-2", "ref-2", "read,activity:read_all,activity:write");
    await exchangeCode(db, ENV, { userId, product: "fit", code: "c2", capacity: OPEN });
    const stored = await row(userId);
    expect(stored?.access_token).toBe("acc-2");
    expect(stored?.scope).toBe("read activity:read_all activity:write");
    expect(stored?.rogo_linked_at).not.toBeNull();
    expect(stored?.fit_linked_at).not.toBeNull();
    expect((await grantStatus(db, userId, "rogo")).connected).toBe(true);
    expect((await grantStatus(db, userId, "fit")).connected).toBe(true);
  });

  test("an athlete who unchecked the product's scope is refused, and the grant revoked when nothing else uses it", async () => {
    const userId = await newUser();
    strava = () => grant("acc-1", "ref-1", "read");
    await expect(exchangeCode(db, ENV, { userId, product: "rogo", code: "c", capacity: OPEN })).rejects.toMatchObject({ failure: "scope_missing" });
    expect(await row(userId)).toBeUndefined();
    expect(revokes()).toHaveLength(1);
    expect(revokes()[0]?.body.get("token")).toBe("ref-1");
  });

  test("a refused second authorization leaves the existing grant untouched", async () => {
    const userId = await newUser();
    await connectRogo(userId);
    strava = () => grant("acc-9", "ref-9", "read");
    await expect(exchangeCode(db, ENV, { userId, product: "fit", code: "c", capacity: OPEN })).rejects.toBeInstanceOf(StravaGrantError);
    expect((await row(userId))?.refresh_token).toBe("ref-1");
    expect(revokes()).toHaveLength(0);
  });

  test("Strava refusing the code is `rejected`, a Strava outage `unavailable`", async () => {
    const userId = await newUser();
    strava = () => new Response("bad", { status: 400 });
    await expect(exchangeCode(db, ENV, { userId, product: "rogo", code: "c", capacity: OPEN })).rejects.toMatchObject({ failure: "rejected" });
    strava = () => new Response("down", { status: 503 });
    await expect(exchangeCode(db, ENV, { userId, product: "rogo", code: "c", capacity: OPEN })).rejects.toMatchObject({ failure: "unavailable" });
    expect(await row(userId)).toBeUndefined();
  });

  test("another Strava account replaces the grant, revokes the old one and drops the other product's link", async () => {
    const userId = await newUser();
    await connectRogo(userId);
    strava = () => grant("acc-2", "ref-2", "activity:write", 21_600, 777);
    await exchangeCode(db, ENV, { userId, product: "fit", code: "c", capacity: OPEN });
    expect(revokes()[0]?.body.get("token")).toBe("ref-1");
    const stored = await row(userId);
    expect(stored?.rogo_linked_at).toBeNull();
    expect(stored?.fit_linked_at).not.toBeNull();
  });
});

describe("freshAccessToken", () => {
  test("hands out a valid token without calling Strava, and nothing for an unlinked product", async () => {
    const userId = await newUser();
    await connectRogo(userId);
    calls = [];
    expect(await freshAccessToken(db, ENV, userId, "rogo")).toMatchObject({ accessToken: "acc-1" });
    expect(await freshAccessToken(db, ENV, userId, "fit")).toBeNull();
    expect(calls).toHaveLength(0);
  });

  test("refreshes a token that expires soon and stores Strava's rotated refresh token", async () => {
    const userId = await newUser();
    strava = () => grant("acc-1", "ref-1", "activity:write", 60);
    await exchangeCode(db, ENV, { userId, product: "fit", code: "c", capacity: OPEN });
    strava = () => grant("acc-2", "ref-2", "activity:write");
    const token = await freshAccessToken(db, ENV, userId, "fit");
    expect(token?.accessToken).toBe("acc-2");
    expect(calls.at(-1)?.body.get("refresh_token")).toBe("ref-1");
    expect((await row(userId))?.refresh_token).toBe("ref-2");
  });

  test("a refresh token Strava refuses deletes the row for both products", async () => {
    const userId = await newUser();
    strava = () => grant("acc-1", "ref-1", "read,activity:read_all,activity:write", 60);
    await exchangeCode(db, ENV, { userId, product: "fit", code: "c", capacity: OPEN });
    strava = () => new Response("revoked", { status: 401 });
    expect(await freshAccessToken(db, ENV, userId, "fit")).toBeNull();
    expect(await row(userId)).toBeUndefined();
    expect((await grantStatus(db, userId, "rogo")).connected).toBe(false);
  });

  test("losing a refresh race uses the winner's token instead of deleting the row", async () => {
    const userId = await newUser();
    strava = () => grant("acc-1", "ref-1", "activity:write", 60);
    await exchangeCode(db, ENV, { userId, product: "fit", code: "c", capacity: OPEN });
    strava = () => {
      // The other request got there first: its token is stored, ours is now invalid.
      client.execute({ sql: "UPDATE strava_account SET access_token = 'acc-w', refresh_token = 'ref-w' WHERE user_id = ?", args: [userId] });
      return new Response("stale", { status: 400 });
    };
    expect((await freshAccessToken(db, ENV, userId, "fit"))?.accessToken).toBe("acc-w");
    expect((await row(userId))?.refresh_token).toBe("ref-w");
  });

  test("a Strava outage is an error, not a disconnect", async () => {
    const userId = await newUser();
    strava = () => grant("acc-1", "ref-1", "activity:write", 60);
    await exchangeCode(db, ENV, { userId, product: "fit", code: "c", capacity: OPEN });
    strava = () => new Response("down", { status: 503 });
    await expect(freshAccessToken(db, ENV, userId, "fit")).rejects.toMatchObject({ failure: "unavailable" });
    expect(await row(userId)).toBeDefined();
  });
});

describe("disconnectProduct", () => {
  test("leaving one product keeps the grant for the other; the last one revokes it at Strava", async () => {
    const userId = await newUser();
    strava = () => grant("acc-1", "ref-1", "read,activity:read_all,activity:write");
    await exchangeCode(db, ENV, { userId, product: "rogo", code: "c", capacity: OPEN });
    await exchangeCode(db, ENV, { userId, product: "fit", code: "c", capacity: OPEN });

    strava = () => new Response(null, { status: 200 });
    expect(await disconnectProduct(db, ENV, userId, "fit")).toEqual({ revoked: false });
    expect(revokes()).toHaveLength(0);
    expect((await grantStatus(db, userId, "fit")).connected).toBe(false);
    expect((await grantStatus(db, userId, "rogo")).connected).toBe(true);

    expect(await disconnectProduct(db, ENV, userId, "rogo")).toEqual({ revoked: true });
    expect(revokes()).toHaveLength(1);
    expect(revokes()[0]?.body.get("token")).toBe("ref-1");
    expect(await row(userId)).toBeUndefined();
  });

  test("the row is deleted even when Strava does not confirm the revoke", async () => {
    const userId = await newUser();
    await connectRogo(userId);
    strava = () => new Response("down", { status: 503 });
    expect(await disconnectProduct(db, ENV, userId, "rogo")).toEqual({ revoked: false });
    expect(await row(userId)).toBeUndefined();
  });

  test("disconnecting without a connection is a no-op", async () => {
    const userId = await newUser();
    expect(await disconnectProduct(db, ENV, userId, "fit")).toEqual({ revoked: true });
    expect(calls).toHaveLength(0);
  });

  test("account deletion revokes whatever the links are", async () => {
    const userId = await newUser();
    strava = () => grant("acc-1", "ref-1", "read,activity:read_all,activity:write");
    await exchangeCode(db, ENV, { userId, product: "rogo", code: "c", capacity: OPEN });
    await exchangeCode(db, ENV, { userId, product: "fit", code: "c", capacity: OPEN });
    strava = () => new Response(null, { status: 200 });
    await revokeGrant(db, ENV, userId);
    expect(revokes()).toHaveLength(1);
    expect(await row(userId)).toBeUndefined();
  });
});

describe("dropAthlete (deauthorization on strava.com)", () => {
  test("deletes every token of the athlete and the imported Strava activities, nothing else", async () => {
    const [a, b, other] = [await newUser(), await newUser(), await newUser()];
    strava = () => grant("acc", "ref", "read,activity:read_all", 21_600, 31_337);
    await exchangeCode(db, ENV, { userId: a, product: "rogo", code: "c", capacity: OPEN });
    await exchangeCode(db, ENV, { userId: b, product: "rogo", code: "c", capacity: OPEN });
    strava = () => grant("acc", "ref", "read,activity:read_all", 21_600, 999);
    await exchangeCode(db, ENV, { userId: other, product: "rogo", code: "c", capacity: OPEN });
    for (const [id, owner, source] of [
      ["e1", a, "strava"],
      ["e2", a, "manual"],
      ["e3", other, "strava"],
    ] as const) {
      await client.execute({
        sql: "INSERT INTO exercise_log (id, user_id, date, name, kcal, source) VALUES (?, ?, '2026-10-01', 'x', 100, ?)",
        args: [id, owner, source],
      });
    }

    expect((await dropAthlete(db, "31337")).sort()).toEqual([a, b].sort());
    expect(await row(a)).toBeUndefined();
    expect(await row(b)).toBeUndefined();
    expect(await row(other)).toBeDefined();
    const remaining = await client.execute("SELECT id FROM exercise_log ORDER BY id");
    expect((remaining.rows as unknown as { id: string }[]).map((r) => r.id)).toEqual(["e2", "e3"]);
    expect(await dropAthlete(db, "31337")).toEqual([]);
  });

  test("an athlete linked from more accounts than D1 binds in one statement is dropped whole", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 130; i++) {
      const id = await newUser();
      ids.push(id);
      await client.execute({
        sql: "INSERT INTO strava_account (user_id, athlete_id, access_token, refresh_token, expires_at, scope) VALUES (?, '880088', 'a', 'r', 0, 'read')",
        args: [id],
      });
      await client.execute({
        sql: "INSERT INTO exercise_log (id, user_id, date, name, kcal, source) VALUES (?, ?, '2026-10-01', 'x', 100, 'strava')",
        args: [`bulk-${id}`, id],
      });
    }
    expect((await dropAthlete(db, "880088")).sort()).toEqual([...ids].sort());
    const left = await client.execute("SELECT count(*) AS n FROM exercise_log WHERE id LIKE 'bulk-%'");
    expect(Number((left.rows[0] as unknown as { n: number }).n)).toBe(0);
    expect(await dropAthlete(db, "880088")).toEqual([]);
  });
});
