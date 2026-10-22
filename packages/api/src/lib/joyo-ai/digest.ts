// Ported from JoyoFit (watch-fit) src/features/ai/digest.ts, adapted for JoyoRogo.
/**
 * The data digest (`joyorogo.digest` v1): what is sent to the engine with every question, built from the same numbers the
 * diary shows. Units are in the key names. Missing is `null`, never 0. Nothing identifying: no name, email, photos, scan or
 * photo ids, places or device ids; the birth year becomes an age; free text (food names) is flattened and capped.
 *
 * NOT in it, on purpose: menstrual-cycle data, pregnancy / breastfeeding mode and maternal targets (no AI path reads either),
 * Strava, GPS. `digest.test.ts` builds a digest from a source that carries those fields and checks they cannot appear.
 * Every key below is listed in `DIGEST_FIELDS`, and `digest.test.ts` ties that list to `CONSENT_VERSION` through the hash.
 */

import type { Locale } from "@joyorogo/i18n";

import { shiftDate } from "../engine";
import type { Person } from "./person";
import type { DayData, ProfileData, RangeDay, ToolData, WeighIn } from "./tool-data";
import type { Nutrient } from "./foods";

export const DIGEST_VERSION = 1;
/** About 1,700 tokens; sections are trimmed to stay under it. */
export const DIGEST_MAX_CHARS = 6_000;
export const DIGEST_DAYS = 7;
export const DIGEST_ITEMS = 40;

/** Every field the digest can carry (dot paths, `[]` for a list). Changing this list needs a new `CONSENT_VERSION`. */
export const DIGEST_FIELDS = [
  "v",
  "now",
  "locale",
  "units.energy",
  "units.weight",
  "units.water",
  "person.ageYears",
  "person.sex",
  "person.heightCm",
  "person.goal",
  "targets.eatKcal",
  "targets.proteinG",
  "targets.carbsG",
  "targets.fatG",
  "targets.fiberG",
  "targets.tdeeKcal",
  "targets.targetWeightKg",
  "targets.targetDate",
  "today.date",
  "today.eaten.kcal",
  "today.eaten.proteinG",
  "today.eaten.carbsG",
  "today.eaten.fatG",
  "today.eaten.fiberG",
  "today.partial[]",
  "today.remaining.kcal",
  "today.remaining.proteinG",
  "today.remaining.carbsG",
  "today.remaining.fatG",
  "today.remaining.fiberG",
  "today.items[].meal",
  "today.items[].name",
  "today.items[].grams",
  "today.items[].kcal",
  "today.water.glasses",
  "today.water.goal",
  "today.fasting.pattern",
  "today.fasting.state",
  "today.fasting.windowOpen",
  "today.fasting.windowClose",
  "days[].d",
  "days[].kcal",
  "days[].proteinG",
  "days[].fiberG",
  "days[].water",
  "weight.latestKg",
  "weight.change14dKg",
  "coverage.loggedDays",
  "coverage.days",
  "coverage.weighIns",
] as const;

