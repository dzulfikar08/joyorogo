// Worst-case-sized inputs through the food/diary/plate/place/push/reminder/MCP statements that bind a caller-sized list.
// d1TestDb's client throws like D1 above 100 bound parameters, so these fail if a slice grows past the cap.
import { call } from "@orpc/server";
import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { plate } from "@joyorogo/db/schema/plans";
import { pushDevice } from "@joyorogo/db/schema/push";

import type { Context } from "../context";
import { foodRouter } from "../routers/food";
import { placeRouter } from "../routers/place";
import { plateRouter } from "../routers/plate";
import { jakartaToday, shiftDate } from "./engine";
import { loadEaten } from "./meal/store";
import { sweepMcp } from "./mcp-connections";
import { pushTestDb, seedDevice, seedFood, seedUser, wib } from "./push-test-db";
import { saveDevice, MAX_DEVICES_PER_APP } from "./push-subs";
import { runReminders } from "./reminders";
import { zonesOfUsers } from "./user-zone";

const { client, db } = await pushTestDb();
const as = (userId: string) => ({
  context: { db, env: {}, waitUntil: () => {}, session: { user: { id: userId } } } as unknown as Context,
});
const day = shiftDate(jakartaToday(), -1);
const count = async (sql: string) => Number((await client.execute(sql)).rows[0]?.n);

async function addPlates(userId: string, n: number, extra: { place?: string; priceIdr?: number }) {
  for (let i = 0; i < n; i++) {
    await call(
      foodRouter.add,
      {
        date: day,
        meal: "makan_siang",
        name: `Nasi ${i}`,
        kcal: 200,
        protein: 10,
        carbs: 30,
        fat: 5,
        grams: 100,
        plate: { name: `Piring ${i}`, ...extra },
      },
      as(userId),
    );
  }
}

describe("plate router lists far above D1's 100-parameter cap", () => {
  test("bestValue ranks 120 priced plates (the plate id list is read in slices)", async () => {
    await seedUser(client, "bv");
    await addPlates("bv", 120, { priceIdr: 10_000 });
    const ranked = await call(plateRouter.bestValue, undefined, as("bv"));
    expect(ranked).toHaveLength(120);
    expect(ranked.every((entry) => entry.nutrients.kcal === 200)).toBe(true);
  });

  test("clearLocation clears 120 located plates", async () => {
    await seedUser(client, "cl");
    await addPlates("cl", 120, { place: "Warung Bu Tini" });
    await db.update(plate).set({ lat: -6.2, lng: 106.8 }).where(eq(plate.userId, "cl"));
    expect(await call(placeRouter.clearLocation, {}, as("cl"))).toEqual({ cleared: 120 });
    expect(await count(`SELECT count(*) AS n FROM plate WHERE user_id = 'cl' AND lat IS NOT NULL`)).toBe(0);
  });
});

describe("meal plan eaten state", () => {
  test("loadEaten finds the 120 existing log ids among 150 asked for", async () => {
    await seedUser(client, "le");
    const ids = Array.from({ length: 150 }, (_, i) => `log-${i}`);
    for (const id of ids.slice(0, 120)) {
      await client.execute({
        sql: `INSERT INTO food_log (id, user_id, date, meal, name, kcal) VALUES (?, 'le', ?, 'sarapan', 'Nasi', 300)`,
        args: [id, day],
      });
    }
    const eaten = await loadEaten(db, "le", day, day, ids);
    expect(eaten.existingLogIds.size).toBe(120);
    expect(eaten.existingLogIds.has("log-119")).toBe(true);
    expect(eaten.existingLogIds.has("log-120")).toBe(false);
  });
});

describe("cron housekeeping", () => {
  test("sweepMcp deletes a full batch of 200 expired audit rows and 100 abandoned clients", async () => {
    await seedUser(client, "mc");
    const now = Date.now();
    for (let i = 0; i < 200; i++) {
      await client.execute({
        sql: `INSERT INTO mcp_audit (id, user_id, client_id, tool, outcome, ms, created_at) VALUES (?, 'mc', 'c', 't', 'ok', 1, 1)`,
        args: [`audit-${i}`],
      });
    }
    for (let i = 0; i < 100; i++) {
      await client.execute({
        sql: `INSERT INTO oauth_client (id, client_id, redirect_uris, created_at) VALUES (?, ?, '[]', 1)`,
        args: [`oc-${i}`, `client-${i}`],
      });
    }
    expect(await sweepMcp(db, now)).toEqual({ audit: 200, clients: 100 });
    expect(await count(`SELECT count(*) AS n FROM mcp_audit`)).toBe(0);
    expect(await count(`SELECT count(*) AS n FROM oauth_client`)).toBe(0);
  });

  test("zonesOfUsers reads 250 profiles", async () => {
    const ids = Array.from({ length: 250 }, (_, i) => `z${i}`);
    for (const [i, id] of ids.entries()) await seedUser(client, id, { timezone: i % 2 ? "Asia/Singapore" : "Asia/Kuala_Lumpur" });
    const zones = await zonesOfUsers(db, [...ids, "nobody"]);
    expect(zones.size).toBe(250);
    expect(zones.get("z0")).toBe("Asia/Kuala_Lumpur");
    expect(zones.get("z249")).toBe("Asia/Singapore");
  });
});

describe("push devices", () => {
  test("registering a phone trims an account that holds 120 stale ones down to the cap", async () => {
    await seedUser(client, "pd");
    for (let i = 0; i < 120; i++) await seedDevice(client, "pd", `old-${i}`);
    await saveDevice(db, "pd", { app: "joyorogo", platform: "android", expoToken: "ExponentPushToken[new]" });
    const kept = await db.select({ id: pushDevice.id }).from(pushDevice).where(eq(pushDevice.userId, "pd"));
    expect(kept).toHaveLength(MAX_DEVICES_PER_APP);
  });
});

describe("evening reminder", () => {
  test("looks up the logged days of 130 candidates at once and gives each their streak", async () => {
    const TUESDAY = "2026-10-20";
    const ids = Array.from({ length: 130 }, (_, i) => `ev${i}`);
    for (const id of ids) {
      await seedUser(client, id);
      await seedDevice(client, id, `tok-${id}`);
      for (const date of ["2026-10-16", "2026-10-17", "2026-10-18", "2026-10-19"]) await seedFood(client, id, date);
    }
    const stored = await runReminders({ db, env: { FREE_DAILY_SCANS: "3" }, now: () => wib(TUESDAY, "20:05") });
    expect(stored).toBe(130);
    const rows = (await client.execute(`SELECT kind FROM push_outbox WHERE user_id LIKE 'ev%'`)).rows;
    expect(rows).toHaveLength(130);
    expect(rows.every((row) => row.kind === "streak")).toBe(true);
  });
});
