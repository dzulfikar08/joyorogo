// Founder guidance on the Makan diary: what to eat today given JoyoFit's
// readiness, what is already logged today, and the user's own food history.
// Server-only (it pulls the meal catalog and TKPI); clients import its types.
//
// Honest numbers: grams and kcal always come from the user's existing diary
// targets (day.summary: eatKcal, proteinTargetG, the diary's carb bar) minus
// what is logged, never from the watch. The only invented number is the carb
// boost on a hard day, and it is a stated share of the carb target. Without
// targets the guidance stays qualitative and suggests no foods.

import type { FitnessDay } from "./fitness-hint";
import { fmtDecimal, fmtInt, getActiveLocale, getT } from "@joyorogo/i18n";
import type { Locale } from "@joyorogo/i18n";
import { HARD_STRAIN, VERY_HARD_STRAIN, readinessFlags, readinessLabel } from "./fitness-hint";
import { foodKind } from "./food-kind";
import { mealIdeas } from "./ideas";
import { round5 } from "./engine";
import type { Meal } from "./engine";
import { plateKey } from "./plates";
import { TKPI_2019 } from "./tkpi2019-data";
import { effectiveTier, paywallEnabled } from "./tiers";
import type { PaywallConfig, Tier } from "./tiers";

/** Share of the carb target added on a hard day (strain >= 14), and on a very hard one (>= 18). */
export const CARB_BOOST_HARD = 0.1;
export const CARB_BOOST_VERY_HARD = 0.2;
/** Frequent foods are read from this many days back, and must have been logged on this many days. */
export const HISTORY_DAYS = 60;
export const MIN_HISTORY_DAYS = 2;
/** A food only counts as a protein / carb pick above these per-portion amounts. */
export const MIN_PICK_PROTEIN_G = 8;
export const MIN_PICK_CARBS_G = 15;
/** Matches mealIdeas: under this the honest answer is no food, not a snack. */
export const MIN_ROOM_KCAL = 80;
export const PICK_COUNT = 3;
/** A carb pick may overshoot the carbs still open by this much. */
const CARB_OVERSHOOT_G = 15;

export const GUIDANCE_FOCUSES = ["fuel", "recover", "fuel_recover", "steady"] as const;
export type GuidanceFocus = (typeof GUIDANCE_FOCUSES)[number];

/** Foods the user logged, grouped by name over the history window. */
export type HistoryFood = {
  name: string;
  /** distinct days it was logged */
  days: number;
  /** average per logged portion; macros are null when no entry carried them */
  kcal: number;
  proteinG: number | null;
  carbsG: number | null;
  /** meal slots it was logged in */
  meals: string[];
};

export type GuidanceTargets = { eatKcal: number; proteinG: number; carbsG: number };

export type GuidanceInput = {
  day: FitnessDay;
  /** null when the user has no profile yet */
  targets: GuidanceTargets | null;
  eaten: { kcal: number; proteinG: number; carbsG: number; names: string[] };
  history: HistoryFood[];
  /** the meal slot that is next (suggestMealNow) */
  slot: Meal;
};

export type FoodPick = {
  name: string;
  role: "protein" | "karbo";
  kcal: number;
  proteinG: number | null;
  carbsG: number | null;
  /** riwayat = the user's own logs; database = JoyoRogo's meal catalog / TKPI 2019 */
  source: "riwayat" | "database";
  /** distinct days logged (riwayat only) */
  days: number | null;
  /** fixed portion of a database staple, e.g. "100 g" */
  portion: string | null;
};

export type GuidanceNumbers = {
  eatKcal: number;
  eatenKcal: number;
  /** kcal still open today, including the kcal of the carb boost; never below 0 */
  roomKcal: number;
  protein: { targetG: number; eatenG: number; remainingG: number };
  carbs: {
    targetG: number;
    boostG: number;
    goalG: number;
    eatenG: number;
    remainingG: number;
  };
};

export type ReadinessGuidance = {
  focus: GuidanceFocus;
  headline: string;
  lines: string[];
  /** how the numbers were derived; null when the guidance is qualitative */
  basis: string | null;
  numbers: GuidanceNumbers | null;
  foods: FoodPick[];
};

/** Founder only, or everyone on a server without a paywall (nothing to sell there). */
export function premiumUnlocked(
  row: { tier: Tier; founderUntil: Date | null } | undefined,
  config: PaywallConfig,
  now = new Date(),
): boolean {
  return effectiveTier(row, now) === "founder" || !paywallEnabled(config);
}

function focusOf(day: FitnessDay): GuidanceFocus {
  const { hardDay, needsRest } = readinessFlags(day);
  if (hardDay && needsRest) return "fuel_recover";
  if (hardDay) return "fuel";
  if (needsRest) return "recover";
  return "steady";
}

