import { call } from "@orpc/server";
import { describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";

import { d1TestDb } from "@joyorogo/db/test-d1";
import { aiUsage } from "@joyorogo/db/schema/fitness";
import { weekReflection } from "@joyorogo/db/schema/recap";
import type { WeekReflectionRow } from "@joyorogo/db/schema/recap";

import type { Context } from "../context";
import { ENERGY_NOTICE_BEFORE_MS } from "./energy-notice";
import { jakartaToday, shiftDate } from "./engine";
import { weekStartOf } from "./recap";
import { REFLECTION_LIMITS, claimRun, decideAi, generateWeekReflection, getWeekReflection, readPreviousSleepFactor } from "./recap-reflection";
import type { ReflectionDeps } from "./recap-reflection";
import { loadWeekRecap } from "./recap-store";
import { statsRouter } from "../routers/stats";

const { client, db } = await d1TestDb();

const old = ENERGY_NOTICE_BEFORE_MS - 86_400_000;
const week = shiftDate(weekStartOf(jakartaToday()), -7);
const day = (i: number) => shiftDate(week, i);

// Pro ('founder'), free, a Pro with no data and a Pro with no profile.
await client.executeMultiple(`
  INSERT INTO "user" (id, name, email, tier, created_at) VALUES
    ('pro', 'pro', 'pro@test.id', 'founder', ${old}),
    ('free', 'free', 'free@test.id', 'free', ${old}),
    ('blank', 'blank', 'blank@test.id', 'founder', ${old}),
    ('noprof', 'noprof', 'noprof@test.id', 'founder', ${old}),
    ('strava', 'strava', 'strava@test.id', 'founder', ${old});
  INSERT INTO profile (user_id, birth_year, gender, height_cm, start_weight_kg, target_weight_kg, target_date, activity_level) VALUES
    ('pro', 1988, 'male', 175, 107.7, 90, '2031-01-01', 'light'),
    ('free', 1988, 'male', 175, 107.7, 90, '2031-01-01', 'light'),
    ('blank', 1988, 'male', 175, 107.7, 90, '2031-01-01', 'light'),
    ('strava', 1988, 'male', 175, 107.7, 90, '2031-01-01', 'light');
`);

const FOODS = ["Ayam goreng", "Nasi putih", "Es teh manis", "Gorengan"];
async function seedWeek(userId: string, kcalPerDay = 3000) {
  const rows: string[] = [];
  for (let i = 0; i < 7; i += 1) {
    FOODS.forEach((name, j) => {
      rows.push(`('${userId}-f${i}-${j}', '${userId}', '${day(i)}', 'makan_siang', '${name}', ${kcalPerDay / FOODS.length}, ${8}, 'manual')`);
    });
  }
  await client.executeMultiple(
    `INSERT INTO food_log (id, user_id, date, meal, name, kcal, protein, source) VALUES ${rows.join(",")};
     INSERT INTO weight_log (id, user_id, date, weight_kg) VALUES ('${userId}-w1', '${userId}', '${day(0)}', 108.4), ('${userId}-w2', '${userId}', '${day(2)}', 108.1), ('${userId}-w3', '${userId}', '${day(4)}', 107.9), ('${userId}-w4', '${userId}', '${day(6)}', 107.7);`,
  );
}
await seedWeek("pro");
await seedWeek("free");
await seedWeek("strava");


/** A model that answers like a faithful one: the observations and advice of the facts it was given, around plain filler. */
function faithfulModel() {
  const calls: Array<{ system: string; user: string }> = [];
  return {
    calls,
    run(_model: string, input: unknown) {
      const messages = (input as { messages: Array<{ role: string; content: string }> }).messages;
      const system = messages[0]!.content;
      const user = messages[1]!.content;
      calls.push({ system, user });
      const facts = JSON.parse(user.slice(user.indexOf("{"), user.lastIndexOf("}") + 1).split("\n\nYour previous")[0]!) as {
        wins: Array<{ observation: string }>;
        focus: Array<{ observation: string; advice: string }>;
      };
      const label = /exactly "([^"]+)"/.exec(system)![1]!;
      const filler =
        "Ini gambaran minggumu yang sudah lewat, ditulis supaya kamu bisa melihat apa yang jalan dan apa yang perlu dirapikan tanpa harus membaca semua angka satu per satu, dan semuanya masih bisa diperbaiki pelan-pelan minggu depan.";
      const text = [
        `${filler} ${facts.wins.map((w) => w.observation).join(" ")}`,
        `${facts.focus.map((f) => f.observation).join(" ")} Itu yang paling terasa dari angka-angkamu, dan kamu bisa mulai dari yang paling gampang dulu karena perubahan kecil yang rutin biasanya lebih awet.`,
        [label, ...facts.focus.map((f, i) => `${i + 1}. ${f.advice}`)].join("\n"),
      ].join("\n\n");
      return Promise.resolve({ response: text, usage: { prompt_tokens: 1200, completion_tokens: 420 } });
    },
  };
}

