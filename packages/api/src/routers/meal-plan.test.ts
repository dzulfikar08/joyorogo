import { call } from "@orpc/server";
import { describe, expect, test } from "bun:test";

import { d1TestDb } from "@joyorogo/db/test-d1";

import type { Context } from "../context";
import { jakartaToday, shiftDate } from "../lib/engine";
import { computePortion, INGREDIENTS, recipeById, RECIPES } from "../lib/meal/catalog";
import { mealPlanRouter } from "./meal-plan";

const { client, db } = await d1TestDb();

const today = jakartaToday();
const old = 1_700_000_000_000;

// Owner-like profile: a 170 cm man on a cut (eat target in the 1,500-2,100 kcal band, protein goal near 110 g).
await client.executeMultiple(`
  INSERT INTO "user" (id, name, email, tier, created_at) VALUES
    ('pro', 'pro', 'pro@test.id', 'founder', ${old}),
    ('free', 'free', 'free@test.id', 'free', ${old}),
    ('other', 'other', 'other@test.id', 'founder', ${old}),
    ('noprofile', 'noprofile', 'noprofile@test.id', 'founder', ${old});
  INSERT INTO profile (user_id, birth_year, gender, height_cm, start_weight_kg, target_weight_kg, target_date, activity_level)
    SELECT id, 1988, 'male', 172, 80, 72, '2031-01-01', 'light' FROM "user" WHERE id IN ('pro', 'free', 'other');
`);

// A server WITH a paywall: FREE_DAILY_SCANS set, so only founders are Pro.
const as = (userId: string) =>
  ({
    context: { db, env: { FREE_DAILY_SCANS: "3" }, locale: "id", waitUntil: () => {}, session: { user: { id: userId, createdAt: new Date(old) } } } as unknown as Context,
  });

const overview = async (userId: string) => call(mealPlanRouter.overview, undefined, as(userId));
type Ready = Extract<Awaited<ReturnType<typeof overview>>, { status: "ready" }>;
const ready = async (userId: string): Promise<Ready> => {
  const o = await overview(userId);
  if (o.status !== "ready") throw new Error(`expected ready, got ${o.status}`);
  return o;
};
const generate = (userId: string, regenerate = false) => call(mealPlanRouter.generate, { regenerate }, as(userId));

const sql = (text: string, args: (string | number | null)[] = []) => client.execute({ sql: text, args });

describe("mealPlan: Pro gate (server side)", () => {
  test("a free account gets a teaser only: one meal, the rest counted", async () => {
    const o = await overview("free");
    expect(o.status).toBe("locked");
    if (o.status !== "locked") return;
    expect(o.preview.item === null || o.preview.item.nutrition.kcal > 0).toBe(true);
    expect(o.preview.hidden).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(o)).not.toContain("steps");
  });

  test("every other procedure refuses a free account with the paywall flag", async () => {
    const calls: [string, () => Promise<unknown>][] = [
      ["generate", () => generate("free")],
      ["recipe", () => call(mealPlanRouter.recipe, { id: RECIPES[0]?.id ?? "x", scale: 1, carbScale: 1 }, as("free"))],
      ["shopping", () => call(mealPlanRouter.shopping, undefined, as("free"))],
      ["prefs", () => call(mealPlanRouter.prefs, undefined, as("free"))],
      ["setPrefs", () => call(mealPlanRouter.setPrefs, { allergens: [], dislikes: [], budgetFriendly: false, cookPref: "mixed" }, as("free"))],
      ["eat", () => call(mealPlanRouter.eat, { date: today, slot: "sarapan" }, as("free"))],
      ["swapOptions", () => call(mealPlanRouter.swapOptions, { date: today, slot: "sarapan" }, as("free"))],
      ["checkItem", () => call(mealPlanRouter.checkItem, { key: "nasi", checked: true }, as("free"))],
    ];
    for (const [name, run] of calls) {
      const err = await run().then(
        () => null,
        (e: unknown) => e as { code?: string; data?: { paywall?: boolean } },
      );
      expect(err?.code, name).toBe("FORBIDDEN");
      expect(err?.data?.paywall, name).toBe(true);
    }
  });

  test("a server without a paywall unlocks it for everyone", async () => {
    const open = { context: { ...as("free").context, env: {} } as Context };
    const o = await call(mealPlanRouter.overview, undefined, open);
    expect(o.status).toBe("ready");
  });

  test("an account without a profile gets noProfile, not an error", async () => {
    expect((await overview("noprofile")).status).toBe("noProfile");
  });
});

