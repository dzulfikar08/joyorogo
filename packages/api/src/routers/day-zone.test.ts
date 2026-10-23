import { call } from "@orpc/server";
import { afterAll, describe, expect, test, setSystemTime } from "bun:test";

import { d1TestDb } from "@joyorogo/db/test-d1";

import type { Context } from "../context";
import { dayRouter } from "./day";

const { client, db } = await d1TestDb();

// 2026-10-21T15:30Z = 23:30 MYT / 22:30 WIB; 16:20Z = 00:20 MYT (22nd) / 23:20 WIB (still the 21st).
await client.executeMultiple(`
  INSERT INTO "user" (id, name, email, tier) VALUES ('my', 'm', 'm@test.my', 'free'), ('id', 'i', 'i@test.id', 'free');
  INSERT INTO profile (user_id, birth_year, gender, height_cm, start_weight_kg, target_weight_kg, target_date, activity_level, timezone)
    VALUES ('my', 1990, 'male', 170, 80, 72, '2030-01-01', 'light', 'Asia/Kuala_Lumpur'),
           ('id', 1990, 'male', 170, 80, 72, '2030-01-01', 'light', 'Asia/Jakarta');
  INSERT INTO food_log (id, user_id, date, meal, name, kcal, protein, carbs, fat) VALUES
    ('my-1', 'my', '2026-10-21', 'makan_malam', 'Nasi lemak', 600, 15, 80, 20),
    ('my-2', 'my', '2026-10-22', 'snack', 'Roti canai', 300, 6, 40, 12),
    ('id-1', 'id', '2026-10-21', 'makan_malam', 'Nasi goreng', 600, 15, 80, 20),
    ('id-2', 'id', '2026-10-21', 'snack', 'Pisang goreng', 300, 3, 40, 12);
`);

const as = (userId: string) => ({
  context: { db, env: {}, waitUntil: () => {}, session: { user: { id: userId } } } as unknown as Context,
});

afterAll(() => setSystemTime());

describe("day.summary in the user's zone", () => {
  test("a MY user logging at 23:30 and 00:20 MYT keeps a two-day streak at 00:30 MYT", async () => {
    setSystemTime(new Date("2026-10-21T16:30:00Z"));
    const out = await call(dayRouter.summary, {}, as("my"));
    expect(out.date).toBe("2026-10-22");
    expect(out.streakDays).toBe(2);
  });

  test("the same instants are one WIB day for a Jakarta user: today is still the 21st, streak 1", async () => {
    setSystemTime(new Date("2026-10-21T16:30:00Z"));
    const out = await call(dayRouter.summary, {}, as("id"));
    expect(out.date).toBe("2026-10-21");
    expect(out.streakDays).toBe(1);
  });

  test("Beranda today flips at local midnight: MYT is on the 22nd at 16:30Z, WIB on the 21st", async () => {
    setSystemTime(new Date("2026-10-21T16:30:00Z"));
    expect((await call(dayRouter.summary, {}, as("my"))).date).toBe("2026-10-22");
    expect((await call(dayRouter.summary, {}, as("id"))).date).toBe("2026-10-21");
    setSystemTime(new Date("2026-10-21T17:30:00Z"));
    expect((await call(dayRouter.summary, {}, as("id"))).date).toBe("2026-10-22");
  });
});