function depsFor(ai: { run(model: string, input: unknown): Promise<unknown> } | undefined, extra: Record<string, string> = {}) {
  const pending: Promise<unknown>[] = [];
  const deps: ReflectionDeps = {
    db,
    env: { FREE_DAILY_SCANS: "3", ...(ai ? { AI: ai } : {}), ...extra },
    waitUntil: (p) => void pending.push(p),
  };
  return { deps, settle: () => Promise.all(pending) };
}

const rowOf = async (userId: string, locale = "id") =>
  (await db.select().from(weekReflection).where(and(eq(weekReflection.userId, userId), eq(weekReflection.weekStart, week), eq(weekReflection.locale, locale))))[0] ?? null;

const baseRow = (over: Partial<WeekReflectionRow> = {}): WeekReflectionRow => ({
  userId: "pro",
  weekStart: week,
  locale: "id",
  aiText: "teks",
  aiModel: "m",
  status: "ok",
  signature: "sig",
  generations: 1,
  generatedAt: 1_000_000,
  ...over,
});

describe("decideAi", () => {
  const now = 1_000_000 + REFLECTION_LIMITS.regenGapMs + 1;
  const decide = (row: WeekReflectionRow | null, over: Partial<Parameters<typeof decideAi>[0]> = {}) =>
    decideAi({ pro: true, hasAi: true, row, signature: "sig", now, ...over });

  test("a free account is locked whatever is stored", () => {
    expect(decide(baseRow(), { pro: false })).toEqual({ state: "locked", text: null, canRun: false });
    expect(decide(null, { pro: false })).toEqual({ state: "locked", text: null, canRun: false });
  });

  test("a stored text of the current facts is ready and never rerun", () => {
    expect(decide(baseRow())).toEqual({ state: "ready", text: "teks", canRun: false });
    expect(decide(baseRow({ generations: 99 }), { now: 1_000_001 })).toMatchObject({ state: "ready", canRun: false });
    expect(decide(baseRow(), { hasAi: false })).toMatchObject({ state: "ready" });
  });

  test("nothing stored: Pro with a model is pending and may run, without a model it is unavailable", () => {
    expect(decide(null)).toEqual({ state: "pending", text: null, canRun: true });
    expect(decide(null, { hasAi: false })).toEqual({ state: "unavailable", text: null, canRun: false });
  });

  test("changed facts rewrite only after the regeneration gap", () => {
    const stale = baseRow({ signature: "other" });
    expect(decide(stale, { now: 1_000_000 + REFLECTION_LIMITS.regenGapMs - 1 })).toEqual({ state: "unavailable", text: null, canRun: false });
    expect(decide(stale)).toEqual({ state: "pending", text: null, canRun: true });
  });

  test("the run cap of a week is final", () => {
    expect(decide(baseRow({ signature: "other", generations: REFLECTION_LIMITS.maxRunsPerWeek }))).toMatchObject({ state: "unavailable", canRun: false });
  });

  test("a failed run waits its own, shorter gap", () => {
    const failed = baseRow({ status: "failed", aiText: null });
    expect(decide(failed, { now: 1_000_000 + REFLECTION_LIMITS.failedRetryGapMs - 1 })).toMatchObject({ state: "unavailable", canRun: false });
    expect(decide(failed, { now: 1_000_000 + REFLECTION_LIMITS.failedRetryGapMs })).toMatchObject({ state: "pending", canRun: true });
  });

  test("a run in flight is pending and cannot be started again until it is stale", () => {
    const running = baseRow({ status: "running", aiText: null });
    expect(decide(running, { now: 1_000_000 + 1000 })).toEqual({ state: "pending", text: null, canRun: false });
    expect(decide(running, { now: 1_000_000 + REFLECTION_LIMITS.runningStaleMs })).toEqual({ state: "pending", text: null, canRun: true });
  });

  test("a stale run at the week's run cap leaves the template instead of pending forever", () => {
    const stuck = baseRow({ status: "running", aiText: null, generations: REFLECTION_LIMITS.maxRunsPerWeek });
    expect(decide(stuck, { now: 1_000_000 + REFLECTION_LIMITS.runningStaleMs })).toEqual({ state: "unavailable", text: null, canRun: false });
    expect(decide(stuck, { now: 1_000_000 + 1000 })).toEqual({ state: "pending", text: null, canRun: false });
  });
});

