import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { call } from "@orpc/server";
import { describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";

// @libsql/client is a transitive dep of @joyorogo/db (see privacy.test.ts).
import { createClient } from "../../../db/node_modules/@libsql/client";
import type { Database } from "@joyorogo/db";

import type { Context } from "../context";
import { jakartaToday, shiftDate } from "../lib/engine";
import { deleteAllUserData } from "../lib/privacy";
import { sleepFindingsFor } from "../lib/sleep-insights-store";
import { SLEEP_CONSENT_VERSION } from "../lib/sleep-insights-types";
import { sleepInsightsRouter } from "./sleep-insights";

const client = createClient({ url: ":memory:" });
const migrationsDir = join(import.meta.dir, "../../../db/src/migrations");
for (const file of readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort()) {
  await client.executeMultiple(readFileSync(join(migrationsDir, file), "utf8"));
}
await client.executeMultiple(`
  INSERT INTO "user" (id, name, email, tier) VALUES
    ('free', 'free', 'free@test.id', 'free'),
    ('other', 'other', 'other@test.id', 'free');
  INSERT INTO "user" (id, name, email, tier, founder_until) VALUES ('pro', 'pro', 'pro@test.id', 'founder', NULL);
`);

const db = drizzle(client) as unknown as Database;
const as = (userId: string, env: Context["env"] = {}) => ({
  context: { db, env, locale: "id", waitUntil: () => {}, session: { user: { id: userId } } } as unknown as Context,
});
// A paywalled server: only founders are Pro.
const PAYWALL = { FREE_DAILY_SCANS: "3" } as unknown as Context["env"];

const TZ = 420;
const HOUR = 3_600_000;
const today = jakartaToday();

/** A night that ended `daysAgo` days before today (WIB), onset 23:00. */
function nightAgo(daysAgo: number, over: Record<string, unknown> = {}) {
  const wakeDate = shiftDate(today, -daysAgo);
  const wakeMs = Date.parse(`${wakeDate}T00:00:00Z`) - TZ * 60_000 + 6.5 * HOUR;
  return {
    wakeDate,
    onsetMs: wakeMs - 7.5 * HOUR,
    wakeMs,
    tzOffsetMin: TZ,
    asleepS: 7 * 3600,
    awakeS: 1200,
    awakenings: 2,
    hasStages: true,
    deepS: 5000,
    remS: 5000,
    lightS: 12000,
    ...over,
  };
}

async function enable(userId: string) {
  return call(sleepInsightsRouter.setConsent, { enabled: true, version: SLEEP_CONSENT_VERSION }, as(userId));
}
const nightCount = async (userId: string) =>
  Number((await client.execute(`SELECT count(*) AS c FROM sleep_night WHERE user_id = '${userId}'`)).rows[0]!.c);

describe("sleepInsights router: consent and upload", () => {
  test("upsertNights is refused until the switch is on, and nothing is stored", async () => {
    await expect(call(sleepInsightsRouter.upsertNights, { nights: [nightAgo(1)] }, as("other"))).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "consent_required",
    });
    expect(await nightCount("other")).toBe(0);
    expect((await call(sleepInsightsRouter.status, undefined, as("other"))).enabled).toBe(false);
  });

  test("enabling needs the current consent version; the status reflects it", async () => {
    await expect(call(sleepInsightsRouter.setConsent, { enabled: true, version: 99 }, as("other"))).rejects.toThrow();
    const status = await enable("other");
    expect(status).toMatchObject({ enabled: true, consentVersion: SLEEP_CONSENT_VERSION, currentVersion: SLEEP_CONSENT_VERSION, nights: 0 });
  });

  test("a push stores nights as full snapshots; the last of a repeated date wins; stage-less nights drop stage fields", async () => {
    await enable("other");
    const out = await call(
      sleepInsightsRouter.upsertNights,
      { nights: [nightAgo(1), nightAgo(1, { asleepS: 6 * 3600 }), nightAgo(2, { hasStages: false, deepS: 99, hrvMs: 48, rhrBpm: 52 })] },
      as("other"),
    );
    expect(out.saved).toBe(2);
    const rows = (await client.execute(`SELECT * FROM sleep_night WHERE user_id = 'other' ORDER BY wake_date`)).rows;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ has_stages: 0, deep_s: null, hrv_ms: 48, rhr_bpm: 52 });
    expect(rows[1]).toMatchObject({ asleep_s: 6 * 3600 });
    // a later push replaces the row completely: the HRV that is now absent is gone
    await call(sleepInsightsRouter.upsertNights, { nights: [nightAgo(2, { hasStages: false })] }, as("other"));
    const again = (await client.execute(`SELECT hrv_ms FROM sleep_night WHERE user_id = 'other' AND wake_date = '${shiftDate(today, -2)}'`)).rows[0]!;
    expect(again.hrv_ms).toBeNull();
  });

  test("validation: dates, durations, ranges, naps, env", async () => {
    await enable("other");
    const push = (night: Record<string, unknown>) => call(sleepInsightsRouter.upsertNights, { nights: [night as never] }, as("other"));
    await expect(push(nightAgo(-3))).rejects.toThrow(); // too far ahead
    await expect(push(nightAgo(120))).rejects.toThrow(); // older than retention
    await expect(push({ ...nightAgo(3), wakeMs: nightAgo(3).onsetMs - 1 })).rejects.toThrow();
    await expect(push({ ...nightAgo(3), asleepS: 9 * 3600 })).rejects.toThrow(); // asleep longer than in bed
    await expect(push({ ...nightAgo(3), hrvMs: 900 })).rejects.toThrow();
    await expect(push({ ...nightAgo(3), rhrBpm: 10 })).rejects.toThrow();
    await expect(push({ ...nightAgo(3), naps: [[1, 2], [1, 2], [1, 2], [1, 2], [1, 2]] })).rejects.toThrow();
    await expect(push({ ...nightAgo(3), env: { tempCMean: 99 } })).rejects.toThrow();
    const env = { tempCMean: 28.5, tempCMin: 27, tempCMax: 30, rhPctMean: 70, rhPctMin: 60, rhPctMax: 80, samples: 90, source: "lywsd03mmc" };
    expect((await push({ ...nightAgo(3), env })).saved).toBe(1);
    const row = (await client.execute(`SELECT temp_c_mean, env_samples, env_source FROM sleep_night WHERE user_id = 'other' AND wake_date = '${shiftDate(today, -3)}'`)).rows[0]!;
    expect(row).toMatchObject({ temp_c_mean: 28.5, env_samples: 90, env_source: "lywsd03mmc" });
  });

  test("retention: only the newest 90 nights are kept", async () => {
    await enable("free");
    // 92 distinct wake dates are acceptable (90 days back to tomorrow); the oldest two are trimmed
    const all = Array.from({ length: 92 }, (_, k) => nightAgo(90 - k));
    for (let i = 0; i < all.length; i += 14) {
      await call(sleepInsightsRouter.upsertNights, { nights: all.slice(i, i + 14) }, as("free"));
    }
    expect(await nightCount("free")).toBe(90);
    const oldest = (await client.execute(`SELECT min(wake_date) AS d FROM sleep_night WHERE user_id = 'free'`)).rows[0]!.d;
    expect(String(oldest)).toBe(shiftDate(today, -88));
  });

  test("turning the switch off deletes nights, cache and dismissals; other accounts are untouched", async () => {
    await enable("other");
    await call(sleepInsightsRouter.upsertNights, { nights: [nightAgo(1)] }, as("other"));
    await enable("pro");
    await call(sleepInsightsRouter.upsertNights, { nights: [nightAgo(1)] }, as("pro"));
    await call(sleepInsightsRouter.dismiss, { id: "general:caffeine" }, as("other"));
    await client.execute(`INSERT INTO sleep_insight_cache (user_id, factor, signature, result_json, computed_at) VALUES ('other', 'caffeine', 's', '{}', 1)`);
    const off = await call(sleepInsightsRouter.setConsent, { enabled: false, version: SLEEP_CONSENT_VERSION }, as("other"));
    expect(off).toMatchObject({ enabled: false, nights: 0 });
    expect(await nightCount("other")).toBe(0);
    expect(Number((await client.execute(`SELECT count(*) AS c FROM sleep_insight_cache WHERE user_id = 'other'`)).rows[0]!.c)).toBe(0);
    const pref = (await client.execute(`SELECT dismissed_json FROM sleep_insight_pref WHERE user_id = 'other'`)).rows[0]!;
    expect(String(pref.dismissed_json)).toBe("[]");
    expect(await nightCount("pro")).toBe(1);
    await expect(call(sleepInsightsRouter.upsertNights, { nights: [nightAgo(1)] }, as("other"))).rejects.toMatchObject({ message: "consent_required" });
  });

  test("the wipe removes nights, cache and the pref row", async () => {
    await client.executeMultiple(`INSERT INTO "user" (id, name, email) VALUES ('wipe', 'w', 'w@test.id')`);
    await enable("wipe");
    await call(sleepInsightsRouter.upsertNights, { nights: [nightAgo(1)] }, as("wipe"));
    await client.execute(`INSERT INTO sleep_insight_cache (user_id, factor, signature, result_json, computed_at) VALUES ('wipe', 'caffeine', 's', '{}', 1)`);
    await deleteAllUserData(db, "wipe");
    for (const table of ["sleep_night", "sleep_insight_cache", "sleep_insight_pref"]) {
      expect(Number((await client.execute(`SELECT count(*) AS c FROM ${table} WHERE user_id = 'wipe'`)).rows[0]!.c)).toBe(0);
    }
  });

  test("free days and dismiss are validated", async () => {
    expect((await call(sleepInsightsRouter.setFreeDays, { mask: 3 }, as("other"))).freeDaysMask).toBe(3);
    await expect(call(sleepInsightsRouter.setFreeDays, { mask: 200 }, as("other"))).rejects.toThrow();
    await expect(call(sleepInsightsRouter.dismiss, { id: "nonsense" }, as("other"))).rejects.toThrow();
  });
});

