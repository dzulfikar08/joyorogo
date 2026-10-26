import { d1TestDb } from "@joyorogo/db/test-d1";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";

import { registerStravaRoutes } from "./strava";

const ENV = {
  STRAVA_CLIENT_ID: "287873",
  STRAVA_CLIENT_SECRET: "secret",
  STRAVA_CAPACITY: "3",
  STRAVA_PAID_RESERVE: "1",
};
const AUTH = { authorization: `Basic ${btoa("287873:secret")}` };

const { client, db } = await d1TestDb();
const app = new Hono();
registerStravaRoutes(app, { env: ENV, getDb: () => db });

const post = (path: string, body: unknown, headers: Record<string, string> = AUTH) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

let revoked: string[] = [];
const realFetch = globalThis.fetch;
beforeEach(async () => {
  revoked = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = new URLSearchParams(String(init?.body ?? ""));
    if (String(input).endsWith("/oauth/revoke")) {
      revoked.push(body.get("token") ?? "");
      return new Response(null, { status: 200 });
    }
    return Response.json({
      access_token: "acc",
      refresh_token: "ref-new",
      expires_at: Math.floor(Date.now() / 1000) + 21_600,
      athlete: { id: 555 },
      scope: "activity:write",
    });
  }) as typeof fetch;
  for (const table of ["strava_account", "strava_release", "user"])
    await client.execute(`DELETE FROM "${table}"`);
  for (const [id, tier] of [
    ["owner", "founder"],
    ["a", "free"],
    ["b", "free"],
    ["new", "free"],
  ]) {
    await client.execute({
      sql: `INSERT INTO "user" (id, name, email, tier) VALUES (?, ?, ?, ?)`,
      args: [id, id, `${id}@t.id`, tier],
    });
  }
  for (const [userId, athlete] of [
    ["owner", "1"],
    ["a", "2"],
  ]) {
    await client.execute({
      sql: `INSERT INTO strava_account (user_id, athlete_id, access_token, refresh_token, expires_at, scope, fit_linked_at, updated_at)
            VALUES (?, ?, 'acc', ?, 0, 'activity:write', 0, 0)`,
      args: [userId, athlete, `ref-${athlete}`],
    });
  }
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("Strava slots on the internal routes", () => {
  test("status tells a free user the reserve is all that is left", async () => {
    const body = await (await post("/internal/joyofit/strava/status", { userId: "new" })).json();
    expect(body).toMatchObject({
      connected: false,
      slotsFull: true,
      slotsReason: "reserved_for_paid",
    });
    expect(
      await (await post("/internal/joyofit/strava/status", { userId: "a" })).json(),
    ).toMatchObject({ connected: true, slotsFull: false });
  });

  test("a refused exchange answers 409 slots_full and revokes the fresh grant", async () => {
    const response = await post("/internal/joyofit/strava/exchange", {
      userId: "new",
      code: "c",
      callbackScope: "activity:write",
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "slots_full", reason: "reserved_for_paid" });
    expect(revoked).toEqual(["ref-new"]);
  });

  test("release needs the application credentials, releases named athletes and never the owner", async () => {
    expect((await post("/internal/strava/release", { athleteIds: ["2"] }, {})).status).toBe(401);
    expect((await post("/internal/strava/release", { athleteIds: [] })).status).toBe(400);
    const response = await post("/internal/strava/release", { athleteIds: [2, "1", "9"] });
    expect(await response.json()).toEqual({
      results: [
        {
          athleteId: "2",
          outcome: "released",
          revoked: true,
          users: 1,
          lastUsedAt: new Date(0).toISOString(),
        },
        { athleteId: "1", outcome: "paid", users: 1, lastUsedAt: new Date(0).toISOString() },
        { athleteId: "9", outcome: "not_found", users: 0 },
      ],
    });
    expect(revoked).toEqual(["ref-2"]);
    const status = await (await post("/internal/joyofit/strava/status", { userId: "a" })).json();
    expect(status).toMatchObject({
      connected: false,
      slotsFull: false,
      released: { reason: "released_for_pro" },
    });
  });
});
