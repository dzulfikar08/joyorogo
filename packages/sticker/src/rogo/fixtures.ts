import type { StorySpec } from "./data";
import type { DayFoodMeal, DayFoodStory } from "./dayfood";

/**
 * Fixture data for goldens, the contact sheet and unit tests. `photo` names a file
 * under packages/sticker/fixtures (resolved by the harness, never by the app).
 */

export type Fixture = { spec: StorySpec; photo?: "meal.jpg" | "portrait.jpg"; note: string };

const DAY = new Date(2026, 9, 18, 12);

const CUT = "fixture:cutout.png";

/** A day of food (the owner's 22 Oct diary, names and numbers as logged): 4 meals, protein reached, kcal on target. */
const FOOD_MEALS: DayFoodMeal[] = [
  {
    label: "Sarapan",
    kcal: 217,
    protein: 23,
    carbs: 30,
    fat: 0,
    names: "Pepaya, Putih telur, Americano ice",
    stickers: [CUT, CUT, CUT],
    items: [
      { name: "Americano Ice", grams: 350, kcal: 5, protein: 0, carbs: 1, fat: 0 },
      { name: "Putih Telur", grams: 200, kcal: 104, protein: 22, carbs: 2, fat: 0 },
      { name: "Pepaya", grams: 258, kcal: 108, protein: 1, carbs: 27, fat: 0 },
    ],
  },
  {
    label: "Makan siang",
    kcal: 690,
    protein: 43,
    carbs: 75,
    fat: 25,
    names: "Nasi Liwet Ayam Bakar, Putih Telur",
    stickers: [CUT],
    items: [
      { name: "nasi liwet", grams: 200, kcal: 300, protein: 6, carbs: 60, fat: 4 },
      { name: "ayam bakar", grams: 80, kcal: 168, protein: 20, carbs: 4, fat: 8 },
      { name: "tahu goreng", grams: 40, kcal: 60, protein: 4, carbs: 2, fat: 5 },
      { name: "sambal", grams: 20, kcal: 50, protein: 0, carbs: 2, fat: 5 },
      { name: "sayur urap", grams: 40, kcal: 60, protein: 2, carbs: 6, fat: 3 },
      { name: "Putih Telur", grams: 100, kcal: 52, protein: 11, carbs: 1, fat: 0 },
    ],
  },
  {
    label: "Makan malam",
    kcal: 681,
    protein: 45,
    carbs: 20,
    fat: 47,
    names: "Putih telur, Ayam Goreng",
    stickers: [CUT, CUT],
    items: [
      { name: "Putih Telur", grams: 100, kcal: 52, protein: 11, carbs: 1, fat: 0 },
      { name: "ayam goreng", grams: 120, kcal: 274, protein: 22, carbs: 2, fat: 20 },
      { name: "tempe goreng", grams: 40, kcal: 110, protein: 6, carbs: 5, fat: 9 },
      { name: "tahu goreng", grams: 50, kcal: 75, protein: 4, carbs: 3, fat: 6 },
      { name: "timun", grams: 20, kcal: 20, protein: 0, carbs: 1, fat: 0 },
      { name: "serundeng", grams: 30, kcal: 150, protein: 2, carbs: 8, fat: 12 },
    ],
  },
  {
    label: "Snack",
    kcal: 172,
    protein: 11,
    carbs: 39,
    fat: 0,
    names: "Putih Telur, Fibe mini",
    stickers: [],
    items: [
      { name: "Putih Telur", grams: 100, kcal: 52, protein: 11, carbs: 1, fat: 0 },
      { name: "Fibe mini", grams: 100, kcal: 60, protein: 0, carbs: 19, fat: 0 },
      { name: "Fibe mini", grams: 100, kcal: 60, protein: 0, carbs: 19, fat: 0 },
    ],
  },
];

