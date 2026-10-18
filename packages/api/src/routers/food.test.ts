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
const u1 = {
  context: {
    db,
    env: {},
    waitUntil: () => {},
    session: { user: { id: "u1" } },
  } as unknown as Context,
};

const u2 = { context: { ...u1.context, session: { user: { id: "u2" } } } as unknown as Context };

const logNasi = () =>
  call(
    foodRouter.add,
    { date: "2026-10-14", meal: "makan_siang", name: "Nasi goreng", grams: 200, kcal: 300, protein: 8, carbs: 45, fat: 9, fiber: 2 },
    u1,
  );

describe("food.update portion edits", () => {
  test("a weighed 99 g rescales kcal and macros instead of keeping the AI's 300 kcal", async () => {
    const row = await logNasi();
    const updated = await call(foodRouter.update, { id: row!.id, grams: 99 }, u1);
    expect(updated).toMatchObject({ grams: 99, kcal: 149, protein: 4, carbs: 22.3, fat: 4.5, fiber: 1 });
  });

  test("an explicitly typed kcal wins over the rescale", async () => {
    const row = await logNasi();
    const updated = await call(foodRouter.update, { id: row!.id, grams: 99, kcal: 280 }, u1);
    expect(updated).toMatchObject({ grams: 99, kcal: 280 });
  });

  test("an explicitly typed macro wins for that field only", async () => {
    const row = await logNasi();
    const updated = await call(foodRouter.update, { id: row!.id, grams: 100, carbs: 40 }, u1);
    expect(updated).toMatchObject({ grams: 100, kcal: 150, protein: 4, carbs: 40, fat: 4.5, fiber: 1 });
  });

  test("a row without a stored weight keeps its kcal when grams are set", async () => {
    const row = await call(foodRouter.add, { date: "2026-10-14", meal: "snack", name: "Kue", kcal: 120 }, u1);
    const updated = await call(foodRouter.update, { id: row!.id, grams: 50 }, u1);
    expect(updated).toMatchObject({ grams: 50, kcal: 120 });
  });
});

describe("food.recalculatePlate", () => {
  // The owner's scan: 50 g of martabak telur saved at 300 kcal (band clamp bug).
  const martabak = {
    name: "martabak telur",
    grams: 50,
    kcal: 300,
    protein: 4,
    carbs: 12,
    fat: 9,
    fiber: 1,
  };
  const aiJson = (items: unknown[]) => JSON.stringify(items);
  const logRow = (
    plate: string | undefined,
    row: Omit<typeof martabak, "fiber"> & { fiber?: number; source?: "manual" | "ai" | "barcode"; itemsJson?: string },
  ) =>
    call(
      foodRouter.add,
      {
        date: "2026-10-14",
        meal: "snack",
        source: "ai",
        ...row,
        ...(plate ? { plateId: plate } : { plate: { name: "Martabak" } }),
      },
      u1,
    );
  const firstRow = () => logRow(undefined, { ...martabak, itemsJson: aiJson([martabak]) });
  const kcalOf = async (id: string) => {
    const day = await call(foodRouter.listByDate, { date: "2026-10-14" }, u1);
    return day.items.find((row) => row.id === id)!;
  };

  test("a 50 g martabak telur at 300 kcal previews 125 and saves nothing until apply", async () => {
    const row = await firstRow();
    const preview = await call(foodRouter.recalculatePlate, { plateId: row!.plateId! }, u1);
    expect(preview.applied).toBe(false);
    expect(preview.items).toHaveLength(1);
    expect(preview.items[0]).toMatchObject({
      id: row!.id,
      before: { kcal: 300 },
      after: { kcal: 125, protein: 4, carbs: 12, fat: 9 },
    });
    expect(preview.totals).toEqual({ before: 300, after: 125 });
    expect((await kcalOf(row!.id)).kcal).toBe(300);

    const applied = await call(foodRouter.recalculatePlate, { plateId: row!.plateId!, apply: true }, u1);
    expect(applied.applied).toBe(true);
    expect(applied.updated.map((r) => r.id)).toEqual([row!.id]);
    expect(await kcalOf(row!.id)).toMatchObject({ kcal: 125, grams: 50, protein: 4, carbs: 12, fat: 9 });

    const again = await call(foodRouter.recalculatePlate, { plateId: row!.plateId! }, u1);
    expect(again.items).toEqual([]);
  });

  test("macros that no longer fit the new kcal follow it", async () => {
    const item = { name: "ayam goreng", grams: 40, kcal: 300, protein: 30, carbs: 20, fat: 18 };
    const row = await logRow(undefined, { ...item, itemsJson: aiJson([item]) });
    const { items } = await call(foodRouter.recalculatePlate, { plateId: row!.plateId! }, u1);
    // library 260 kcal/100 g x 40 g = 104
    expect(items[0]!.after.kcal).toBe(104);
    expect(items[0]!.after.protein).toBe(10.4);
    expect(items[0]!.after.fat).toBe(6.2);
  });

  test("manual, barcode and user-edited rows are left alone, and a plate with nothing to do previews empty", async () => {
    const first = await logRow(undefined, { ...martabak, source: "manual" });
    const plateId = first!.plateId!;
    await logRow(plateId, { ...martabak, source: "barcode", itemsJson: aiJson([martabak]) });
    // Saved at 300 kcal by the AI, later typed down to 280 by the user.
    const edited = await logRow(plateId, { ...martabak, itemsJson: aiJson([martabak]) });
    await call(foodRouter.update, { id: edited!.id, kcal: 280 }, u1);
    // Weight edited after the scan.
    const reweighed = await logRow(plateId, { ...martabak, itemsJson: aiJson([martabak]) });
    await call(foodRouter.update, { id: reweighed!.id, grams: 60, kcal: 300 }, u1);

    const result = await call(foodRouter.recalculatePlate, { plateId, apply: true }, u1);
    expect(result.items).toEqual([]);
    expect(result.totals).toEqual({ before: 1180, after: 1180 });
    expect((await kcalOf(first!.id)).kcal).toBe(300);
    expect((await kcalOf(edited!.id)).kcal).toBe(280);
    expect((await kcalOf(reweighed!.id)).kcal).toBe(300);
  });

  test("a dish without a reference keeps its kcal but never exceeds 9 kcal per gram", async () => {
    const odd = { name: "makanan misterius", grams: 10, kcal: 400, protein: 1, carbs: 1, fat: 1 };
    const sane = { name: "makanan misterius", grams: 100, kcal: 400, protein: 1, carbs: 1, fat: 1 };
    const row = await logRow(undefined, odd);
    await logRow(row!.plateId!, sane);
    const { items } = await call(foodRouter.recalculatePlate, { plateId: row!.plateId! }, u1);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: row!.id, after: { kcal: 90 } });
  });

  test("rows without a stored weight are skipped", async () => {
    const row = await call(
      foodRouter.add,
      { date: "2026-10-14", meal: "snack", name: "martabak telur", kcal: 300, source: "ai", plate: { name: "Tanpa gram" } },
      u1,
    );
    const { items } = await call(foodRouter.recalculatePlate, { plateId: row!.plateId! }, u1);
    expect(items).toEqual([]);
  });

  test("another user's plate is rejected and stays untouched", async () => {
    const row = await firstRow();
    await expect(
      call(foodRouter.recalculatePlate, { plateId: row!.plateId!, apply: true }, u2),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      call(foodRouter.recalculatePlate, { plateId: "no-such-plate" }, u1),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await kcalOf(row!.id)).kcal).toBe(300);
  });
});