describe("free account", () => {
  test("gets the template, locked, with wins and focus", async () => {
    const { deps } = depsFor(faithfulModel());
    const view = (await getWeekReflection(deps, "free", week, "id", "Asia/Jakarta"))!;
    expect(view).toMatchObject({ source: "template", ai: "locked", weekStart: week, complete: true, generatedAt: null });
    expect(view.text).toContain("Kabar baiknya:");
    expect(view.focus.length).toBeGreaterThan(0);
    expect(view.focus.length).toBeLessThanOrEqual(3);
    expect(view.wins.length).toBeLessThanOrEqual(3);
    expect(view.focus.every((f) => f.title.length > 0)).toBe(true);
  });

  test("the model is never called and generate is refused with the paywall flag", async () => {
    const model = faithfulModel();
    const { deps } = depsFor(model);
    await expect(generateWeekReflection(deps, "free", week, "id", "Asia/Jakarta")).rejects.toThrow("reflection-locked");
    expect(model.calls).toHaveLength(0);
    expect(await rowOf("free")).toBeNull();
  });

  test("through the router: FORBIDDEN with data.paywall", async () => {
    const context = { db, env: { FREE_DAILY_SCANS: "3", AI: faithfulModel() }, waitUntil: () => {}, locale: "id", session: { user: { id: "free", createdAt: new Date(old) } } } as unknown as Context;
    const error = await call(statsRouter.generateWeekReflection, { weekStart: week }, { context }).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: "FORBIDDEN", data: { paywall: true } });
    const view = await call(statsRouter.weekReflection, { weekStart: week }, { context });
    expect(view).toMatchObject({ ai: "locked", source: "template" });
  });

  test("in English the same week reads in English", async () => {
    const { deps } = depsFor(undefined);
    const view = (await getWeekReflection(deps, "free", week, "en", "Asia/Jakarta"))!;
    expect(view.text).toContain("Focus for next week:");
    expect(view.text).not.toContain("Kabar baiknya");
  });
});

describe("nothing to say", () => {
  test("no profile, no data and a week that has not started give null", async () => {
    const { deps } = depsFor(faithfulModel());
    expect(await getWeekReflection(deps, "noprof", week, "id", "Asia/Jakarta")).toBeNull();
    expect(await getWeekReflection(deps, "blank", week, "id", "Asia/Jakarta")).toBeNull();
    expect(await generateWeekReflection(deps, "blank", week, "id", "Asia/Jakarta")).toBeNull();
    expect(await getWeekReflection(deps, "pro", weekStartOf(jakartaToday()), "id", "Asia/Jakarta")).toBeNull();
  });
});

