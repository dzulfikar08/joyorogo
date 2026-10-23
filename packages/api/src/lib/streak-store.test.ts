import { afterAll, describe, expect, test, setSystemTime } from "bun:test";

import { d1TestDb } from "@joyorogo/db/test-d1";

import { shiftDate } from "./engine";
import { loadPeriodProgress } from "./period-store";
import { loadWeekRecap } from "./recap-store";
import { loadStreaks, loadUserStreak } from "./streak-store";

const { client, db } = await d1TestDb();

// 12:00 WIB on Friday the 23rd.
const NOW = new Date("2026-10-23T05:00:00Z");
const TODAY = "2026-10-23";
const back = (n: number) => shiftDate(TODAY, -n);
const days = (from: number, to: number) =>
  Array.from({ length: from - to + 1 }, (_, i) => back(from - i));

let seq = 0;
const foodRows = (userId: string, dates: string[], kcal = 1500, source = "manual") =>
  dates
    .map(
      (date) =>
        `('f${seq++}', '${userId}', '${date}', 'makan_siang', 'Nasi', ${kcal}, 10, 50, 10, '${source}')`,
    )
    .join(",");

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

const USERS = ["long", "yday", "gone", "gain", "mum", "import", "my"];
await client.executeMultiple(`
  INSERT INTO "user" (id, name, email, tier) VALUES ${USERS.map((id) => `('${id}', '${id}', '${id}@t.id', 'free')`).join(",")};
  ${["long", "yday", "gone", "import"].map((id) => profile(id)).join("\n")}
  ${profile("my", { timezone: "'Asia/Kuala_Lumpur'" })}
  ${profile("gain", { goal: "'gain'", start_weight_kg: 60, target_weight_kg: 70 })}
  ${profile("mum", { maternal_mode: "'pregnant'" })}
  INSERT INTO food_log (id, user_id, date, meal, name, kcal, protein, carbs, fat, source) VALUES
    ${foodRows("long", days(123, 0))},
    ${foodRows("yday", days(123, 1))},
    ${foodRows("gone", days(123, 2))},
    ${foodRows("my", days(10, 1))},
    ${foodRows("gain", days(100, 0), 6000)},
    ${foodRows("mum", days(100, 0))},
    ${foodRows("import", days(60, 0), 1500, "huawei")};
`);

afterAll(() => setSystemTime());

describe("loadStreaks", () => {
  test("a 124-day run reads 124, yesterday-ended runs stay alive, a missed yesterday is broken", async () => {
    const out = await loadStreaks(
      db,
      TODAY,
      ["long", "yday", "gone"].map((userId) => ({ userId, gainTargetKcal: null })),
    );
    expect(out.get("long")).toEqual({
      days: 124,
      status: "done",
      lastLoggedDate: TODAY,
      lapseDays: 0,
    });
    expect(out.get("yday")).toEqual({
      days: 123,
      status: "at_risk",
      lastLoggedDate: back(1),
      lapseDays: 1,
    });
    expect(out.get("gone")).toEqual({
      days: 0,
      status: "broken",
      lastLoggedDate: back(2),
      lapseDays: 2,
    });
  });

  test("Naikin BB counts days at 90% of the target, and imports never count", async () => {
    const out = await loadStreaks(db, TODAY, [
      { userId: "gain", gainTargetKcal: 6000 },
      { userId: "import", gainTargetKcal: null },
    ]);
    expect(out.get("gain")?.days).toBe(101);
    expect((await loadUserStreak(db, "gain", TODAY, 7000)).days).toBe(0);
    expect(out.get("import")).toMatchObject({ days: 0, status: "none" });
  });

  test("the day is the person's zone: the same logs are alive at 23:30 in Jakarta and broken at 00:30 in Kuala Lumpur", async () => {
    // 16:30 UTC on the 23rd: 23:30 WIB on the 23rd, 00:30 MYT on the 24th. "my" logged through yesterday (the 22nd).
    const alive = await loadUserStreak(db, "my", "2026-10-23", null);
    const later = await loadUserStreak(db, "my", "2026-10-24", null);
    expect(alive).toMatchObject({ days: 10, status: "at_risk" });
    expect(later).toMatchObject({ days: 0, status: "broken", lapseDays: 2 });
  });
});

describe("every consumer reads the same run", () => {
  test("Progres (period-store): 124 for a 124-day run, 0 once broken, 0 for Hamil", async () => {
    setSystemTime(NOW);
    const progress = (userId: string) => loadPeriodProgress(db, userId, {}, "Asia/Jakarta");
    expect((await progress("long"))?.streakDays).toBe(124);
    expect((await progress("yday"))?.streakDays).toBe(123);
    expect((await progress("gone"))?.streakDays).toBe(0);
    expect(await progress("mum")).toBeNull();
  });

  test("weekly recap: counted as of today mid-week, as of the week's end for a finished week; Hamil 0", async () => {
    setSystemTime(NOW);
    const recap = async (userId: string, week?: string) =>
      (await loadWeekRecap(db, userId, week, "Asia/Jakarta"))?.recap.streakDays;
    expect(await recap("long")).toBe(124);
    // The week of Oct 12-18 ended on the 18th: the run as of that day.
    expect(await recap("long", "2026-10-12")).toBe(119);
    expect(await recap("gone")).toBe(0);
    expect(await recap("mum")).toBe(0);
  });

  test("Kuala Lumpur at 00:30: the zone's own today decides the recap and Progres", async () => {
    setSystemTime(new Date("2026-10-23T16:30:00Z"));
    const progress = await loadPeriodProgress(db, "my", {}, "Asia/Kuala_Lumpur");
    expect(progress?.streakDays).toBe(0);
    const wib = await loadPeriodProgress(db, "my", {}, "Asia/Jakarta");
    expect(wib?.streakDays).toBe(10);
  });
});
