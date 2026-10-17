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