describe("Pro account", () => {
  test("first view is pending (the client then asks to generate), still showing the template", async () => {
    const model = faithfulModel();
    const { deps } = depsFor(model);
    const view = (await getWeekReflection(deps, "pro", week, "id", "Asia/Jakarta"))!;
    expect(view).toMatchObject({ ai: "pending", source: "template" });
    expect(model.calls).toHaveLength(0);
  });

  test("generate writes the AI text once, counts the run in ai_usage and caches it", async () => {
    const model = faithfulModel();
    const { deps, settle } = depsFor(model, { AI_RECAP_MODEL: "@cf/test/model" });
    const view = (await generateWeekReflection(deps, "pro", week, "id", "Asia/Jakarta"))!;
    await settle();
    expect(view).toMatchObject({ ai: "ready", source: "ai" });
    expect(view.generatedAt).toBeGreaterThan(0);
    expect(view.text).toContain("Fokus minggu depan:\n1. ");
    expect(model.calls).toHaveLength(1);
    expect(model.calls[0]!.system).toContain("Never invent, estimate, add, subtract or round a number");

    const row = (await rowOf("pro"))!;
    expect(row).toMatchObject({ status: "ok", generations: 1, aiModel: "@cf/test/model", aiText: view.text });
    const usage = await db.select().from(aiUsage).where(and(eq(aiUsage.userId, "pro"), eq(aiUsage.scanType, "recap")));
    expect(usage).toHaveLength(1);
    expect(JSON.parse(usage[0]!.usageJson!)).toMatchObject({ kind: "recap", week, attempt: 1, outcome: "ok", usage: { prompt_tokens: 1200 } });
    expect(usage[0]!.model).toBe("@cf/test/model");
  });

  test("a reopened recap and a second generate read the cache: no second model call", async () => {
    const model = faithfulModel();
    const { deps, settle } = depsFor(model);
    const seen = (await getWeekReflection(deps, "pro", week, "id", "Asia/Jakarta"))!;
    expect(seen).toMatchObject({ ai: "ready", source: "ai" });
    const again = (await generateWeekReflection(deps, "pro", week, "id", "Asia/Jakarta"))!;
    await settle();
    expect(again.text).toBe(seen.text);
    expect(model.calls).toHaveLength(0);
    expect((await rowOf("pro"))!.generations).toBe(1);
  });

  test("the router returns the cached AI text", async () => {
    const context = { db, env: { FREE_DAILY_SCANS: "3", AI: faithfulModel() }, waitUntil: () => {}, locale: "id", session: { user: { id: "pro", createdAt: new Date(old) } } } as unknown as Context;
    const view = await call(statsRouter.weekReflection, { weekStart: week }, { context });
    expect(view).toMatchObject({ ai: "ready", source: "ai", weekStart: week });
  });

  test("another language is its own row, so it is pending on its own", async () => {
    const model = faithfulModel();
    const { deps } = depsFor(model);
    const en = (await getWeekReflection(deps, "pro", week, "en", "Asia/Jakarta"))!;
    expect(en).toMatchObject({ ai: "pending", source: "template" });
    expect(model.calls).toHaveLength(0);
  });

  test("changed facts are rewritten after the gap, once the run cap allows", async () => {
    const model = faithfulModel();
    const { deps, settle } = depsFor(model);
    const row = (await rowOf("pro"))!;
    // The week's data changes materially: protein and food are edited later.
    await client.execute(`UPDATE food_log SET kcal = 100 WHERE user_id = 'pro'`);
    const soon = (await getWeekReflection(deps, "pro", week, "id", "Asia/Jakarta", row.generatedAt + 1000))!;
    expect(soon).toMatchObject({ ai: "unavailable", source: "template" });
    const later = (await getWeekReflection(deps, "pro", week, "id", "Asia/Jakarta", row.generatedAt + REFLECTION_LIMITS.regenGapMs + 1))!;
    expect(later).toMatchObject({ ai: "pending", source: "template" });
    const rewritten = (await generateWeekReflection(deps, "pro", week, "id", "Asia/Jakarta", row.generatedAt + REFLECTION_LIMITS.regenGapMs + 1))!;
    await settle();
    expect(rewritten).toMatchObject({ ai: "ready", source: "ai" });
    expect(rewritten.text).not.toBe(row.aiText);
    expect((await rowOf("pro"))!).toMatchObject({ generations: 2, signature: expect.any(String) });
    expect(model.calls).toHaveLength(1);
  });

  test("a run in flight on another device is not started twice", async () => {
    await client.execute(`UPDATE week_reflection SET status = 'running', generated_at = ${Date.now()}, signature = 'x' WHERE user_id = 'pro'`);
    const model = faithfulModel();
    const { deps } = depsFor(model);
    const view = (await generateWeekReflection(deps, "pro", week, "id", "Asia/Jakarta"))!;
    expect(view).toMatchObject({ ai: "pending", source: "template" });
    expect(model.calls).toHaveLength(0);
  });
});

