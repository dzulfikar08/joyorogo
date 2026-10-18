import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { call } from "@orpc/server";
import { describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";

// @libsql/client is a transitive dep of @joyorogo/db (see privacy.test.ts).
import { createClient } from "../../../db/node_modules/@libsql/client";
import type { Database } from "@joyorogo/db";

import type { Context } from "../context";
import { activityRouter } from "./activity";
import { sleepRouter } from "./sleep";

const client = createClient({ url: ":memory:" });
const migrationsDir = join(import.meta.dir, "../../../db/src/migrations");
for (const file of readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort()) {
  await client.executeMultiple(readFileSync(join(migrationsDir, file), "utf8"));
}
await client.executeMultiple(`INSERT INTO "user" (id, name, email, tier) VALUES ('u', 'u', 'u@test.id', 'free');`);

const db = drizzle(client) as unknown as Database;
const ctx = { context: { db, env: {}, waitUntil: () => {}, session: { user: { id: "u" } } } as unknown as Context };

const day = (date: string, steps: number, source: "health_connect" | "apple_health") =>
  call(activityRouter.upsert, { date, steps, distanceMeters: steps * 0.7, activeCalories: 100, exerciseMinutes: 10, source }, ctx);
const night = (date: string, hours: number, source: "manual" | "health_connect" | "apple_health") =>
  call(sleepRouter.log, { date, hours, source }, ctx);

describe("two phones importing the same day (Android Health Connect, iPhone Apple Health)", () => {
  test("a day's steps never go down because the other phone synced last", async () => {
    await day("2026-10-17", 12_000, "health_connect");
    const kept = await day("2026-10-17", 3_000, "apple_health");
    expect(kept?.steps).toBe(12_000);
    expect(kept?.source).toBe("health_connect");
    const more = await day("2026-10-17", 12_500, "apple_health");
    expect(more?.steps).toBe(12_500);
    expect(more?.source).toBe("apple_health");
  });

  test("the same source always refreshes its own row, even downward", async () => {
    await day("2026-10-16", 9_000, "health_connect");
    const fixed = await day("2026-10-16", 8_000, "health_connect");
    expect(fixed?.steps).toBe(8_000);
  });

  test("sleep: the longer import wins across sources, a manual entry is never replaced", async () => {
    await night("2026-10-17", 7, "health_connect");
    expect(await night("2026-10-17", 5, "apple_health")).toBeNull();
    const longer = await night("2026-10-17", 7.5, "apple_health");
    expect(longer?.hours).toBe(7.5);
    expect(longer?.source).toBe("apple_health");

    await night("2026-10-16", 6, "manual");
    expect(await night("2026-10-16", 9, "health_connect")).toBeNull();
    expect((await call(sleepRouter.getForDate, { date: "2026-10-16" }, ctx))?.hours).toBe(6);
  });
});