const FOOD_DAY: DayFoodStory = {
  kind: "dayfood",
  kcal: 1760,
  targetKcal: 1850,
  protein: 122,
  carbs: 164,
  fat: 72,
  fiber: 27,
  proteinTargetG: 110,
  carbsTargetG: 242,
  fatTargetG: 51,
  fiberTargetG: 26,
  meals: FOOD_MEALS,
  date: new Date(2026, 9, 22, 12),
};

const isoDay = (offset: number) => new Date(Date.UTC(2026, 8, 19 + offset)).toISOString().slice(0, 10);

const weekDay = (week: number) => new Date(Date.UTC(2026, 2, 1 + week * 7)).toISOString().slice(0, 10);

/** 30 daily weigh-ins from 108.0 kg down to 105.6 kg, with a little scale noise baked into the trend. */
const PERIOD_SERIES = Array.from({ length: 30 }, (_, i) => ({
  date: isoDay(i),
  kg: Math.round((108 - (2.4 * i) / 29 + Math.sin(i / 2.2) * 0.12 * Math.min(i, 29 - i, 3) / 3) * 100) / 100,
}));

/** 30 days of intake against a 1.900 kcal target: logged most days, 4 days with nothing. */
const PERIOD_BARS = Array.from({ length: 30 }, (_, i) => ({
  from: isoDay(i),
  to: isoDay(i),
  avgKcal: [4, 9, 15, 22].includes(i) ? null : 1650 + ((i * 137) % 600),
}));

