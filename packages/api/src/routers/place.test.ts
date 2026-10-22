import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { call } from "@orpc/server";
import { describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";

// @libsql/client is a transitive dep of @joyorogo/db (see privacy.test.ts).
import { createClient } from "../../../db/node_modules/@libsql/client";
import type { Database } from "@joyorogo/db";

import type { Context } from "../context";
import { foodRouter } from "./food";
import { placeRouter } from "./place";

const client = createClient({ url: ":memory:" });
const migrationsDir = join(import.meta.dir, "../../../db/src/migrations");
for (const file of readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort()) {
  await client.executeMultiple(readFileSync(join(migrationsDir, file), "utf8"));
}
await client.executeMultiple(`
  INSERT INTO "user" (id, name, email) VALUES ('u1', 'u1', 'u1@test.id'), ('u2', 'u2', 'u2@test.id');
`);

const db = drizzle(client) as unknown as Database;
const ctx = (userId: string) =>
  ({ db, env: {}, waitUntil: () => {}, session: { user: { id: userId } } }) as unknown as Context;
const u1 = { context: ctx("u1") };
const u2 = { context: ctx("u2") };

describe("place router", () => {
  test("aggregate, detail, relog, clear location, owner isolation", async () => {
    await call(
      foodRouter.add,
      {
        date: "2026-10-12",
        meal: "makan_siang",
        name: "Nasi ayam",
        kcal: 500,
        source: "barcode",
        scanId: "a".repeat(32),
        plate: { place: "Warung Bu Tini", priceIdr: 20000, lat: -7.98391, lng: 112.63003 },
      },
      u1,
    );
    await call(
      foodRouter.add,
      {
        date: "2026-10-14",
        meal: "makan_siang",
        name: "Nasi ayam",
        kcal: 520,
        source: "barcode",
        plate: { place: "warung  bu tini", priceIdr: 24000, lat: -7.98391, lng: 112.63003 },
      },
      u1,
    );
    // lat/lng without a place are dropped; a plate without a place is not a place
    await call(
      foodRouter.add,
      { date: "2026-10-14", meal: "snack", name: "Roti", kcal: 200, source: "barcode", plate: { priceIdr: 5000, lat: -7.9, lng: 112.6 } },
      u1,
    );
    await call(
      foodRouter.add,
      { date: "2026-10-14", meal: "snack", name: "Teh", kcal: 50, plate: { place: "Kafe Lain" } },
      u2,
    );

    const { places } = await call(placeRouter.list, undefined, u1);
    expect(places).toHaveLength(1);
    const [tini] = places;
    expect(tini).toMatchObject({
      key: "warung bu tini",
      visits: 2,
      lastDate: "2026-10-14",
      avgKcal: 510,
      avgProteinG: null,
      proteinPick: null,
      avgPriceIdr: 22000,
      lat: -7.984,
      lng: 112.63,
    });
    const orphan = await client.execute("SELECT count(*) AS n FROM plate WHERE lat IS NOT NULL AND place IS NULL");
    expect(orphan.rows[0]?.n).toBe(0);

    const detail = await call(placeRouter.detail, { key: "Warung Bu Tini" }, u1);
    expect(detail?.total).toBe(2);
    expect(detail?.dishes).toEqual([{ name: "Nasi ayam", count: 2, avgKcal: 510, avgProteinG: null }]);
    expect(detail?.visits[0]).toMatchObject({ date: "2026-10-14", kcal: 520, proteinG: null, hasLocation: true });
    expect(await call(placeRouter.detail, { key: "Warung Bu Tini" }, u2)).toBeNull();

    const relogged = await call(placeRouter.relog, { plateId: detail!.visits[0]!.id, date: "2026-10-15", meal: "sarapan" }, u1);
    expect(relogged.items).toHaveLength(1);
    expect(relogged.items[0]).toMatchObject({ name: "Nasi ayam", date: "2026-10-15", meal: "sarapan" });
    const again = await call(placeRouter.list, undefined, u1);
    expect(again.places[0]?.visits).toBe(3);
    await expect(call(placeRouter.relog, { plateId: detail!.visits[0]!.id }, u2)).rejects.toThrow();

    const cleared = await call(placeRouter.clearLocation, { key: "warung bu tini" }, u1);
    expect(cleared.cleared).toBe(3);
    const after = await call(placeRouter.list, undefined, u1);
    expect(after.places[0]).toMatchObject({ visits: 3, lat: null, lng: null });
  });
});