describe("mealPlan: plan", () => {
  test("starts empty, then generate builds 7 days from today that fit the day's targets", async () => {
    const first = await ready("pro");
    expect(first.plan).toBeNull();
    const week = await generate("pro");
    expect(week.days).toHaveLength(7);
    expect(week.days[0]?.date).toBe(today);
    expect(week.days.at(-1)?.date).toBe(shiftDate(today, 6));
    for (const day of week.days.slice(1)) {
      expect(day.items.length).toBe(4);
      expect(Math.abs(day.total.kcal - day.targets.kcal) / day.targets.kcal, day.date).toBeLessThanOrEqual(0.05);
      expect(day.total.proteinG, day.date).toBeGreaterThanOrEqual(day.targets.proteinG);
      expect(day.targets.source).toBe("base");
      expect(day.reasons.length).toBeGreaterThanOrEqual(3);
    }
    expect(week.days[0]?.targets.source).toBe("live");
    expect(week.daysMet).toBeGreaterThanOrEqual(6);
  });

  test("the target is on the owner-like band: 1,500-2,100 kcal, ~110 g protein", async () => {
    const week = (await ready("pro")).plan;
    const t = week?.days[1]?.targets;
    expect(t?.kcal).toBeGreaterThanOrEqual(1500);
    expect(t?.kcal).toBeLessThanOrEqual(2100);
    expect(t?.proteinG).toBeGreaterThanOrEqual(100);
    expect(t?.proteinG).toBeLessThanOrEqual(120);
  });

  test("opening again does not reshuffle; regenerate=false returns the saved plan; regenerate=true makes another", async () => {
    const a = (await ready("pro")).plan;
    const b = (await ready("pro")).plan;
    expect(b).toEqual(a);
    const again = await generate("pro", false);
    expect(again.days.map((d) => d.items.map((i) => i.ref))).toEqual(a?.days.map((d) => d.items.map((i) => i.ref)) ?? []);
    const fresh = await generate("pro", true);
    expect(fresh.generation).toBe((a?.generation ?? 0) + 1);
    expect(fresh.days.map((d) => d.items.map((i) => i.ref))).not.toEqual(a?.days.map((d) => d.items.map((i) => i.ref)) ?? []);
  });

  test("plans are per account", async () => {
    expect((await ready("other")).plan).toBeNull();
  });
});