describe("claimRun: the database enforces the run rules", () => {
  // The row another run left behind after this request read it; the claim must judge by the row as it is now.
  const claim = (id: string, now: number, signature = "new") => claimRun(db, { userId: id, weekStart: week, locale: "id", model: "m", signature, now });
  const T0 = 10_000_000_000;
  async function seedRow(id: string, row: Partial<WeekReflectionRow>) {
    await client.execute(`INSERT INTO "user" (id, name, email, tier, created_at) VALUES ('${id}', '${id}', '${id}@test.id', 'founder', ${old})`);
    await db.insert(weekReflection).values({ userId: id, weekStart: week, locale: "id", aiText: "lama", aiModel: "m", status: "ok", signature: "old", generations: 1, generatedAt: T0, ...row });
  }

  test("no row yet: the claim inserts the first run", async () => {
    await client.execute(`INSERT INTO "user" (id, name, email, tier, created_at) VALUES ('c0', 'c0', 'c0@test.id', 'founder', ${old})`);
    expect(await claim("c0", T0)).toBe(1);
    expect(await rowOf("c0")).toMatchObject({ status: "running", generations: 1 });
  });

  test("a run in flight is not taken over until it is stale", async () => {
    await seedRow("c1", { status: "running", aiText: null });
    expect(await claim("c1", T0 + REFLECTION_LIMITS.runningStaleMs - 1)).toBeNull();
    expect(await claim("c1", T0 + REFLECTION_LIMITS.runningStaleMs)).toBe(2);
  });

  test("a finished text of the same facts is never rerun", async () => {
    await seedRow("c2", { signature: "new" });
    expect(await claim("c2", T0 + 10 * REFLECTION_LIMITS.regenGapMs)).toBeNull();
    expect((await rowOf("c2"))!).toMatchObject({ status: "ok", generations: 1 });
  });

  test("changed facts are refused inside the regeneration gap and taken after it", async () => {
    await seedRow("c3", {});
    expect(await claim("c3", T0 + REFLECTION_LIMITS.regenGapMs - 1)).toBeNull();
    expect((await rowOf("c3"))!).toMatchObject({ status: "ok", generations: 1, aiText: "lama" });
    expect(await claim("c3", T0 + REFLECTION_LIMITS.regenGapMs)).toBe(2);
    expect((await rowOf("c3"))!).toMatchObject({ status: "running", signature: "new" });
  });

  test("a failed run waits its retry gap", async () => {
    await seedRow("c4", { status: "failed", aiText: null });
    expect(await claim("c4", T0 + REFLECTION_LIMITS.failedRetryGapMs - 1)).toBeNull();
    expect(await claim("c4", T0 + REFLECTION_LIMITS.failedRetryGapMs)).toBe(2);
  });

  test("the run cap of the week is final for every state", async () => {
    const max = REFLECTION_LIMITS.maxRunsPerWeek;
    const far = T0 + 100 * REFLECTION_LIMITS.regenGapMs;
    await seedRow("c5a", { generations: max });
    await seedRow("c5b", { generations: max, status: "failed", aiText: null });
    await seedRow("c5c", { generations: max, status: "running", aiText: null });
    for (const id of ["c5a", "c5b", "c5c"]) {
      expect(await claim(id, far), id).toBeNull();
      expect((await rowOf(id))!.generations, id).toBe(max);
    }
  });

  test("two claims on the same row: only one wins", async () => {
    await seedRow("c6", { status: "failed", aiText: null });
    const now = T0 + REFLECTION_LIMITS.failedRetryGapMs;
    const results = await Promise.all([claim("c6", now), claim("c6", now)]);
    expect(results.filter((r) => r !== null)).toEqual([2]);
  });
});

