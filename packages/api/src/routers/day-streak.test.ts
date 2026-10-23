import { call } from "@orpc/server";
import { afterAll, describe, expect, test, setSystemTime } from "bun:test";

import { d1TestDb } from "@joyorogo/db/test-d1";

import type { Context } from "../context";
import { shiftDate } from "../lib/engine";
import { dayRouter } from "./day";

const { client, db } = await d1TestDb();

// 12:00 WIB on the 23rd.
const NOW = new Date("2026-10-23T05:00:00Z");
const TODAY = "2026-10-23";
const back = (n: number) => shiftDate(TODAY, -n);

let seq = 0;
function foodRows(userId: string, dates: string[], kcal = 1500): string {
  return dates.map((date) => `('f${seq++}', '${userId}', '${date}', 'makan_siang', 'Nasi', ${kcal}, 10, 50, 10)`).join(",");
}
const days = (from: number, to: number) => Array.from({ length: from - to + 1 }, (_, i) => back(from - i));

/** A normal weight-loss profile (80 -> 72 kg), or the columns overridden. */
function profile(userId: string, over: Record<string, string | number> = {}): string {
  const row: Record<string, string | number> = {
    user_id: `'${userId}'`,
    birth_year: 1990,
    gender: "'male'",
    height_cm: 170,
    start_weight_kg: 80,
    target_weight_kg: 72,
    target_date: "'2030-01-01'",
    activity_level: "'light'",
    timezone: "'Asia/Jakarta'",
    ...over,
  };
  return `INSERT INTO profile (${Object.keys(row).join(", ")}) VALUES (${Object.values(row).join(", ")});`;
}

await client.executeMultiple(`
  INSERT INTO "user" (id, name, email, tier) VALUES
    ('long', 'l', 'l@t.id', 'free'), ('risk', 'r', 'r@t.id', 'free'), ('broken', 'b', 'b@t.id', 'free'),
    ('fresh', 'f', 'f@t.id', 'free'), ('gain', 'g', 'g@t.id', 'free'), ('mum', 'm', 'm@t.id', 'free'),
    ('import', 'i', 'i@t.id', 'free'), ('old', 'o', 'o@t.id', 'free');
  ${["long", "risk", "broken", "fresh", "import", "old"].map((id) => profile(id)).join("\n")}
  ${profile("gain", { goal: "'gain'", start_weight_kg: 60, target_weight_kg: 70 })}
  ${profile("mum", { maternal_mode: "'pregnant'" })}
  INSERT INTO food_log (id, user_id, date, meal, name, kcal, protein, carbs, fat) VALUES
    ${foodRows("long", days(123, 0))},
    ${foodRows("risk", days(8, 1))},
    ${foodRows("broken", days(20, 3))},
    ${foodRows("gain", days(5, 0), 6000)},
    ${foodRows("gain", [back(8), back(7)], 100)},
    ${foodRows("mum", days(5, 0))},
    ${foodRows("old", days(60, 50))},
    ${foodRows("old", [TODAY])};
  INSERT INTO food_log (id, user_id, date, meal, name, kcal, protein, carbs, fat, source) VALUES
    ${days(30, 0).map((date) => `('f${seq++}', 'import', '${date}', 'makan_siang', 'Nasi', 1500, 10, 50, 10, 'huawei')`).join(",")};
`);

const as = (userId: string) => ({
  context: { db, env: {}, waitUntil: () => {}, session: { user: { id: userId } } } as unknown as Context,
});
const summary = async (userId: string) => {
  setSystemTime(NOW);
  return call(dayRouter.summary, {}, as(userId));
};

afterAll(() => setSystemTime());

describe("day.summary streak", () => {
  test("a 124-day run reads 124, past the 45-day window the summary scans", async () => {
    const out = await summary("long");
    expect(out.streakDays).toBe(124);
    expect(out.streak).toEqual({ days: 124, status: "done", lastLoggedDate: TODAY, lapseDays: 0 });
  });

  test("today not logged, yesterday was: alive, at risk, and the run still counts", async () => {
    const out = await summary("risk");
    expect(out.streakDays).toBe(8);
    expect(out.streak).toEqual({ days: 8, status: "at_risk", lastLoggedDate: back(1), lapseDays: 1 });
  });

  test("last log three days ago: broken, 0 days, and the lapse counts from the last log", async () => {
    const out = await summary("broken");
    expect(out.streakDays).toBe(0);
    expect(out.streak).toEqual({ days: 0, status: "broken", lastLoggedDate: back(3), lapseDays: 3 });
  });

  test("no log at all: none", async () => {
    const out = await summary("fresh");
    expect(out.streakDays).toBe(0);
    expect(out.streak).toEqual({ days: 0, status: "none", lastLoggedDate: null, lapseDays: 0 });
  });

  test("a log today after a long gap restarts the run at 1; the old run is not bridged", async () => {
    const out = await summary("old");
    expect(out.streak).toEqual({ days: 1, status: "done", lastLoggedDate: TODAY, lapseDays: 0 });
  });

  test("imported history never counts, and neither is it a last log", async () => {
    const out = await summary("import");
    expect(out.streakDays).toBe(0);
    expect(out.streak).toMatchObject({ status: "none", lastLoggedDate: null });
  });

  test("a Naikin BB plan counts days at 90% of the target: two thin days broke the run", async () => {
    const out = await summary("gain");
    expect(out.hasProfile).toBe(true);
    // Days 5..0 are full (1500 kcal each, six days), 8 and 7 are thin (400): the run is the six full days.
    expect(out.streakDays).toBe(6);
    expect(out.streak).toMatchObject({ days: 6, status: "done", lastLoggedDate: TODAY });
  });

  test("Hamil / Menyusui carry no streak at all", async () => {
    const out = await summary("mum");
    expect(out.streakDays).toBe(0);
    expect(out.streak).toBeNull();
  });
});
