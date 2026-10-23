import { call } from "@orpc/server";
import { describe, expect, test } from "bun:test";

import { d1TestDb } from "@joyorogo/db/test-d1";

import type { Context } from "../context";
import { jakartaToday, shiftDate } from "../lib/engine";
import { ENERGY_NOTICE_BEFORE_MS } from "../lib/energy-notice";
import { dayActiveKcal } from "../lib/exercise-credit";
import { activityRouter } from "./activity";
import { dayRouter } from "./day";
import { exerciseRouter } from "./exercise";
import { fitnessRouter } from "./fitness";

// What the diary reads when JoyoFit sends a day's watch workouts and its all-day energy, and when the phone's health
// store holds estimated walks (the owner's 15 and 18 Okt). The clients ask these four procedures; they must answer with
// what the account holds the moment it holds it, and a screen that asked earlier has to ask again.

const { client, db } = await d1TestDb();

const today = jakartaToday();
const yesterday = shiftDate(today, -1);
const threeDaysAgo = shiftDate(today, -3);
const old = ENERGY_NOTICE_BEFORE_MS - 86_400_000;

await client.executeMultiple(`
  INSERT INTO "user" (id, name, email, tier, created_at) VALUES ('owner', 'owner', 'owner@test.id', 'founder', ${old});
  INSERT INTO profile (user_id, birth_year, gender, height_cm, start_weight_kg, target_weight_kg, target_date, activity_level)
    VALUES ('owner', 1990, 'male', 170, 108, 90, '2031-01-01', 'light');
`);

const as = {
  context: {
    db,
    env: {},
    waitUntil: () => {},
    session: { user: { id: "owner", createdAt: new Date(old) } },
  } as unknown as Context,
};

const summary = (date: string) => call(dayRouter.summary, { date }, as);
const listByDate = (date: string) => call(exerciseRouter.listByDate, { date }, as);

const watchWorkout = (start: number, name: string, type: string, durationMin: number, kcal: number, date: string) =>
  call(exerciseRouter.upsertJoyofit, { externalId: `watch:${start}`, date, name, type, durationMin, kcal }, as);

// the iPhone's Apple Health day rollup, read by the app
await call(activityRouter.upsert, { date: today, steps: 586, distanceMeters: 400, activeCalories: 13, exerciseMinutes: 0, source: "apple_health" }, as);
// two Apple Health walks without recorded energy: the app imports them as MET estimates at 107.7 kg (5.0 MET x 3.5 x kg x min / 200)
await call(activityRouter.upsert, { date: threeDaysAgo, steps: 4972, distanceMeters: 3500, activeCalories: 254, exerciseMinutes: 40, source: "apple_health" }, as);
await call(exerciseRouter.add, { date: threeDaysAgo, type: "Walk", name: "Jalan", durationMin: 50, kcal: 471, source: "apple_health", externalId: "0F02359B" }, as);
await call(exerciseRouter.add, { date: threeDaysAgo, type: "Walk", name: "Jalan", durationMin: 69, kcal: 650, source: "apple_health", externalId: "D2B53405" }, as);

describe("before JoyoFit has sent anything", () => {
  test("today holds no workout and only the health store's 13 kcal", async () => {
    expect((await listByDate(today)).items).toEqual([]);
    const s = await summary(today);
    expect(s.exerciseCredit).toMatchObject({ allDayKcal: 13, allDaySource: "apple_health", activeKcal: 13 });
    expect(dayActiveKcal(s.exerciseCredit, 0)).toBe(13);
  });
});

describe("after JoyoFit sent the watch workouts and the all-day energy", () => {
  test("the same questions now answer with the JoyoFit rows and the 418 kcal", async () => {
    await watchWorkout(1792283744, "Walking", "jalan_cepat", 25, 143, today);
    await watchWorkout(1792316333, "Biking", "sepeda", 3, 17, today);
    await watchWorkout(1792318308, "Walking", "jalan_cepat", 6, 27, today);
    await watchWorkout(1792318704, "Running", "lari", 10, 82, today);
    await watchWorkout(1792231128, "Walking", "jalan_cepat", 34, 127, yesterday);
    await call(fitnessRouter.upsertScores, { days: [{ date: today, strain: 13.4, activeKcal: 418 }, { date: yesterday, strain: 4.5, activeKcal: 156 }] }, as);

    const list = await listByDate(today);
    expect(list.items.map((item) => `${item.name}:${item.kcal}:${item.source}`).sort()).toEqual(
      ["Biking:17:joyofit", "Running:82:joyofit", "Walking:143:joyofit", "Walking:27:joyofit"].sort(),
    );
    expect(list.totalKcal).toBe(269);

    const recent = await call(exerciseRouter.recent, { days: 7 }, as);
    expect(recent.items.filter((item) => item.source === "joyofit").map((item) => item.date).sort()).toEqual([yesterday, today, today, today, today].sort());

    const s = await summary(today);
    // max(418 watch, 13 health store) = 418; the watch's workouts are inside it and add nothing. This person's factor
    // (light, 1.375) already contains 467 kcal of movement, so 418 is below it: nothing is added to the target.
    expect(s.exerciseCredit).toMatchObject({ allDayKcal: 418, allDaySource: "joyofit", deviceWorkoutKcal: 269, otherWorkoutKcal: 0, activeKcal: 418, includedKcal: 467, extraKcal: 0, countedKcal: 0 });
    expect(s.targets!.exerciseKcal).toBe(0);
    expect(s.exerciseSources).toEqual(["joyofit"]);
    // the ring of the exercise screens is the 418, not the 269 of the rows
    expect(dayActiveKcal(s.exerciseCredit, list.totalKcal)).toBe(418);
  });
});

describe("the estimated Apple Health walks of 15 Okt", () => {
  test("are listed with their inflated rows but the day counts the 254 kcal the phone measured", async () => {
    const list = await listByDate(threeDaysAgo);
    expect(list.items.map((item) => item.kcal).sort()).toEqual([471, 650]);
    expect(list.totalKcal).toBe(1121);
    const s = await summary(threeDaysAgo);
    expect(s.exerciseCredit).toMatchObject({ allDayKcal: 254, allDaySource: "apple_health", deviceWorkoutKcal: 1121, activeKcal: 254, extraKcal: 0, countedKcal: 0 });
    expect(dayActiveKcal(s.exerciseCredit, list.totalKcal)).toBe(254);
  });
});