describe("fallback path", () => {
  test("a model that keeps inventing numbers leaves the template, failed, and is not retried at once", async () => {
    const liar = {
      calls: 0,
      run() {
        this.calls += 1;
        return Promise.resolve({ response: "Kamu makan 12.345 kkal sehari dan itu kabar baik. ".repeat(20) });
      },
    };
    const { deps, settle } = depsFor(liar);
    await client.executeMultiple(`
      INSERT INTO "user" (id, name, email, tier, created_at) VALUES ('liar', 'liar', 'liar@test.id', 'founder', ${old});
      INSERT INTO profile (user_id, birth_year, gender, height_cm, start_weight_kg, target_weight_kg, target_date, activity_level) VALUES ('liar', 1988, 'male', 175, 107.7, 90, '2031-01-01', 'light');
    `);
    await seedWeek("liar");
    const view = (await generateWeekReflection(deps, "liar", week, "id", "Asia/Jakarta"))!;
    await settle();
    expect(view).toMatchObject({ source: "template", ai: "unavailable", generatedAt: null });
    expect(view.text).toContain("Kabar baiknya:");
    expect(liar.calls).toBe(2);
    expect(await rowOf("liar")).toMatchObject({ status: "failed", aiText: null, generations: 1 });
    const usage = await db.select().from(aiUsage).where(and(eq(aiUsage.userId, "liar"), eq(aiUsage.scanType, "recap")));
    expect(usage.map((u) => JSON.parse(u.usageJson!).outcome)).toEqual(["invalid", "invalid"]);
    expect(usage.map((u) => JSON.parse(u.usageJson!).reason)).toEqual(["number", "number"]);

    const again = (await generateWeekReflection(deps, "liar", week, "id", "Asia/Jakarta"))!;
    expect(again).toMatchObject({ source: "template", ai: "unavailable" });
    expect(liar.calls).toBe(2);
  });

  test("no AI binding at all: the template with nothing pending", async () => {
    const { deps } = depsFor(undefined);
    const view = (await getWeekReflection(deps, "liar", week, "id", "Asia/Jakarta"))!;
    expect(view).toMatchObject({ source: "template", ai: "unavailable" });
    const generated = (await generateWeekReflection(deps, "liar", week, "id", "Asia/Jakarta"))!;
    expect(generated).toMatchObject({ source: "template", ai: "unavailable" });
  });
});

describe("Strava stays out of the facts", () => {
  test("a Strava activity does not move the budget the reflection judges the days against", async () => {
    await client.execute(
      `INSERT INTO exercise_log (id, user_id, date, name, duration_min, kcal, source, external_id) VALUES ('sx', 'strava', '${day(1)}', 'Ride', 120, 1500, 'strava', 'ext1')`,
    );
    const withStrava = (await loadWeekRecap(db, "strava", week, "Asia/Jakarta"))!;
    const without = (await loadWeekRecap(db, "strava", week, "Asia/Jakarta", { excludeStrava: true }))!;
    expect(without.recap.days[1]!.targetKcal).toBeLessThan(withStrava.recap.days[1]!.targetKcal);
    expect(without.recap.exercise.sessions).toBe(0);
    expect(withStrava.recap.exercise.sessions).toBe(1);
    const baseline = (await loadWeekRecap(db, "pro", week, "Asia/Jakarta", { excludeStrava: true }))!;
    expect(without.recap.days[1]!.targetKcal).toBe(baseline.recap.days[1]!.targetKcal);
  });

  test("the reflection of that week never sees the activity", async () => {
    const model = faithfulModel();
    const { deps } = depsFor(model);
    const view = (await generateWeekReflection(deps, "strava", week, "id", "Asia/Jakarta"))!;
    expect(view.text).not.toMatch(/ride|strava/i);
    expect(model.calls[0]!.user).not.toMatch(/ride|strava|1500 kcal/i);
  });
});

describe("the sleep pattern of the previous week", () => {
  const put = (userId: string, weekStart: string, locale: string, signature: string) =>
    db.insert(weekReflection).values({ userId, weekStart, locale, aiText: "x", aiModel: "m", status: "ok", signature, generations: 1, generatedAt: 1 });

  test("is read from the stored signature of the week before, in any language", async () => {
    const current = shiftDate(week, 7);
    await put("pro", week, "en", "0a1b2c3d~dinner");
    expect(await readPreviousSleepFactor(db, "pro", current)).toBe("dinner");
  });

  test("none when the stored reflection had no sleep pattern, or there is no row", async () => {
    await put("blank", week, "id", "0a1b2c3d");
    expect(await readPreviousSleepFactor(db, "blank", shiftDate(week, 7))).toBeNull();
    expect(await readPreviousSleepFactor(db, "noprof", shiftDate(week, 7))).toBeNull();
  });
});
