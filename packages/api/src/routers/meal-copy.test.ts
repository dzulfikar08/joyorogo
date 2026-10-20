import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { call } from "@orpc/server";
import { afterAll, describe, expect, setSystemTime, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";

// @libsql/client is a transitive dep of @joyorogo/db (see privacy.test.ts).
import { createClient } from "../../../db/node_modules/@libsql/client";
import type { Database } from "@joyorogo/db";
import { aiUsage } from "@joyorogo/db/schema/fitness";

import type { Context } from "../context";
import { jakartaToday, shiftDate } from "../lib/engine";
import { aiRouter } from "./ai";
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

/** The prompts the fake model was asked, and what it answers next. */
const prompts: string[] = [];
let answer = JSON.stringify({ items: [] });
const AI = {
  run: async (_model: string, input: { messages: Array<{ content: string }> }) => {
    prompts.push(input.messages[0]!.content);
    return { choices: [{ message: { content: answer } }] };
  },
};

const as = (userId: string) => ({
  context: {
    db,
    env: { AI },
    locale: "id",
    waitUntil: () => {},
    session: { user: { id: userId } },
  } as unknown as Context,
});
const u1 = as("u1");
const u2 = as("u2");

// Frozen clock: the story's slot, "today" and the day boundary all follow the wall clock (Jakarta), so the
// suite pins it to a fixed instant (12:00 WIB) instead of whatever time CI happens to run at.
// Rows are ordered by created_at, which SQLite fills from its own clock (ms ties between quick inserts). So
// every seeded row is stamped with the frozen clock, ticked 1ms per write, to keep insertion order.
let now = new Date(process.env.MEAL_COPY_TEST_NOW ?? "2026-03-15T05:00:00Z").getTime();
setSystemTime(now);
afterAll(() => setSystemTime());

const today = jakartaToday();
const yesterday = shiftDate(today, -1);
const SLOTS = ["sarapan", "makan_siang", "makan_malam", "snack"] as const;

const add = async (
  who: typeof u1,
  date: string,
  meal: (typeof SLOTS)[number],
  name: string,
  kcal: number,
  extra: { grams?: number; protein?: number; carbs?: number; fat?: number } = {},
) => {
  setSystemTime((now += 1));
  const out = await call(foodRouter.add, { date, meal, name, kcal, ...extra }, who);
  await client.execute({
    sql: "UPDATE food_log SET created_at = ? WHERE rowid = (SELECT max(rowid) FROM food_log)",
    args: [now],
  });
  return out;
};

await add(u1, yesterday, "sarapan", "Nasi uduk", 380, { grams: 220, protein: 9, carbs: 58, fat: 12 });
await add(u1, yesterday, "sarapan", "Telur dadar", 120, { grams: 60, protein: 8, carbs: 1, fat: 9 });
await add(u1, yesterday, "sarapan", "Teh manis", 90, { grams: 250, carbs: 22 });
await add(u1, yesterday, "makan_malam", "Sate ayam", 420, { grams: 150, protein: 30 });
await add(u1, today, "makan_siang", "Nasi padang", 700, { grams: 350 });
// Someone else's log must never be copyable.
await add(u2, yesterday, "snack", "Rahasia", 999);

const describe_ = (
  text: string,
  extra: { meal?: (typeof SLOTS)[number]; date?: string } = { meal: "makan_siang" },
  who = u1,
) => call(aiRouter.describeFood, { text, slots: [...SLOTS], ...extra }, who);

const usageRows = async () => (await db.select().from(aiUsage)).length;

describe("describeFood: 'same as' answered from the log", () => {
  test("copies yesterday's breakfast without calling the AI or spending quota", async () => {
    const before = prompts.length;
    const out = await describe_("sama kayak sarapan kemarin");
    expect(prompts.length).toBe(before);
    expect(await usageRows()).toBe(0);
    expect(out.quotaReached).toBe(false);
    expect(out.items.map((i) => [i.name, i.kcal, i.grams, i.protein])).toEqual([
      ["Nasi uduk", 380, 220, 9],
      ["Telur dadar", 120, 60, 8],
      ["Teh manis", 90, 250, undefined],
    ]);
    expect(out.reference).toMatchObject({
      status: "copied",
      via: "rule",
      from: { date: yesterday, meal: "sarapan" },
    });
  });

  test("lands on the slot being added to and the viewed day, marked as a copy", async () => {
    const out = await describe_("sama kayak sarapan kemarin", { meal: "snack", date: today });
    expect(out.items.every((i) => i.meal === "snack" && i.date === today && i.copied === true)).toBe(true);
  });

  test("without a slot it follows the clock, like any other story", async () => {
    const out = await describe_("sama kayak sarapan kemarin", {});
    expect(out.items.length).toBe(3);
    expect(new Set(out.items.map((i) => i.date))).toEqual(new Set([today]));
  });

  test("whole-meal portion changes scale stored nutrition", async () => {
    const out = await describe_("sama kayak sarapan kemarin setengah porsi");
    expect(out.items.map((i) => [i.name, i.kcal, i.grams])).toEqual([
      ["Nasi uduk", 190, 110],
      ["Telur dadar", 60, 30],
      ["Teh manis", 45, 125],
    ]);
    expect(out.items[0]).toMatchObject({ portion: "½×", protein: 4.5, carbs: 29, fat: 6 });
  });

  test("one item scaled, one removed", async () => {
    const half = await describe_("kayak sarapan kemarin tapi nasinya setengah");
    expect(half.items.map((i) => [i.name, i.kcal])).toEqual([
      ["Nasi uduk", 190],
      ["Telur dadar", 120],
      ["Teh manis", 90],
    ]);
    const dropped = await describe_("sama kayak sarapan kemarin tanpa teh manis");
    expect(dropped.items.map((i) => i.name)).toEqual(["Nasi uduk", "Telur dadar"]);
  });

  test("an English story works the same", async () => {
    const out = await describe_("same as yesterday's breakfast without tea");
    expect(out.items.map((i) => i.name)).toEqual(["Nasi uduk", "Telur dadar"]);
  });

  test("'ulang makan siang' takes the latest lunch that is not the slot being filled", async () => {
    const out = await describe_("ulang makan siang", { meal: "snack" });
    expect(out.items.map((i) => i.name)).toEqual(["Nasi padang"]);
    expect(out.reference?.from).toEqual({ date: today, meal: "makan_siang" });
  });

  test("an empty slot says so and suggests the nearest logged meal", async () => {
    const before = prompts.length;
    const out = await describe_("sama kayak makan siang kemarin");
    expect(prompts.length).toBe(before);
    expect(out.items).toEqual([]);
    expect(out.reference).toMatchObject({
      status: "empty",
      wanted: { date: yesterday, meal: "makan_siang" },
      suggestion: { date: yesterday, meal: "makan_malam", count: 1, kcal: 420 },
    });
  });

  test("removing every item reports it instead of an empty review", async () => {
    await add(u2, today, "sarapan", "Roti", 150);
    const out = await describe_("sama kayak sarapan hari ini tanpa roti", { meal: "snack" }, u2);
    expect(out.items).toEqual([]);
    expect(out.reference?.status).toBe("emptied");
  });

  test("never reads another user's log", async () => {
    const out = await describe_("sama kayak snack kemarin", { meal: "sarapan" });
    expect(out.items).toEqual([]);
    expect(out.reference?.status).toBe("empty");
  });

  test("plain descriptions still go to the AI", async () => {
    answer = JSON.stringify({ items: [{ name: "Nasi goreng", kcal: 400, meal: "makan_siang", day: null }] });
    const before = prompts.length;
    const out = await describe_("makan siang di warung yang sama, nasi goreng");
    expect(prompts.length).toBe(before + 1);
    expect(prompts.at(-1)).not.toContain("Pengguna menunjuk");
    expect(out.reference).toBeNull();
    expect(out.items.map((i) => i.name)).toEqual(["Nasi goreng"]);
  });
});

describe("describeFood: changes the rules cannot place go to the AI with the rows as context", () => {
  test("the prompt carries the referenced rows; copied items keep stored nutrition", async () => {
    answer = JSON.stringify({
      items: [
        { ref: 0, scale: 1 },
        // A model that retypes nutrition for a referenced row must not win over the log.
        { ref: 1, scale: 0.5, kcal: 9999, name: "Telur ajaib" },
        { name: "Tempe goreng", kcal: 110, grams: 50, protein: 7, meal: "sarapan", day: -1 },
      ],
    });
    const before = prompts.length;
    const usedBefore = await usageRows();
    const out = await describe_("sama kayak sarapan kemarin tapi tehnya diganti kopi dan tambah tempe", {
      meal: "snack",
      date: today,
    });
    expect(prompts.length).toBe(before + 1);
    const prompt = prompts.at(-1)!;
    expect(prompt).toContain('"name":"Nasi uduk"');
    expect(prompt).toContain('"kcal":380');
    expect(prompt).toContain('"ref":0');
    expect(prompt).toContain("tanpa ref");
    expect(out.items.map((i) => [i.name, i.kcal, i.copied === true])).toEqual([
      ["Nasi uduk", 380, true],
      ["Telur dadar", 60, true],
      ["Tempe goreng", 110, false],
    ]);
    // Everything lands on the target slot and day, whatever day the model guessed.
    expect(out.items.every((i) => i.meal === "snack" && i.date === today)).toBe(true);
    expect(out.reference).toMatchObject({ status: "copied", via: "ai", from: { date: yesterday, meal: "sarapan" } });
    expect(await usageRows()).toBe(usedBefore + 1);
  });

  test("an empty slot never reaches the AI, even for a complex story", async () => {
    const before = prompts.length;
    const out = await describe_("sama kayak makan siang kemarin tambah telur");
    expect(prompts.length).toBe(before);
    expect(out.reference?.status).toBe("empty");
  });
});

describe("food.recentMeals and food.copyMeal", () => {
  test("recentMeals lists logged meals newest first, minus the slot being added to", async () => {
    const out = await call(foodRouter.recentMeals, { meal: "makan_siang", date: today, slots: [...SLOTS] }, u1);
    expect(out.groups.map((g) => [g.date, g.meal, g.count, g.kcal])).toEqual([
      [yesterday, "makan_malam", 1, 420],
      [yesterday, "sarapan", 3, 590],
    ]);
    expect(out.groups[1]!.names).toEqual(["Nasi uduk", "Telur dadar", "Teh manis"]);
  });

  test("copyMeal returns the rows for the target slot, unchanged", async () => {
    const out = await call(
      foodRouter.copyMeal,
      { from: { date: yesterday, meal: "sarapan" }, meal: "sarapan", date: today, slots: [...SLOTS] },
      u1,
    );
    expect(out.items.map((i) => [i.name, i.kcal, i.meal, i.date, i.copied])).toEqual([
      ["Nasi uduk", 380, "sarapan", today, true],
      ["Telur dadar", 120, "sarapan", today, true],
      ["Teh manis", 90, "sarapan", today, true],
    ]);
    expect(out.reference).toMatchObject({ status: "copied", via: "chip" });
  });

  test("copyMeal on a slot with nothing logged is empty, and never leaks another user's meal", async () => {
    const out = await call(
      foodRouter.copyMeal,
      { from: { date: yesterday, meal: "snack" }, slots: [...SLOTS] },
      u1,
    );
    expect(out.items).toEqual([]);
    expect(out.reference?.status).toBe("empty");
  });

  test("saving a copy creates new rows with their own ids and the copy source", async () => {
    const [first] = (
      await call(
        foodRouter.copyMeal,
        { from: { date: yesterday, meal: "sarapan" }, meal: "snack", date: today, slots: [...SLOTS] },
        u1,
      )
    ).items;
    const saved = await call(
      foodRouter.add,
      { date: first!.date, meal: first!.meal, name: first!.name, kcal: first!.kcal, grams: first!.grams, source: "copy" },
      u1,
    );
    const original = (await call(foodRouter.listByDate, { date: yesterday }, u1)).items.find(
      (r) => r.name === "Nasi uduk",
    );
    expect(saved!.id).not.toBe(original!.id);
    expect(saved).toMatchObject({ source: "copy", meal: "snack", date: today, kcal: 380 });
  });
});