export const FIXTURES = {
  "meal-photo": {
    note: "meal with photo and all macros",
    photo: "meal.jpg",
    spec: {
      kind: "meal",
      name: "Nasi Goreng Kampung",
      kcal: 612,
      protein: 24,
      carbs: 78,
      fat: 21,
      reaction: "Aman, bro",
      date: DAY,
    },
  },
  "meal-cutout": {
    note: "meal cutout (transparent PNG of the food)",
    spec: {
      kind: "meal",
      name: "Nasi Goreng Kampung",
      kcal: 612,
      protein: 24,
      carbs: 78,
      fat: 21,
      photoUri: "fixture:cutout.png",
      photoCutout: true,
      date: DAY,
    },
  },
  "meal-plate": {
    note: "meal with a photo and a whole-plate sticker (photo cards use the photo, cutout cards the plate sticker)",
    photo: "meal.jpg",
    spec: {
      kind: "meal",
      name: "Nasi Goreng Kampung",
      kcal: 612,
      protein: 24,
      carbs: 78,
      fat: 21,
      cutoutUri: "fixture:cutout.png",
      date: DAY,
    },
  },
  "meal-plain": {
    note: "meal without photo or macros",
    spec: { kind: "meal", name: "Es teh manis", kcal: 120, date: DAY },
  },
  "meal-long": {
    note: "very long name with emoji, no reaction",
    photo: "meal.jpg",
    spec: {
      kind: "meal",
      name: "Mie ayam bakso komplit pangsit goreng tambah ceker extra pedas dan es jeruk \u{1F35C}\u{1F525}",
      kcal: 1284,
      protein: 52,
      carbs: 160,
      fat: 44,
      date: DAY,
    },
  },
  "progress-full": {
    note: "day with macros, streak, weight trend and goal progress",
    photo: "portrait.jpg",
    spec: {
      kind: "progress",
      eatenKcal: 1640,
      targetKcal: 2100,
      proteinG: 98,
      proteinTargetG: 120,
      carbsG: 180,
      fatG: 52,
      streakDays: 30,
      trackedDays: 74,
      weightLostKg: 3.4,
      weekTrend: [
        { date: "2026-10-12", weightKg: 78.9 },
        { date: "2026-10-13", weightKg: 78.6 },
        { date: "2026-10-14", weightKg: 78.7 },
        { date: "2026-10-15", weightKg: 78.2 },
        { date: "2026-10-16", weightKg: 78.0 },
        { date: "2026-10-17", weightKg: 77.8 },
        { date: "2026-10-18", weightKg: 77.5 },
      ],
      weightGoalProgress: 0.62,
      weight: { startKg: 80.9, nowKg: 77.5, goalKg: 72 },
      date: DAY,
    },
  },
  "progress-over": {
    note: "over the target",
    spec: {
      kind: "progress",
      eatenKcal: 2480,
      targetKcal: 2100,
      proteinG: 130,
      proteinTargetG: 120,
      carbsG: 290,
      fatG: 90,
      streakDays: 5,
      date: DAY,
    },
  },
  "progress-gain": {
    note: "Naikin BB plan",
    spec: {
      kind: "progress",
      eatenKcal: 2650,
      targetKcal: 3000,
      proteinG: 140,
      proteinTargetG: 150,
      carbsG: 340,
      fatG: 85,
      streakDays: 9,
      gain: true,
      weightGainedKg: 2.1,
      weightGoalProgress: 0.4,
      weekTrend: [
        { date: "2026-10-12", weightKg: 60.1 },
        { date: "2026-10-18", weightKg: 60.9 },
      ],
      date: DAY,
    },
  },
  "progress-empty": {
    note: "only calories, nothing else",
    spec: { kind: "progress", eatenKcal: 420, targetKcal: 1800, date: DAY },
  },
  "progress-maternal": {
    note: "pregnancy mode: no target framing, no weight",
    spec: {
      kind: "progress",
      eatenKcal: 1900,
      targetKcal: 2300,
      proteinG: 80,
      carbsG: 250,
      fatG: 70,
      streakDays: 14,
      maternal: true,
      date: DAY,
    },
  },
  "period-full": {
    note: "30 days: weight down, deficit with implied fat, streak, daily bars",
    spec: {
      kind: "period",
      from: isoDay(0),
      to: isoDay(29),
      judgedDays: 30,
      loggedDays: 26,
      streakDays: 7,
      weight: { startKg: 108, endKg: 105.6, changeKg: -2.4, changePct: -2.2, direction: "down", weeklyRateKg: -0.56, series: PERIOD_SERIES },
      energy: { balanceKcal: 15600, countedDays: 24, impliedFatKg: 2 },
      intake: { bars: PERIOD_BARS, weekly: false, targetKcal: 1900 },
      date: DAY,
    },
  },
  "period-weekly": {
    note: "since start: weekly bars, no streak, deficit without implied fat",
    spec: {
      kind: "period",
      from: "2026-03-01",
      to: "2026-10-18",
      judgedDays: 232,
      loggedDays: 171,
      streakDays: 1,
      weight: {
        startKg: 112.4,
        endKg: 105.6,
        changeKg: -6.8,
        changePct: -6,
        direction: "down",
        weeklyRateKg: -0.2,
        series: PERIOD_SERIES.map((_, i) => ({ date: new Date(Date.UTC(2026, 2, 1 + i * 8)).toISOString().slice(0, 10), kg: 112.4 - ((112.4 - 105.6) * i) / 29 })),
      },
      energy: { balanceKcal: 61200, countedDays: 150, impliedFatKg: null },
      intake: {
        bars: Array.from({ length: 34 }, (_, i) => ({ from: weekDay(i), to: weekDay(i + 1), avgKcal: i % 9 === 4 ? null : 1700 + ((i * 89) % 500) })),
        weekly: true,
        targetKcal: 1900,
      },
      date: DAY,
    },
  },
  "period-up": {
    note: "weight went up and a cut plan: kind copy, no fat implied, deficit hidden by the user",
    spec: {
      kind: "period",
      from: isoDay(0),
      to: isoDay(29),
      judgedDays: 30,
      loggedDays: 19,
      weight: {
        startKg: 74.2,
        endKg: 74.9,
        changeKg: 0.7,
        changePct: 0.9,
        direction: "up",
        weeklyRateKg: 0.16,
        series: PERIOD_SERIES.map((p, i) => ({ date: p.date, kg: 74.2 + (0.7 * i) / 29 })),
      },
      energy: { balanceKcal: 4200, countedDays: 16, impliedFatKg: null },
      intake: { bars: PERIOD_BARS.slice(0, 19), weekly: false, targetKcal: 1900 },
      hideDeficit: true,
      date: DAY,
    },
  },
  "period-gain": {
    note: "Naikin BB: gained, surplus instead of deficit",
    spec: {
      kind: "period",
      from: isoDay(0),
      to: isoDay(29),
      judgedDays: 30,
      loggedDays: 28,
      streakDays: 12,
      gain: true,
      weight: {
        startKg: 58.1,
        endKg: 59.4,
        changeKg: 1.3,
        changePct: 2.2,
        direction: "up",
        weeklyRateKg: 0.3,
        series: PERIOD_SERIES.map((p, i) => ({ date: p.date, kg: 58.1 + (1.3 * i) / 29 })),
      },
      energy: { balanceKcal: -12400, countedDays: 27 },
      intake: { bars: PERIOD_BARS.map((b) => ({ ...b, avgKcal: b.avgKcal === null ? null : b.avgKcal + 900 })), weekly: false, targetKcal: 2800 },
      date: DAY,
    },
  },
  "period-no-weight": {
    note: "no weigh-ins in the period: days logged lead, no weight chart",
    spec: {
      kind: "period",
      from: isoDay(0),
      to: isoDay(13),
      judgedDays: 14,
      loggedDays: 9,
      streakDays: 3,
      weight: null,
      energy: { balanceKcal: 3800, countedDays: 8, impliedFatKg: 0.5 },
      intake: { bars: PERIOD_BARS.slice(0, 14), weekly: false, targetKcal: 1900 },
      date: DAY,
    },
  },
  "period-sparse": {
    note: "a few logged days, no weigh-ins, no burn estimate",
    spec: {
      kind: "period",
      from: isoDay(0),
      to: isoDay(6),
      judgedDays: 7,
      loggedDays: 2,
      weight: null,
      energy: null,
      intake: { bars: PERIOD_BARS.slice(0, 7), weekly: false, targetKcal: null },
      date: DAY,
    },
  },
  recap: {
    note: "full week",
    photo: "portrait.jpg",
    spec: {
      kind: "recap",
      name: "12-18 Okt",
      weekStart: "2026-10-12",
      weekEnd: "2026-10-18",
      avgKcal: 1980,
      targetKcal: 2100,
      daysOnTarget: 5,
      loggedDays: 7,
      proteinAvgG: 104,
      proteinTargetG: 120,
      streakDays: 21,
      exerciseKcal: 1450,
      exerciseMin: 220,
      weightChangeKg: -0.6,
      bestDay: { label: "Rabu", kcal: 2090 },
      gain: false,
      days: [
        { date: "2026-10-12", kcal: 2050 },
        { date: "2026-10-13", kcal: 1890 },
        { date: "2026-10-14", kcal: 2090 },
        { date: "2026-10-15", kcal: 2310 },
        { date: "2026-10-16", kcal: 1820 },
        { date: "2026-10-17", kcal: 1700 },
        { date: "2026-10-18", kcal: 2000 },
      ],
      date: new Date(2026, 9, 18, 12),
    },
  },
  "recap-sparse": {
    note: "two logged days, nothing else",
    spec: {
      kind: "recap",
      name: "12-18 Okt",
      avgKcal: 1500,
      targetKcal: 2100,
      daysOnTarget: 0,
      loggedDays: 2,
      proteinAvgG: null,
      proteinTargetG: null,
      streakDays: 0,
      exerciseKcal: 0,
      exerciseMin: 0,
      weightChangeKg: null,
      bestDay: null,
      gain: false,
      date: DAY,
    },
  },
  challenge: {
    note: "active challenge, rank 2 of 6",
    spec: {
      kind: "challenge",
      title: "Sepuluh Ribu Langkah Bareng",
      durationDays: 14,
      status: "active",
      hitDays: 9,
      judgedDays: 11,
      streak: 4,
      bestStreak: 6,
      rank: 2,
      participants: 6,
      date: DAY,
    },
  },
  "challenge-upcoming": {
    note: "not started: no rank, no streak",
    spec: {
      kind: "challenge",
      title: "Puasa Gula 7 Hari",
      durationDays: 7,
      status: "upcoming",
      hitDays: 0,
      judgedDays: 0,
      streak: 0,
      bestStreak: 0,
      rank: null,
      participants: 3,
      date: DAY,
    },
  },
  workout: {
    note: "strength session with 2 PRs",
    photo: "portrait.jpg",
    spec: {
      kind: "workout",
      name: "Push Day",
      durationMin: 62,
      volumeKg: 8420,
      setsDone: 21,
      prs: [
        { exercise: "Bench Press", label: "1RM", value: "92,5 kg" },
        { exercise: "Overhead Press", label: "Reps", value: "8 x 50 kg" },
      ],
      date: DAY,
    },
  },
  "workout-bare": {
    note: "name only",
    spec: { kind: "workout", name: "Jalan sore", date: DAY },
  },
  "dayfood-full": {
    note: "whole day: 4 meals (3 cutouts, a plate, 2 cutouts, text only), protein and fibre reached, on target",
    spec: FOOD_DAY,
  },
  "dayfood-over": {
    note: "past the target, protein not reached, a macro nobody logged: no warning colour, no 'over' wording",
    spec: {
      ...FOOD_DAY,
      kcal: 2320,
      protein: 71,
      fiber: null,
      fat: null,
      meals: FOOD_MEALS.slice(0, 3).map((m) => ({ ...m, stickers: m.stickers.slice(0, 1), fat: null })),
    },
  },
  "dayfood-bare": {
    note: "no target (pregnancy mode), one meal, no cutouts, macros unknown",
    spec: {
      kind: "dayfood",
      kcal: 480,
      targetKcal: null,
      meals: [{ label: "Makan siang", kcal: 480, names: "Soto ayam", stickers: [], items: [{ name: "Soto ayam", kcal: 480 }] }],
      date: new Date(2026, 9, 22, 12),
    },
  },
  "dayfood-meal": {
    note: "carousel page of the 6-food lunch",
    spec: { ...FOOD_DAY, slide: { role: "meal", meal: 1 } },
  },
  "dayfood-long": {
    note: "carousel page of a 10-food meal: the rows past the cap fold into one '+N more' row",
    spec: {
      ...FOOD_DAY,
      meals: [
        {
          ...FOOD_MEALS[1]!,
          stickers: [CUT, CUT, CUT, CUT],
          items: Array.from({ length: 10 }, (_, i) => ({ name: `Lauk ${i + 1}`, grams: 50 + i * 10, kcal: 90 + i * 12, protein: 4 + i, carbs: i % 3 === 0 ? null : 6, fat: 3 })),
        },
      ],
      slide: { role: "meal", meal: 0 },
    },
  },
  "dayfood-cover": {
    note: "carousel cover",
    spec: { ...FOOD_DAY, slide: { role: "cover" } },
  },
  "dayfood-total": {
    note: "carousel closing page",
    spec: { ...FOOD_DAY, slide: { role: "total" } },
  },
} satisfies Record<string, Fixture>;

export type FixtureId = keyof typeof FIXTURES;

/** The fixture each kind is shown with in the contact sheet and goldens. */
export const PRIMARY_FIXTURE: Record<string, FixtureId> = {
  day: "progress-full",
  meal: "meal-photo",
  streak: "progress-full",
  weight: "progress-full",
  week: "recap",
  period: "period-full",
  challenge: "challenge",
  workout: "workout",
  milestone: "progress-full",
  dayfood: "dayfood-full",
};

/** The fixture a template is shown with (contact sheet and goldens). */
export function fixtureFor(template: { id: string; kind: string }): FixtureId {
  if (template.id.startsWith("meal.cutout")) return "meal-cutout";
  if (template.id === "dayfood.meal.carousel") return "dayfood-meal";
  if (template.id === "dayfood.total.carousel") return "dayfood-total";
  if (template.id === "dayfood.cover.carousel") return "dayfood-cover";
  return PRIMARY_FIXTURE[template.kind] ?? "progress-full";
}