describe("mealPlan: Sudah makan", () => {
  test("logs the planned meal into food_log with the TKPI numbers shown on the card, then undo removes it", async () => {
    const week = (await ready("pro")).plan;
    const day = week?.days.find((d) => d.date === shiftDate(today, 0));
    const item = day?.items.find((i) => !i.eaten && !i.covered);
    if (!day || !item) return; // late evening: nothing left to eat today
    const res = await call(mealPlanRouter.eat, { date: today, slot: item.slot }, as("pro"));
    expect(res.logId).toBe(`meal-plan:pro:${today}:${item.slot}`);
    // The stored row rides along so the phone can mirror it to Health Connect, macros and fibre included.
    expect(res.row).toMatchObject({ id: res.logId, kcal: item.nutrition.kcal, grams: item.grams });
    expect(res.row.protein).toBeCloseTo(item.nutrition.proteinG, 5);
    expect(res.row.fiber).toBeCloseTo(item.nutrition.fiberG, 5);
    const rows = (await sql(`SELECT * FROM food_log WHERE id = ?`, [res.logId])).rows;
    expect(rows).toHaveLength(1);
    const row = rows[0] as unknown as Record<string, number | string | null>;
    expect(row.user_id).toBe("pro");
    expect(row.date).toBe(today);
    expect(row.meal).toBe(item.slot);
    expect(row.name).toBe(item.name);
    expect(row.kcal).toBe(item.nutrition.kcal);
    expect(row.protein).toBeCloseTo(item.nutrition.proteinG, 5);
    expect(row.carbs).toBeCloseTo(item.nutrition.carbsG, 5);
    expect(row.fat).toBeCloseTo(item.nutrition.fatG, 5);
    expect(row.grams).toBe(item.grams);
    if (item.recipeId) {
      const recipe = recipeById(item.recipeId);
      const expected = recipe ? computePortion(recipe, item.scale, item.carbScale).nutrition : null;
      expect(row.kcal).toBe(expected?.kcal ?? -1);
    }
    const after = res.plan.days[0]?.items.find((i) => i.slot === item.slot);
    expect(after?.eaten).toBe(true);
    expect(after?.logId).toBe(res.logId);
    expect(res.plan.days[0]?.eaten.kcal).toBeGreaterThanOrEqual(item.nutrition.kcal);

    const twice = await call(mealPlanRouter.eat, { date: today, slot: item.slot }, as("pro")).then(() => null, (e: { code?: string }) => e);
    expect(twice?.code).toBe("CONFLICT");

    const undone = await call(mealPlanRouter.undoEat, { date: today, slot: item.slot }, as("pro"));
    expect(undone.days[0]?.items.find((i) => i.slot === item.slot)?.eaten).toBe(false);
    expect(undone.removedLogId).toBe(res.logId);
    expect((await sql(`SELECT count(*) AS n FROM food_log WHERE id = ?`, [res.logId])).rows[0]?.n).toBe(0);
  });

  test("tapping Sudah makan twice at once logs the meal once", async () => {
    const day = (await ready("pro")).plan?.days[0];
    const item = day?.items.find((i) => !i.eaten && !i.covered);
    if (!item) return;
    const results = await Promise.allSettled([
      call(mealPlanRouter.eat, { date: today, slot: item.slot }, as("pro")),
      call(mealPlanRouter.eat, { date: today, slot: item.slot }, as("pro")),
      call(mealPlanRouter.eat, { date: today, slot: item.slot }, as("pro")),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const r of results) if (r.status === "rejected") expect((r.reason as { code?: string }).code).toBe("CONFLICT");
    expect((await sql(`SELECT count(*) AS n FROM food_log WHERE user_id = 'pro' AND date = ? AND meal = ?`, [today, item.slot])).rows[0]?.n).toBe(1);
    const after = (await ready("pro")).plan?.days[0]?.items.find((i) => i.slot === item.slot);
    expect(after?.eaten).toBe(true);
    expect(after?.logId).toBe(`meal-plan:pro:${today}:${item.slot}`);
    // a meal that is logged cannot be swapped
    const swapErr = await call(mealPlanRouter.swapOptions, { date: today, slot: item.slot }, as("pro")).then(() => null, (e: { code?: string }) => e);
    expect(swapErr?.code).toBe("CONFLICT");
    await call(mealPlanRouter.undoEat, { date: today, slot: item.slot }, as("pro"));
    expect((await sql(`SELECT count(*) AS n FROM food_log WHERE user_id = 'pro' AND date = ? AND meal = ?`, [today, item.slot])).rows[0]?.n).toBe(0);
    // after the undo it can be logged again, once more with the same id
    const again = await call(mealPlanRouter.eat, { date: today, slot: item.slot }, as("pro"));
    expect(again.logId).toBe(`meal-plan:pro:${today}:${item.slot}`);
    await call(mealPlanRouter.undoEat, { date: today, slot: item.slot }, as("pro"));
  });

  test("two different meals logged at the same time are both kept on the plan", async () => {
    const items = (await ready("pro")).plan?.days[0]?.items.filter((i) => !i.eaten && !i.covered) ?? [];
    const [a, b] = items;
    if (!a || !b) return;
    await Promise.all([
      call(mealPlanRouter.eat, { date: today, slot: a.slot }, as("pro")),
      call(mealPlanRouter.eat, { date: today, slot: b.slot }, as("pro")),
    ]);
    const day = (await ready("pro")).plan?.days[0];
    expect(day?.items.find((i) => i.slot === a.slot)?.eaten).toBe(true);
    expect(day?.items.find((i) => i.slot === b.slot)?.eaten).toBe(true);
    await call(mealPlanRouter.undoEat, { date: today, slot: a.slot }, as("pro"));
    await call(mealPlanRouter.undoEat, { date: today, slot: b.slot }, as("pro"));
    const cleared = (await ready("pro")).plan?.days[0];
    expect(cleared?.items.some((i) => i.eaten)).toBe(false);
    expect((await sql(`SELECT count(*) AS n FROM food_log WHERE user_id = 'pro' AND id LIKE 'meal-plan:%'`)).rows[0]?.n).toBe(0);
  });

  test("a future day cannot be logged as eaten", async () => {
    const err = await call(mealPlanRouter.eat, { date: shiftDate(today, 2), slot: "sarapan" }, as("pro")).then(() => null, (e: { code?: string }) => e);
    expect(err?.code).toBe("BAD_REQUEST");
  });

  test("logging something else for the slot marks the planned meal as covered and takes it out of the totals", async () => {
    const week = (await ready("pro")).plan;
    const day = week?.days[0];
    const item = day?.items.find((i) => !i.eaten && !i.covered);
    if (!day || !item) return;
    await sql(`INSERT INTO food_log (id, user_id, date, meal, name, kcal, protein, carbs, fat, source) VALUES ('own-1', 'pro', ?, ?, 'Nasi bungkus', 500, 20, 70, 15, 'manual')`, [today, item.slot]);
    const next = (await ready("pro")).plan?.days[0];
    expect(next?.items.find((i) => i.slot === item.slot)?.covered).toBe(true);
    expect(next?.eaten.kcal).toBeGreaterThanOrEqual(500);
    expect(next?.planned.kcal).toBeLessThan(day.planned.kcal);
    await sql(`DELETE FROM food_log WHERE id = 'own-1'`);
  });
});

describe("mealPlan: Ganti", () => {
  test("offers alternatives with similar kcal and protein; picking one replaces the slot and keeps the day near its budget", async () => {
    const week = (await ready("pro")).plan;
    const day = week?.days[2];
    const item = day?.items[1];
    if (!day || !item) throw new Error("no item");
    const options = await call(mealPlanRouter.swapOptions, { date: day.date, slot: item.slot }, as("pro"));
    expect(options.alternatives.length).toBeGreaterThan(0);
    const refs = day.items.map((i) => i.ref);
    for (const alt of options.alternatives) {
      expect(Math.abs(alt.nutrition.kcal - item.nutrition.kcal) / item.nutrition.kcal).toBeLessThanOrEqual(0.2 + 1e-9);
      expect(alt.nutrition.proteinG).toBeGreaterThanOrEqual(Math.min(item.nutrition.proteinG * 0.8, item.nutrition.proteinG - 3) - 1e-9);
      expect(refs).not.toContain(alt.ref);
    }
    const pick = options.alternatives[0];
    if (!pick) throw new Error("no alt");
    const result = await call(mealPlanRouter.swap, { date: day.date, slot: item.slot, ref: pick.ref, scale: pick.scale, carbScale: pick.carbScale }, as("pro"));
    const swapped = result.plan.days[2]?.items.find((i) => i.slot === item.slot);
    expect(swapped?.ref).toBe(pick.ref);
    expect(swapped?.pinned).toBe(true);
    const after = result.plan.days[2];
    expect(Math.abs((after?.total.kcal ?? 0) - (after?.targets.kcal ?? 1)) / (after?.targets.kcal ?? 1)).toBeLessThanOrEqual(0.06);
    // the swapped-away dish is not offered back for that slot and day
    const again = await call(mealPlanRouter.swapOptions, { date: day.date, slot: item.slot }, as("pro"));
    expect(again.alternatives.map((a) => a.ref)).not.toContain(item.ref);
    // the swap is stored
    expect((await sql(`SELECT count(*) AS n FROM meal_plan_swap WHERE user_id = 'pro' AND from_ref = ?`, [item.ref])).rows[0]?.n).toBeGreaterThanOrEqual(1);
  });

  test("a made-up alternative is refused", async () => {
    const week = (await ready("pro")).plan;
    const item = week?.days[3]?.items[0];
    if (!item) throw new Error("no item");
    const err = await call(mealPlanRouter.swap, { date: week?.days[3]?.date ?? today, slot: item.slot, ref: "r:does-not-exist", scale: 1, carbScale: 1 }, as("pro")).then(() => null, (e: { code?: string }) => e);
    expect(err?.code).toBe("BAD_REQUEST");
  });

  test("replanDay plans one day again and leaves the others alone", async () => {
    const before = (await ready("pro")).plan;
    const date = shiftDate(today, 4);
    const after = await call(mealPlanRouter.replanDay, { date }, as("pro"));
    expect(after.days.map((d) => d.items.map((i) => i.ref)).filter((_, i) => i !== 4)).toEqual(before?.days.map((d) => d.items.map((i) => i.ref)).filter((_, i) => i !== 4) ?? []);
  });
});

describe("mealPlan: settings", () => {
  test("allergies and dislikes are stored, cleaned, and respected by the next plan", async () => {
    const saved = await call(mealPlanRouter.setPrefs, { allergens: ["seafood", "telur"], dislikes: ["  Tempe ", "tempe", "jamur"], budgetFriendly: true, cookPref: "cook" }, as("pro"));
    expect(saved).toEqual({ allergens: ["seafood", "telur"], dislikes: ["tempe", "jamur"], budgetFriendly: true, cookPref: "cook" });
    expect(await call(mealPlanRouter.prefs, undefined, as("pro"))).toEqual(saved);
    const week = await generate("pro", true);
    for (const day of week.days) {
      for (const item of day.items) {
        expect(item.allergens).not.toContain("seafood");
        expect(item.allergens).not.toContain("telur");
        expect(item.avoid).toBe(false);
        const recipe = item.recipeId ? recipeById(item.recipeId) : undefined;
        expect(recipe?.home).toBe(true);
      }
    }
  });

  test("the three-way choice is stored; old values from before it are migrated when sent or read", async () => {
    const send = (cookPref: string) => call(mealPlanRouter.setPrefs, { allergens: [], dislikes: [], budgetFriendly: false, cookPref: cookPref as never }, as("other"));
    expect((await send("buy")).cookPref).toBe("buy");
    expect((await send("mixed")).cookPref).toBe("mixed");
    expect((await send("warung")).cookPref).toBe("buy");
    expect((await send("any")).cookPref).toBe("mixed");
    await sql("UPDATE meal_prefs SET cook_pref = 'warung' WHERE user_id = 'other'");
    expect((await call(mealPlanRouter.prefs, undefined, as("other"))).cookPref).toBe("buy");
    await sql("UPDATE meal_prefs SET cook_pref = 'any' WHERE user_id = 'other'");
    expect((await call(mealPlanRouter.prefs, undefined, as("other"))).cookPref).toBe("mixed");
    await send("mixed");
  });

  test("every planned meal says whether to cook or buy it, plus the name to search for", async () => {
    await call(mealPlanRouter.setPrefs, { allergens: [], dislikes: [], budgetFriendly: false, cookPref: "buy" }, as("pro"));
    const week = await generate("pro", true);
    for (const item of week.days.flatMap((d) => d.items)) {
      expect(item.mode).toBe("buy");
      const recipe = item.recipeId ? recipeById(item.recipeId) : undefined;
      expect(item.buyQuery).toBe(recipe ? recipe.name.id : item.name);
    }
    await call(mealPlanRouter.setPrefs, { allergens: [], dislikes: [], budgetFriendly: false, cookPref: "cook" }, as("pro"));
    const cooked = await generate("pro", true);
    for (const item of cooked.days.flatMap((d) => d.items)) if (item.kind === "recipe") expect(item.mode).toBe("cook");
    await call(mealPlanRouter.setPrefs, { allergens: [], dislikes: [], budgetFriendly: false, cookPref: "mixed" }, as("pro"));
  });

  test("bad settings are rejected", async () => {
    const err = await call(mealPlanRouter.setPrefs, { allergens: ["nuts" as never], dislikes: [], budgetFriendly: false, cookPref: "mixed" }, as("pro")).then(() => null, (e: { code?: string }) => e);
    expect(err?.code).toBe("BAD_REQUEST");
  });
});

describe("mealPlan: recipe", () => {
  test("detail has grams per ingredient, steps and the portion's TKPI nutrition", async () => {
    const recipe = RECIPES[0];
    if (!recipe) throw new Error("no recipe");
    const view = await call(mealPlanRouter.recipe, { id: recipe.id, scale: 1, carbScale: 1 }, as("pro"));
    expect(view.name).toBe(recipe.name.id);
    expect(view.ingredients.map((i) => i.key)).toEqual(recipe.ing.map(([k]) => k));
    expect(view.steps.length).toBeGreaterThanOrEqual(3);
    expect(view.nutrition).toEqual(computePortion(recipe).nutrition);
    const en = await call(mealPlanRouter.recipe, { id: recipe.id, scale: 1, carbScale: 1 }, { context: { ...as("pro").context, locale: "en" } as Context });
    expect(en.name).toBe(recipe.name.en);
    expect(view.sources.map((g) => g.kind)).toContain("tkpi");
    const breast = RECIPES.find((r) => r.ing.some(([k]) => k === "ayam-dada-tanpa-kulit"));
    if (!breast) throw new Error("no breast recipe");
    const bv = await call(mealPlanRouter.recipe, { id: breast.id, scale: 1, carbScale: 1 }, as("pro"));
    expect(bv.ingredients.find((i) => i.key === "ayam-dada-tanpa-kulit")?.source).toBe("usda");
    expect(bv.sources.find((g) => g.kind === "usda")?.items.join(" ")).toContain("FDC 171077");
    expect(bv.sources.find((g) => g.kind === "usda")?.label).toContain("USDA");
    const err = await call(mealPlanRouter.recipe, { id: "nope", scale: 1, carbScale: 1 }, as("pro")).then(() => null, (e: { code?: string }) => e);
    expect(err?.code).toBe("NOT_FOUND");
  });
});

describe("mealPlan: shopping list", () => {
  test("sums the ingredients of the meals not eaten, groups them and keeps the ticks", async () => {
    await generate("pro", true);
    const list = await call(mealPlanRouter.shopping, undefined, as("pro"));
    expect(list.total).toBeGreaterThan(10);
    const items = list.groups.flatMap((g) => g.items);
    expect(items).toHaveLength(list.total);
    expect(list.groups.map((g) => g.cat)).toEqual([...list.groups.map((g) => g.cat)].sort((a, b) => ["karbo", "protein", "sayur", "buah", "susu", "bumbu"].indexOf(a) - ["karbo", "protein", "sayur", "buah", "susu", "bumbu"].indexOf(b)));
    for (const item of items) {
      expect(item.grams).toBeGreaterThan(0);
      expect(item.amount.length).toBeGreaterThan(0);
      expect(INGREDIENTS[item.key]).toBeDefined();
      expect(item.checked).toBe(false);
    }
    const first = items[0];
    if (!first) throw new Error("empty list");
    await call(mealPlanRouter.checkItem, { key: first.key, checked: true }, as("pro"));
    const ticked = await call(mealPlanRouter.shopping, undefined, as("pro"));
    expect(ticked.checked).toBe(1);
    expect(ticked.groups.flatMap((g) => g.items).find((i) => i.key === first.key)?.checked).toBe(true);
    await call(mealPlanRouter.checkItem, { key: first.key, checked: false }, as("pro"));
    expect((await call(mealPlanRouter.shopping, undefined, as("pro"))).checked).toBe(0);
  });
});

describe("mealPlan: history", () => {
  test("food the person logs often shows up on the plan", async () => {
    const dish = RECIPES.find((r) => r.meals.includes("main") && (r.aka ?? []).some((a) => a.includes(" ")) && computePortion(r).nutrition.proteinG > 25 && r.cost <= 2);
    if (!dish) throw new Error("no dish with a two-word aka");
    const n = computePortion(dish).nutrition;
    const name = dish.aka?.find((a) => a.includes(" ")) ?? dish.name.id;
    for (let i = 1; i <= 8; i++) {
      await sql(`INSERT INTO food_log (id, user_id, date, meal, name, kcal, protein, carbs, fat, source) VALUES (?, 'other', ?, 'makan_siang', ?, ?, ?, ?, ?, 'manual')`, [`hist-${i}`, shiftDate(today, -i), name, n.kcal, n.proteinG, n.carbsG, n.fatG]);
    }
    const week = await generate("other", true);
    const seen = week.days.flatMap((d) => d.items).filter((i) => i.recipeId === dish.id);
    expect(seen.length).toBeGreaterThanOrEqual(1);
    expect(seen[0]?.habitTimes).toBe(8);
  });
});

describe("mealPlan: account data", () => {
  test("deleting all data removes plans, swaps, shopping ticks and preferences", async () => {
    const { deleteAllUserData } = await import("../lib/privacy");
    await call(mealPlanRouter.setPrefs, { allergens: ["susu"], dislikes: [], budgetFriendly: false, cookPref: "mixed" }, as("other"));
    await generate("other", true);
    await deleteAllUserData(db, "other");
    for (const table of ["meal_plan", "meal_plan_swap", "meal_shopping_check", "meal_prefs"]) {
      expect((await sql(`SELECT count(*) AS n FROM ${table} WHERE user_id = 'other'`)).rows[0]?.n, table).toBe(0);
    }
  });
});
