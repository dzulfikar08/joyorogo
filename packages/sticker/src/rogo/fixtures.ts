import type { StorySpec } from "./data";

/**
 * Fixture data for goldens, the contact sheet and unit tests. `photo` names a file
 * under packages/sticker/fixtures (resolved by the harness, never by the app).
 */

export type Fixture = { spec: StorySpec; photo?: "meal.jpg" | "portrait.jpg"; note: string };

const DAY = new Date(2026, 9, 18, 12);

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
} satisfies Record<string, Fixture>;

export type FixtureId = keyof typeof FIXTURES;

/** The fixture each kind is shown with in the contact sheet and goldens. */
export const PRIMARY_FIXTURE: Record<string, FixtureId> = {
  day: "progress-full",
  meal: "meal-photo",
  streak: "progress-full",
  weight: "progress-full",
  week: "recap",
  challenge: "challenge",
  workout: "workout",
  milestone: "progress-full",
};

/** The fixture a template is shown with (contact sheet and goldens). */
export function fixtureFor(template: { id: string; kind: string }): FixtureId {
  if (template.id.startsWith("meal.cutout")) return "meal-cutout";
  return PRIMARY_FIXTURE[template.kind] ?? "progress-full";
}
