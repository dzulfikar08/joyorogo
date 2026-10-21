// The numbers a comment attachment card shows, in display order, shared by web and native so the two cards never
// disagree. Pure: a client maps `key` to its translation (`comments.fact.<key>`) and interpolates `params`.
// Contract of the stats: lib/comment-attachment.ts.

import type { Locale } from "@joyorogo/i18n";

export type AttachmentFactKey =
  | "duration"
  | "distance"
  | "kcal"
  | "heartRate"
  | "protein"
  | "carbs"
  | "fat"
  | "items"
  | "weight"
  | "delta"
  | "avgKcal"
  | "onTarget"
  | "streak"
  | "exercise"
  | "weightChange";

export type AttachmentFact = { key: AttachmentFactKey; params: Record<string, string | number> };

type Stats = Record<string, number | string | null | undefined>;

const TAGS: Record<Locale, string> = { id: "id-ID", en: "en-US", ms: "ms-MY" };
const tag = (locale: Locale) => TAGS[locale];

function num(stats: Stats, key: string): number | null {
  const value = stats[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function attachmentFacts(kind: string, stats: Stats, locale: Locale): AttachmentFact[] {
  const fmt = (value: number, digits = 0) =>
    new Intl.NumberFormat(tag(locale), { maximumFractionDigits: digits }).format(value);
  const signed = (value: number) => `${value > 0 ? "+" : value < 0 ? "-" : ""}${fmt(Math.abs(value), 1)}`;
  const facts: AttachmentFact[] = [];
  const push = (key: AttachmentFactKey, params: Record<string, string | number>) => facts.push({ key, params });
  const ifNum = (key: string, then: (value: number) => void) => {
    const value = num(stats, key);
    if (value !== null) then(value);
  };

  if (kind === "workout" || kind === "route") {
    ifNum("distanceM", (m) => m > 0 && push("distance", { value: fmt(m / 1000, 2) }));
    ifNum("durationMin", (min) => min > 0 && push("duration", { value: fmt(min) }));
    ifNum("kcal", (kcal) => kcal > 0 && push("kcal", { value: fmt(kcal) }));
    ifNum("avgHr", (bpm) => bpm > 0 && push("heartRate", { value: fmt(bpm) }));
  } else if (kind === "food") {
    ifNum("kcal", (kcal) => push("kcal", { value: fmt(kcal) }));
    ifNum("protein", (g) => push("protein", { value: fmt(g) }));
    ifNum("carbs", (g) => push("carbs", { value: fmt(g) }));
    ifNum("fat", (g) => push("fat", { value: fmt(g) }));
    ifNum("items", (n) => n > 1 && push("items", { count: n }));
  } else if (kind === "weight") {
    ifNum("weightKg", (kg) => push("weight", { value: fmt(kg, 1) }));
    ifNum("deltaKg", (kg) => push("delta", { value: signed(kg) }));
  } else if (kind === "recap") {
    ifNum("avgKcal", (kcal) => push("avgKcal", { value: fmt(kcal), target: fmt(num(stats, "targetKcal") ?? 0) }));
    ifNum("daysOnTarget", (days) => push("onTarget", { days: String(days), total: String(num(stats, "loggedDays") ?? days) }));
    ifNum("streakDays", (days) => days > 1 && push("streak", { count: days }));
    ifNum("exerciseMin", (min) => min > 0 && push("exercise", { value: fmt(min) }));
    ifNum("weightChangeKg", (kg) => push("weightChange", { value: signed(kg) }));
  }
  return facts;
}
