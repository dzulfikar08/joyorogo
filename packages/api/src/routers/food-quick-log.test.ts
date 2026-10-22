// "Catat cepat": a food logged by name and kcal (the chips of recent foods, the manual form with its macro fields
// closed) used to be saved with null protein/carbs/fat and counted as 0 g in every day total.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { call } from "@orpc/server";
import { describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";

// @libsql/client is a transitive dep of @joyorogo/db (see privacy.test.ts).
import { createClient } from "../../../db/node_modules/@libsql/client";
import type { Database } from "@joyorogo/db";

import type { Context } from "../context";
import { MACRO_AI_PER_DAY, foodNameOnly, macrosFromParsed } from "../lib/macro-estimate";
import { foodRouter } from "./food";

const client = createClient({ url: ":memory:" });
const migrationsDir = join(import.meta.dir, "../../../db/src/migrations");
for (const file of readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort()) {
  await client.executeMultiple(readFileSync(join(migrationsDir, file), "utf8"));
}
await client.executeMultiple(`INSERT INTO "user" (id, name, email) VALUES ('q1', 'q1', 'q1@test.id');`);

const db = drizzle(client) as unknown as Database;
const DAY = "2026-10-20";

type StubItem = { name: string; kcal: number; protein: number; carbs: number; fat: number; grams?: number };
/** Workers AI stub answering the story prompt with the given items; counts its calls. */
function aiAnswering(items: StubItem[]) {
  const stub = {
    calls: 0,
    run: async () => {
      stub.calls += 1;
      return { choices: [{ message: { content: JSON.stringify({ items }) } }] };
    },
  };
  return stub;
}

const as = (ai?: { run: () => Promise<unknown> }) => ({
  context: {
    db,
    env: ai ? { AI: ai } : {},
    waitUntil: () => {},
    session: { user: { id: "q1" } },
  } as unknown as Context,
});

const dayTotals = async () => (await call(foodRouter.listByDate, { date: DAY }, as())).totals;

describe("quick log keeps macros", () => {
  test("a recent-food chip repeats the macros of the row it repeats", async () => {
    const first = await call(
      foodRouter.add,
      { date: "2026-10-18", meal: "sarapan", name: "Bubur ayam spesial", kcal: 320, protein: 14, carbs: 48, fat: 8, fiber: 2, grams: 250 },
      as(),
    );
    const recent = await call(foodRouter.recent, undefined, as());
    const chip = recent.items.find((item) => item.name === "Bubur ayam spesial")!;
    expect(chip).toMatchObject({ kcal: 320, protein: 14, carbs: 48, fat: 8, fiber: 2, grams: 250 });

    // What both clients now send for a chip tap.
    const tapped = await call(
      foodRouter.add,
      { date: DAY, meal: "makan_siang", name: chip.name, kcal: chip.kcal, grams: chip.grams!, protein: chip.protein!, carbs: chip.carbs!, fat: chip.fat!, fiber: chip.fiber! },
      as(),
    );
    expect(tapped).toMatchObject({ protein: 14, carbs: 48, fat: 8, fiber: 2 });
    expect(first!.id).not.toBe(tapped!.id);
    expect(await dayTotals()).toMatchObject({ kcal: 320, protein: 14, carbs: 48, fat: 8 });
  });

  test("a chip of an old kcal-only row has null macros in recent, not zero", async () => {
    await client.execute({
      sql: `INSERT INTO food_log (id, user_id, date, meal, name, kcal, source) VALUES ('old1', 'q1', '2026-10-19', 'snack', 'Kue lapis lama', 180, 'manual')`,
      args: [],
    });
    const recent = await call(foodRouter.recent, undefined, as());
    expect(recent.items.find((item) => item.name === "Kue lapis lama")).toMatchObject({
      kcal: 180,
      protein: null,
      carbs: null,
      fat: null,
    });
  });

  test("kcal-only '350 kcal nasi goreng' resolves macros from the story text parse, scaled to the typed kcal", async () => {
    const ai = aiAnswering([{ name: "Nasi goreng", grams: 250, kcal: 400, protein: 12, carbs: 60, fat: 12 }]);
    const row = await call(foodRouter.add, { date: DAY, meal: "makan_malam", name: "nasi goreng", kcal: 350 }, as(ai));
    expect(ai.calls).toBe(1);
    expect(row!.kcal).toBe(350);
    // 350/400 of the parse's macros; kcal is never changed by the estimate.
    expect(row).toMatchObject({ protein: 10.5, carbs: 52.5, fat: 10.5 });
  });

  test("'2 telur rebus' (no table row) resolves macros through the parse and the day total counts them", async () => {
    const before = await dayTotals();
    const ai = aiAnswering([{ name: "Telur rebus", grams: 100, kcal: 155, protein: 12.6, carbs: 1.1, fat: 10.6 }]);
    const row = await call(foodRouter.add, { date: DAY, meal: "sarapan", name: "2 telur rebus", kcal: 155 }, as(ai));
    // The story pipeline calibrates the parse before the macros are taken, so the numbers are its own.
    expect(row!.kcal).toBe(155);
    expect(row!.protein).toBeGreaterThan(10);
    expect(row!.carbs).toBeGreaterThan(0);
    expect(row!.fat).toBeGreaterThan(8);
    const after = await dayTotals();
    expect(after.protein - before.protein).toBeCloseTo(row!.protein!, 5);
    expect(after.carbs - before.carbs).toBeCloseTo(row!.carbs!, 5);
    expect(after.fat - before.fat).toBeCloseTo(row!.fat!, 5);
  });

  test("a name the food table knows is resolved without calling the model", async () => {
    const ai = aiAnswering([]);
    const row = await call(foodRouter.add, { date: DAY, meal: "snack", name: "2 tahu goreng", kcal: 230 }, as(ai));
    expect(ai.calls).toBe(0);
    // TKPI 2019 "Tahu goreng" 115 kcal, 9.7 P, 2.5 C, 8.5 L per 100 g, x2.
    expect(row).toMatchObject({ kcal: 230, protein: 19.4, carbs: 5, fat: 17 });
  });

  test("macros the person typed are never replaced, and a typed 0 counts", async () => {
    const ai = aiAnswering([{ name: "Teh manis", kcal: 100, protein: 5, carbs: 5, fat: 5 }]);
    const typed = await call(foodRouter.add, { date: DAY, meal: "snack", name: "nasi goreng", kcal: 350, protein: 9 }, as(ai));
    expect(typed).toMatchObject({ protein: 9, carbs: null, fat: null });
    const zero = await call(foodRouter.add, { date: DAY, meal: "snack", name: "Air putih", kcal: 5, protein: 0, carbs: 0, fat: 0 }, as(ai));
    expect(zero).toMatchObject({ protein: 0, carbs: 0, fat: 0 });
    expect(ai.calls).toBe(0);
  });

  test("photo, barcode and copied rows are left as they come", async () => {
    const ai = aiAnswering([{ name: "x", kcal: 100, protein: 5, carbs: 5, fat: 5 }]);
    for (const source of ["ai", "barcode", "copy"] as const) {
      const row = await call(foodRouter.add, { date: DAY, meal: "snack", name: "nasi goreng", kcal: 350, source }, as(ai));
      expect(row).toMatchObject({ protein: null, carbs: null, fat: null });
    }
    expect(ai.calls).toBe(0);
  });

  test("no model, an empty answer or a failing model leaves the row saved without macros", async () => {
    const none = await call(foodRouter.add, { date: DAY, meal: "snack", name: "kue ajaib satu", kcal: 100 }, as());
    expect(none).toMatchObject({ kcal: 100, protein: null, carbs: null, fat: null });
    const broken = { run: async () => Promise.reject(new Error("503")) };
    const failed = await call(foodRouter.add, { date: DAY, meal: "snack", name: "kue ajaib dua", kcal: 100 }, as(broken));
    expect(failed).toMatchObject({ kcal: 100, protein: null, carbs: null, fat: null });
  });

  test("a parse whose energy is far from the typed kcal is not trusted", async () => {
    const ai = aiAnswering([{ name: "Kue ajaib", kcal: 1000, protein: 30, carbs: 100, fat: 50 }]);
    const row = await call(foodRouter.add, { date: DAY, meal: "snack", name: "kue ajaib tiga", kcal: 100 }, as(ai));
    expect(row).toMatchObject({ protein: null, carbs: null, fat: null });
  });

  test("the daily cap of model estimates holds", async () => {
    await client.execute({ sql: `DELETE FROM ai_usage WHERE user_id = 'q1' AND scan_type = 'macros'`, args: [] });
    for (let i = 0; i < MACRO_AI_PER_DAY; i++) {
      await client.execute({
        sql: `INSERT INTO ai_usage (id, user_id, model, scan_type, latency_ms) VALUES (?, 'q1', 'm', 'macros', 1)`,
        args: [`cap-${i}`],
      });
    }
    const ai = aiAnswering([{ name: "Kue", kcal: 100, protein: 5, carbs: 5, fat: 5 }]);
    const row = await call(foodRouter.add, { date: DAY, meal: "snack", name: "kue ajaib empat", kcal: 100 }, as(ai));
    expect(ai.calls).toBe(0);
    expect(row).toMatchObject({ protein: null });
  });
});

describe("macro estimate helpers", () => {
  test("foodNameOnly drops the quantity and a typed kcal, never the food", () => {
    expect(foodNameOnly("2 telur rebus")).toBe("telur rebus");
    expect(foodNameOnly("2 butir telur ceplok")).toBe("telur ceplok");
    expect(foodNameOnly("350 kcal nasi goreng")).toBe("nasi goreng");
    expect(foodNameOnly("1/2 porsi gado-gado")).toBe("gado-gado");
    expect(foodNameOnly("7up")).toBe("7up");
    expect(foodNameOnly("350")).toBe("350");
  });

  test("macrosFromParsed sums items, scales to the typed kcal, and needs every macro", () => {
    expect(
      macrosFromParsed(
        [
          { kcal: 100, protein: 10, carbs: 10, fat: 1 },
          { kcal: 100, protein: 2, carbs: 20, fat: 1 },
        ],
        100,
      ),
    ).toEqual({ protein: 6, carbs: 15, fat: 1 });
    expect(macrosFromParsed([{ kcal: 100, protein: 10, carbs: 10 }], 100)).toBeNull();
    expect(macrosFromParsed([], 100)).toBeNull();
  });
});
