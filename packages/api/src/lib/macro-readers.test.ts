// Readers that average protein over days: a day whose rows have kcal but no protein is unknown, not 0 g, and must not
// pull "average protein" toward 0 (the coach and the MCP/JoyoFit daily totals).

import { describe, expect, test } from "bun:test";

import { d1TestDb } from "@joyorogo/db/test-d1";
import { DEFAULT_DAY_ZONE } from "@joyorogo/i18n";

import { readFoodContext } from "./coach-context";
import { getDailyTotals } from "./fit-data";

const { client, db } = await d1TestDb();
await client.executeMultiple(`
  INSERT INTO "user" (id, name, email) VALUES ('r1', 'r1', 'r1@test.id'), ('r2', 'r2', 'r2@test.id');
  INSERT INTO profile (user_id, birth_year, gender, height_cm, start_weight_kg, target_weight_kg, target_date, activity_level)
    VALUES ('r1', 1990, 'male', 170, 80, 70, '2031-01-01', 'light');
  -- r1: two days with protein, one kcal-only day (no macros known)
  INSERT INTO food_log (id, user_id, date, meal, name, kcal, protein) VALUES
    ('a1', 'r1', '2026-10-18', 'sarapan', 'Telur', 300, 30),
    ('a2', 'r1', '2026-10-19', 'sarapan', 'Ayam', 400, 50),
    ('a3', 'r1', '2026-10-20', 'sarapan', 'Kue', 500, NULL),
    ('b1', 'r2', '2026-10-18', 'sarapan', 'Kue', 500, NULL);
`);

describe("protein averages skip days with unknown protein", () => {
  test("coach context: avgProtein7 is over the days that know it; kcal still averages every logged day", async () => {
    const food = await readFoodContext(db, "r1", "2026-10-21");
    expect(food.loggedDays7).toBe(3);
    expect(food.avgKcal7).toBe(400);
    expect(food.avgProtein7).toBe(40);
  });

  test("coach context: no day knows protein -> null, not 0", async () => {
    expect((await readFoodContext(db, "r2", "2026-10-21")).avgProtein7).toBeNull();
  });

  test("daily totals (MCP / JoyoFit): average protein over known days, per-day unknown stays null", async () => {
    const totals = await getDailyTotals(db, "r1", "2026-10-18", "2026-10-20", DEFAULT_DAY_ZONE);
    expect(totals.average).toEqual({ eatenKcal: 400, proteinG: 40, loggedDays: 3 });
    expect(totals.days.map((d) => d.proteinG)).toEqual([30, 50, null]);
  });
});
