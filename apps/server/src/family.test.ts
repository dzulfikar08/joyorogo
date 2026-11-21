import { describe, expect, test } from "bun:test";
import { Hono } from "hono";

import type { Database } from "@joyorogo/db";

import { registerFamilyRoutes } from "./family";

const AUTH = `Basic ${btoa("id:secret")}`;

function appWith(env: Record<string, string>) {
  const app = new Hono();
  registerFamilyRoutes(app, {
    env,
    getDb: () => {
      throw new Error("db must not be reached");
    },
  } as never as { env: never; getDb: () => Database });
  return app;
}

const post = (app: Hono, headers: Record<string, string>, body: unknown) =>
  app.request("/internal/joyofit/family/users", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

describe("family internal endpoint", () => {
  test("503 when the shared credentials are not configured", async () => {
    expect((await post(appWith({}), { authorization: AUTH }, { userIds: ["a"] })).status).toBe(503);
  });
  test("401 without or with wrong credentials", async () => {
    const app = appWith({ STRAVA_CLIENT_ID: "id", STRAVA_CLIENT_SECRET: "secret" });
    expect((await post(app, {}, { userIds: ["a"] })).status).toBe(401);
    expect((await post(app, { authorization: `Basic ${btoa("id:nope")}` }, { userIds: ["a"] })).status).toBe(401);
  });
  test("400 on a bad body", async () => {
    const app = appWith({ STRAVA_CLIENT_ID: "id", STRAVA_CLIENT_SECRET: "secret" });
    expect((await post(app, { authorization: AUTH }, { userIds: [] })).status).toBe(400);
    expect((await post(app, { authorization: AUTH }, { nope: 1 })).status).toBe(400);
  });
});

describe("family internal endpoint, Joyo Keluarga", () => {
  test("a household member counts as Pro while the household is paid (JoyoFit watcher limit)", async () => {
    const { d1TestDb } = await import("@joyorogo/db/test-d1");
    const { client, db } = await d1TestDb();
    const paid = Date.now() + 30 * 86_400_000;
    await client.executeMultiple(`
      INSERT INTO "user" (id, name, email) VALUES ('own', 'Own', 'own@test.id'), ('mem', 'Mem', 'mem@test.id'),
        ('out', 'Out', 'out@test.id');
      INSERT INTO household (id, owner_id, paid_until) VALUES ('h1', 'own', ${paid});
      INSERT INTO household_member (household_id, user_id, role) VALUES ('h1', 'own', 'owner'), ('h1', 'mem', 'member');
    `);
    const app = new Hono();
    registerFamilyRoutes(app, {
      env: { STRAVA_CLIENT_ID: "id", STRAVA_CLIENT_SECRET: "secret", FREE_DAILY_SCANS: "3" },
      getDb: () => db,
    } as never as { env: never; getDb: () => Database });
    const res = await post(app, { authorization: AUTH }, { userIds: ["own", "mem", "out"] });
    const { users } = (await res.json()) as { users: { id: string; pro: boolean }[] };
    const pro = Object.fromEntries(users.map((u) => [u.id, u.pro]));
    expect(pro).toEqual({ own: true, mem: true, out: false });
  });
});