/** What stands out, in the day's own numbers ("Pemulihan 28%, tidur 70% dari kebutuhan"). */
function restReasons(day: FitnessDay, locale: Locale): string {
  const t = getT(locale, "makan");
  const { lowRecovery, shortSleep, strained } = readinessFlags(day);
  const reasons: string[] = [];
  if (lowRecovery) reasons.push(t("guidance.reason.recovery", { pct: day.recoveryPct }));
  if (shortSleep) reasons.push(t("guidance.reason.sleep", { pct: day.sleepPct }));
  if (strained && day.readiness) {
    reasons.push(
      t("guidance.reason.condition", {
        state: readinessLabel(day.readiness, locale).toLowerCase(),
      }),
    );
  }
  const text = reasons.join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function carbBoostShare(day: FitnessDay): number {
  const { hardDay, veryHardDay } = readinessFlags(day);
  if (!hardDay) return 0;
  return veryHardDay ? CARB_BOOST_VERY_HARD : CARB_BOOST_HARD;
}

export function guidanceNumbers(
  day: FitnessDay,
  targets: GuidanceTargets,
  eaten: GuidanceInput["eaten"],
): GuidanceNumbers {
  const boostG = round5(targets.carbsG * carbBoostShare(day));
  const goalG = targets.carbsG + boostG;
  return {
    eatKcal: targets.eatKcal,
    eatenKcal: Math.round(eaten.kcal),
    roomKcal: Math.max(0, Math.round(targets.eatKcal + boostG * 4 - eaten.kcal)),
    protein: {
      targetG: targets.proteinG,
      eatenG: Math.round(eaten.proteinG),
      remainingG: Math.max(0, Math.round(targets.proteinG - eaten.proteinG)),
    },
    carbs: {
      targetG: targets.carbsG,
      boostG,
      goalG,
      eatenG: Math.round(eaten.carbsG),
      remainingG: Math.max(0, Math.round(goalG - eaten.carbsG)),
    },
  };
}

// Staples for a carb pick when the user's history has none. Per-100 g values
// come straight from the official TKPI 2019 table, at a fixed portion.
const CARB_STAPLES: ReadonlyArray<{ code: string; grams: number }> = [
  { code: "AP001", grams: 100 },
  { code: "AP005", grams: 100 },
  { code: "BP011", grams: 150 },
  { code: "AP012", grams: 100 },
];

function stapleCandidates(): FoodPick[] {
  const picks: FoodPick[] = [];
  for (const { code, grams } of CARB_STAPLES) {
    const row = TKPI_2019.find((r) => r[0] === code);
    if (!row || row[3] === null || row[6] === null) continue;
    const k = grams / 100;
    picks.push({
      name: row[1],
      role: "karbo",
      kcal: Math.round(row[3] * k),
      proteinG: row[4] === null ? null : Math.round(row[4] * k),
      carbsG: Math.round(row[6] * k),
      source: "database",
      days: null,
      portion: `${grams} g`,
    });
  }
  return picks;
}

type Role = FoodPick["role"];

function roleFit(food: { kcal: number; proteinG: number | null; carbsG: number | null }, role: Role, n: GuidanceNumbers): boolean {
  if (food.kcal > n.roomKcal) return false;
  if (role === "protein") return food.proteinG !== null && food.proteinG >= MIN_PICK_PROTEIN_G;
  return (
    food.carbsG !== null &&
    food.carbsG >= MIN_PICK_CARBS_G &&
    food.carbsG <= n.carbs.remainingG + CARB_OVERSHOOT_G
  );
}

function pickRole(
  role: Role,
  count: number,
  input: GuidanceInput,
  n: GuidanceNumbers,
  taken: Set<string>,
  locale: Locale,
): FoodPick[] {
  const picks: FoodPick[] = [];
  const take = (pick: FoodPick) => {
    const key = plateKey(pick.name);
    if (picks.length >= count || taken.has(key)) return;
    taken.add(key);
    picks.push(pick);
  };

  const fromHistory = input.history
    .filter((food) => {
      const kind = foodKind(food.name);
      return (
        food.days >= MIN_HISTORY_DAYS &&
        (kind === "makanan" || kind === "camilan") &&
        roleFit(food, role, n)
      );
    })
    .map((food) => ({ food, slotMatch: food.meals.includes(input.slot) }))
    .toSorted((a, b) => {
      if (a.slotMatch !== b.slotMatch) return a.slotMatch ? -1 : 1;
      if (role === "protein") {
        const density = (f: HistoryFood) => (f.proteinG ?? 0) / Math.max(f.kcal, 1);
        const d = density(b.food) - density(a.food);
        if (d !== 0) return d;
      }
      return b.food.days - a.food.days || a.food.name.localeCompare(b.food.name);
    });
  for (const { food } of fromHistory) {
    take({
      name: food.name,
      role,
      kcal: Math.round(food.kcal),
      proteinG: food.proteinG === null ? null : Math.round(food.proteinG),
      carbsG: food.carbsG === null ? null : Math.round(food.carbsG),
      source: "riwayat",
      days: food.days,
      portion: null,
    });
  }

  // History is thin: top up from the app's own food database.
  if (picks.length < count) {
    const database: FoodPick[] =
      role === "protein"
        ? mealIdeas(n.roomKcal, input.slot, 6, undefined, locale)
            .filter((idea) => idea.proteinG >= MIN_PICK_PROTEIN_G)
            .map((idea) => ({
              name: idea.name,
              role,
              kcal: idea.kcal,
              proteinG: idea.proteinG,
              carbsG: null,
              source: "database" as const,
              days: null,
              portion: null,
            }))
        : stapleCandidates().filter((pick) => roleFit(pick, role, n));
    for (const pick of database) take(pick);
  }
  return picks;
}

const FOCUS_ROLES: Record<GuidanceFocus, Role[]> = {
  fuel: ["karbo", "karbo", "karbo"],
  recover: ["protein", "protein", "protein"],
  fuel_recover: ["protein", "protein", "karbo"],
  steady: [],
};

function pickFoods(
  input: GuidanceInput,
  n: GuidanceNumbers,
  focus: GuidanceFocus,
  locale: Locale,
): FoodPick[] {
  if (n.roomKcal < MIN_ROOM_KCAL) return [];
  const taken = new Set(input.eaten.names.map((name) => plateKey(name)));
  const wanted = FOCUS_ROLES[focus].filter(
    (role) => (role === "protein" ? n.protein.remainingG >= MIN_PICK_PROTEIN_G : n.carbs.remainingG >= MIN_PICK_CARBS_G),
  );
  const foods: FoodPick[] = [];
  for (const role of new Set(wanted)) {
    foods.push(...pickRole(role, wanted.filter((r) => r === role).length, input, n, taken, locale));
  }
  return foods;
}

function basisText(
  input: GuidanceInput & { targets: GuidanceTargets },
  n: GuidanceNumbers,
  locale: Locale,
): string {
  const { targets, day } = input;
  const t = getT(locale, "makan");
  const base = t("guidance.basis.base", {
    kcal: fmtInt(targets.eatKcal, locale),
    protein: fmtInt(targets.proteinG, locale),
    carbs: fmtInt(targets.carbsG, locale),
  });
  if (n.carbs.boostG === 0) return base;
  const pct = Math.round(carbBoostShare(day) * 100);
  const from = pct === CARB_BOOST_VERY_HARD * 100 ? VERY_HARD_STRAIN : HARD_STRAIN;
  return `${base} ${t("guidance.basis.boost", { pct, from })}`;
}

/**
 * The whole guidance for today; pure, so thresholds, scaling and picks are testable.
 * Text follows `locale`: the server passes the request's language, clients the active one.
 */
export function buildGuidance(
  input: GuidanceInput,
  locale: Locale = getActiveLocale(),
): ReadinessGuidance {
  const { day, targets } = input;
  const t = getT(locale, "makan");
  const fmt = (n: number) => fmtInt(n, locale);
  const focus = focusOf(day);
  const headline = t(`guidance.headline.${focus}`);
  const flags = readinessFlags(day);
  const strain = day.strain === null ? "" : fmtDecimal(day.strain, 1, locale);

  if (focus === "steady" && !targets) {
    return {
      focus,
      headline,
      lines: [t("guidance.noAdjust")],
      basis: null,
      numbers: null,
      foods: [],
    };
  }

  if (!targets) {
    const lines: string[] = [];
    if (flags.hardDay) lines.push(t("guidance.noTarget.hard", { strain }));
    if (flags.needsRest) {
      lines.push(t("guidance.noTarget.rest", { reasons: restReasons(day, locale) }));
    }
    lines.push(t("guidance.noTarget.profile"));
    return { focus, headline, lines, basis: null, numbers: null, foods: [] };
  }

  const numbers = guidanceNumbers(day, targets, input.eaten);
  const lines: string[] = [];

  if (focus === "steady") lines.push(t("guidance.noAdjust"));

  if (flags.needsRest) {
    lines.push(t("guidance.rest.main", { reasons: restReasons(day, locale) }));
    lines.push(
      numbers.protein.remainingG > 0
        ? t("guidance.rest.protein", {
            eaten: fmt(numbers.protein.eatenG),
            target: fmt(numbers.protein.targetG),
            left: fmt(numbers.protein.remainingG),
          })
        : t("guidance.rest.proteinDone"),
    );
  }

  if (flags.hardDay) {
    const carbs = {
      strain,
      goal: fmt(numbers.carbs.goalG),
      target: fmt(numbers.carbs.targetG),
      boost: fmt(numbers.carbs.boostG),
      eaten: fmt(numbers.carbs.eatenG),
      left: fmt(numbers.carbs.remainingG),
    };
    lines.push(
      numbers.carbs.remainingG > 0
        ? t("guidance.hard.carbsLeft", carbs)
        : t("guidance.hard.carbsDone", carbs),
    );
  }

  if (focus !== "steady") {
    lines.push(
      numbers.roomKcal < MIN_ROOM_KCAL
        ? t("guidance.room.full")
        : numbers.carbs.boostG > 0
          ? t("guidance.room.withBoost", {
              room: fmt(numbers.roomKcal),
              boost: fmt(numbers.carbs.boostG * 4),
            })
          : t("guidance.room.plain", { room: fmt(numbers.roomKcal) }),
    );
  }

  return {
    focus,
    headline,
    lines,
    basis: basisText({ ...input, targets }, numbers, locale),
    numbers,
    foods: pickFoods(input, numbers, focus, locale),
  };
}