/** A stable hash of the field list, pinned per consent version in the tests. */
export function fieldsHash(fields: readonly string[] = DIGEST_FIELDS): string {
  let h = 2166136261;
  for (const ch of fields.join("|")) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** Frozen per consent version: never edit an old entry; a changed field list needs a new version and a new entry. */
export const CONSENT_FIELDS_HASH: Record<number, string> = { 1: "f4b22e82" };

export interface Digest {
  v: typeof DIGEST_VERSION;
  now: string;
  locale: Locale;
  units: { energy: "kcal" | "kkal"; weight: "kg"; water: "glass" };
  person: { ageYears: number | null; sex: "male" | "female" | null; heightCm: number | null; goal: string | null };
  targets: {
    eatKcal: number | null;
    proteinG: number | null;
    carbsG: number | null;
    fatG: number | null;
    fiberG: number | null;
    tdeeKcal: number | null;
    targetWeightKg: number | null;
    targetDate: string | null;
  } | null;
  today: {
    date: string;
    eaten: { kcal: number; proteinG: number | null; carbsG: number | null; fatG: number | null; fiberG: number | null };
    /** Macros some logged rows lack: their eaten figure is a lower bound. */
    partial: Nutrient[];
    remaining: { kcal: number | null; proteinG: number | null; carbsG: number | null; fatG: number | null; fiberG: number | null } | null;
    items: { meal: string; name: string; grams: number | null; kcal: number }[];
    water: { glasses: number; goal: number } | null;
    fasting: { pattern: string; state: string | null; windowOpen: string | null; windowClose: string | null } | null;
  } | null;
  days: { d: string; kcal: number | null; proteinG: number | null; fiberG: number | null; water: number | null }[];
  weight: { latestKg: number | null; change14dKg: number | null } | null;
  coverage: { loggedDays: number; days: number; weighIns: number };
}

/**
 * What the loader gathers. The builder copies named fields out of it and nothing else, so an extra property (a cycle phase
 * added to a data source by mistake) is dropped here instead of reaching the engine.
 */
export interface DigestSource {
  now: string;
  locale: Locale;
  person: Person;
  profile: ProfileData | null;
  day: DayData | null;
  days: readonly RangeDay[];
  weights: readonly WeighIn[];
}

/** Strips control characters and line breaks so a short string from data cannot add its own "instruction" lines. */
export function flat(text: string, max: number): string {
  return text.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

const num = (value: number | null | undefined, digits = 0): number | null => {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const f = 10 ** digits;
  return Math.round(value * f) / f;
};

// The profile's goal is already withheld for a maternal plan, so it wins over the caller's when the profile was read.
const goalOf = (goal: string | null): string | null => (goal === "lose" || goal === "maintain" || goal === "gain" ? goal : null);

const MACROS = ["protein", "carbs", "fat", "fiber"] as const;

/** Builds the digest from the gathered source, whitelisting every field and keeping it under {@link DIGEST_MAX_CHARS}. */
export function buildDigest(src: DigestSource): Digest {
  const p = src.person;
  const profile = src.profile;
  const day = src.day;
  const t = day?.targets ?? null;
  const days = src.days.slice(-DIGEST_DAYS);
  const weights = src.weights;
  const latest = weights.at(-1) ?? null;
  const first = weights[0] ?? null;

  const full: Digest = {
    v: DIGEST_VERSION,
    now: flat(src.now, 10),
    locale: src.locale,
    units: { energy: src.locale === "id" ? "kkal" : "kcal", weight: "kg", water: "glass" },
    person: {
      ageYears: num(p.ageYears),
      sex: p.sex === "male" || p.sex === "female" ? p.sex : null,
      heightCm: num(p.heightCm, 1),
      goal: goalOf(profile ? profile.goal : p.goal),
    },
    targets:
      t || profile
        ? {
            eatKcal: num(t?.kcal),
            proteinG: num(t?.protein),
            carbsG: num(t?.carbs),
            fatG: num(t?.fat),
            fiberG: num(t?.fiber),
            tdeeKcal: num(profile?.tdeeKcal),
            targetWeightKg: num(profile?.targetWeightKg, 1),
            targetDate: profile?.targetDate ? flat(profile.targetDate, 10) : null,
          }
        : null,
    today: day
      ? {
          date: flat(day.date, 10),
          eaten: {
            kcal: num(day.totals.kcal) ?? 0,
            proteinG: num(day.totals.protein.g, 1),
            carbsG: num(day.totals.carbs.g, 1),
            fatG: num(day.totals.fat.g, 1),
            fiberG: num(day.totals.fiber.g, 1),
          },
          partial: MACROS.filter((m) => day.totals[m].missingRows > 0 && day.totals[m].g !== null),
          remaining: day.remaining
            ? {
                kcal: num(day.remaining.kcal),
                proteinG: num(day.remaining.protein, 1),
                carbsG: num(day.remaining.carbs, 1),
                fatG: num(day.remaining.fat, 1),
                fiberG: num(day.remaining.fiber, 1),
              }
            : null,
          items: day.items.slice(0, DIGEST_ITEMS).map((i) => ({
            meal: flat(i.meal, 20),
            name: flat(i.name, 60),
            grams: num(i.grams),
            kcal: num(i.kcal) ?? 0,
          })),
          water: day.water ? { glasses: num(day.water.glasses) ?? 0, goal: num(day.water.goal) ?? 0 } : null,
          fasting: day.fasting
            ? {
                pattern: flat(day.fasting.pattern, 8),
                state: day.fasting.state === null ? null : flat(day.fasting.state, 16),
                windowOpen: day.fasting.windowOpen === null ? null : flat(day.fasting.windowOpen, 5),
                windowClose: day.fasting.windowClose === null ? null : flat(day.fasting.windowClose, 5),
              }
            : null,
        }
      : null,
    days: days.map((d) => ({
      d: flat(d.date, 10),
      kcal: num(d.kcal),
      proteinG: num(d.protein, 1),
      fiberG: num(d.fiber, 1),
      water: num(d.water),
    })),
    weight: latest
      ? {
          latestKg: num(latest.kg, 1),
          change14dKg: first && first !== latest ? num(latest.kg - first.kg, 1) : null,
        }
      : null,
    coverage: {
      loggedDays: days.filter((d) => d.logged).length,
      days: days.length,
      weighIns: weights.length,
    },
  };
  return fitToBudget(full);
}

export const digestJson = (digest: Digest): string => JSON.stringify(digest);

/**
 * Trims what matters least until the JSON fits under {@link DIGEST_MAX_CHARS}. Drop order: the days list 7 -> 3, today's item
 * list 12 -> 5 -> none, then the optional blocks (fasting, the days list, the goal weight and date). Targets, today's totals and
 * remaining, weight and coverage always stay.
 */
export function fitToBudget(digest: Digest, maxChars: number = DIGEST_MAX_CHARS): Digest {
  const withToday = (d: Digest, change: (t: NonNullable<Digest["today"]>) => NonNullable<Digest["today"]>): Digest =>
    d.today ? { ...d, today: change(d.today) } : d;
  const steps: ((d: Digest) => Digest)[] = [
    (d) => ({ ...d, days: d.days.slice(-3) }),
    (d) => withToday(d, (t) => ({ ...t, items: t.items.slice(0, 12) })),
    (d) => withToday(d, (t) => ({ ...t, items: t.items.slice(0, 5) })),
    (d) => withToday(d, (t) => ({ ...t, items: [] })),
    (d) => withToday(d, (t) => ({ ...t, fasting: null })),
    (d) => ({ ...d, days: [] }),
    (d) => (d.targets ? { ...d, targets: { ...d.targets, targetWeightKg: null, targetDate: null } } : d),
  ];
  let current = digest;
  for (const step of steps) {
    if (digestJson(current).length <= maxChars) break;
    current = step(current);
  }
  return current;
}

/**
 * Gathers the digest source from the shared data seam, fresh per question. A part that cannot be read stays null (the digest then
 * carries null, never a guess); `person` comes from the caller (who knows the age gate).
 */
export async function gatherDigestSource(data: ToolData, person: Person, locale: Locale): Promise<DigestSource> {
  const today = data.today();
  const [day, range, weights, profile] = await Promise.all([
    data.day(today).catch(() => null),
    data.range(shiftDate(today, -(DIGEST_DAYS - 1)), today).catch(() => null),
    data.weights(shiftDate(today, -14)).catch(() => null),
    data.profile().catch(() => null),
  ]);
  return { now: today, locale, person, profile, day, days: range?.days ?? [], weights: weights?.entries ?? [] };
}