describe("sleepInsights.get: gating, a real finding and the free teaser", () => {
  const user = "findings";
  const dayOf = (daysAgo: number) => shiftDate(today, -daysAgo);

  test("setup: 30 nights with later onset-driven short sleep on coffee nights", async () => {
    await client.executeMultiple(`INSERT INTO "user" (id, name, email, tier, founder_until) VALUES ('${user}', 'f', 'f@test.id', 'founder', NULL)`);
    await enable(user);
    const nights = [];
    for (let daysAgo = 29; daysAgo >= 0; daysAgo--) {
      const coffeeNight = daysAgo % 3 === 0;
      // wobble keeps the SD honest; coffee nights are about 45 minutes shorter
      const asleepS = (7 * 60 + ((daysAgo * 7) % 11) - 5 - (coffeeNight ? 45 : 0)) * 60;
      nights.push(nightAgo(daysAgo, { asleepS }));
    }
    for (let i = 0; i < nights.length; i += 14) {
      await call(sleepInsightsRouter.upsertNights, { nights: nights.slice(i, i + 14) }, as(user));
    }
    // food: breakfast + dinner every day (complete) and a coffee at 17:00 WIB on coffee nights
    const wib = (date: string, h: number) => Date.parse(`${date}T00:00:00Z`) - TZ * 60_000 + h * HOUR;
    const rows: string[] = [];
    for (let daysAgo = 31; daysAgo >= 0; daysAgo--) {
      const date = dayOf(daysAgo);
      const add = (id: string, meal: string, name: string, h: number) =>
        rows.push(`('${id}${daysAgo}', '${user}', '${date}', '${meal}', '${name}', 300, ${wib(date, h)}, ${wib(date, h)})`);
      add("b", "sarapan", "Nasi uduk", 7);
      add("d", "makan_malam", "Soto ayam", 18.5);
      // the coffee precedes the night that ENDS on `daysAgo`, i.e. it is logged the day before
      if ((daysAgo - 1) % 3 === 0) add("c", "snack", "Kopi susu", 17);
    }
    await client.execute(`INSERT INTO food_log (id, user_id, date, meal, name, kcal, eaten_at, created_at) VALUES ${rows.join(",")}`);
    expect(await nightCount(user)).toBe(30);
  });

  test("Pro sees a personal caffeine card with counts and nights; wording is descriptive", async () => {
    const findings = await sleepFindingsFor(db, user);
    expect(findings.map((f) => f.factor)).toContain("caffeine");
    const view = await call(sleepInsightsRouter.get, { locale: "id" }, as(user, PAYWALL));
    expect(view.enabled).toBe(true);
    expect(view.personal).toBe("ready");
    const card = view.cards.find((c) => c.id === "personal:caffeine")!;
    expect(card.kind).toBe("personal");
    expect(["maybe", "leaning"]).toContain(card.confidence ?? "");
    expect(card.exposed! + card.other!).toBe(card.nights.length);
    expect(card.text).toContain("lebih pendek");
    expect(card.text).not.toMatch(/menyebabkan|karena kopi/);
    expect(card.nights.filter((n) => n.exposed)).toHaveLength(card.exposed!);
    expect(view.cards.length).toBeLessThanOrEqual(3);
    expect(view.lastNight?.asleepMin).toBeGreaterThan(300);
    // a second read is stable (cache + seed)
    const again = await call(sleepInsightsRouter.get, { locale: "id" }, as(user, PAYWALL));
    expect(again.cards.map((c) => c.text)).toEqual(view.cards.map((c) => c.text));
  });

  test("dismiss hides the card", async () => {
    await call(sleepInsightsRouter.dismiss, { id: "personal:caffeine" }, as(user, PAYWALL));
    const view = await call(sleepInsightsRouter.get, { locale: "en" }, as(user, PAYWALL));
    expect(view.cards.some((c) => c.id === "personal:caffeine")).toBe(false);
  });

  test("a free account on a paywalled server gets the count only, no personal card", async () => {
    // copy the same nights/food to a free account
    await client.executeMultiple(`INSERT INTO "user" (id, name, email, tier) VALUES ('freeview', 'fv', 'fv@test.id', 'free')`);
    await enable("freeview");
    await client.execute(`INSERT INTO sleep_night SELECT 'freeview', wake_date, onset_ms, wake_ms, tz_offset_min, asleep_s, awake_s, awakenings, has_stages, deep_s, rem_s, light_s, watch_score, hrv_ms, rhr_bpm, naps_json, engine_rev, updated_at, temp_c_mean, temp_c_min, temp_c_max, rh_pct_mean, rh_pct_min, rh_pct_max, env_samples, env_source, pm25_mean FROM sleep_night WHERE user_id = '${user}'`);
    await client.execute(`INSERT INTO food_log (id, user_id, date, meal, name, kcal, eaten_at, created_at) SELECT 'fv' || id, 'freeview', date, meal, name, kcal, eaten_at, created_at FROM food_log WHERE user_id = '${user}'`);
    const view = await call(sleepInsightsRouter.get, { locale: "id" }, as("freeview", PAYWALL));
    expect(view.personal).toBe("locked");
    expect(view.lockedCount).toBeGreaterThanOrEqual(1);
    expect(view.cards.every((c) => c.kind === "general")).toBe(true);
  });

  test("with the switch off nothing is computed", async () => {
    const view = await call(sleepInsightsRouter.get, { locale: "id" }, as("pro"));
    // pro was switched on earlier but has a single night: not enough for comparisons
    expect(view.personal).toBe("needs_nights");
    await client.executeMultiple(`INSERT INTO "user" (id, name, email) VALUES ('cold', 'c', 'c@test.id')`);
    const cold = await call(sleepInsightsRouter.get, undefined, as("cold"));
    expect(cold).toMatchObject({ enabled: false, cards: [], progress: [], lastNight: null });
  });
});
