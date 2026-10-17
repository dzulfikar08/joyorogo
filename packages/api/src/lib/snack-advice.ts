// Pure "mau makan ini?" advisor: given what is already eaten today, the eat
// target and the meals still ahead, says whether a candidate item fits before
// it is saved. Guidance only: it never blocks saving, makes no medical claims
// and never shames. All clock math is WIB minutes since midnight so server,
// web and native agree (see fasting.ts).

import { getActiveLocale, getT } from "@joyorogo/i18n";
import type { Locale, TFunction } from "@joyorogo/i18n";

import { localizedLabels, mealLabel, ramadanSplit } from "./engine";
import type { Meal } from "./engine";
import {
  buildSchedule,
  fmtHHMM,
  insideWindow,
  minutesUntil,
  windowHoursFor,
  windowTimes,
} from "./fasting";
import type { FastingDay } from "./fasting";
import type { FoodKind } from "./food-kind";
import { mealIdeas } from "./ideas";

export type AdviceVerdict = "aman" | "hati-hati" | "lewat";

export const VERDICT_LABELS: Record<AdviceVerdict, string> = localizedLabels(
  ["aman", "hati-hati", "lewat"] as const satisfies readonly AdviceVerdict[],
  (verdict, locale) => getT(locale, "makan")(`snackAdvice.verdict.${verdict}`),
);

/** Share of the eat target per meal on a normal (non-Ramadan) day. */
export const NORMAL_SPLIT: Record<Meal, number> = {
  sarapan: 0.25,
  makan_siang: 0.35,
  makan_malam: 0.3,
  snack: 0.1,
  sahur: 0,
  berbuka: 0,
};

/** The plan's per-slot split of the eat target for the day's mode. */
export function mealSplit(ramadan: boolean): Record<Meal, number> {
  return ramadan ? ramadanSplit() : NORMAL_SPLIT;
}

/**
 * Main meals that can still be ahead. `endMin` is the moment the slot counts
 * as skipped (matches suggestMealNow's windows). Snack slots are never
 * reserved: they are the room the advisor is measuring.
 */
const MAIN_SLOTS: Record<"normal" | "ramadan", Array<{ meal: Meal; endMin: number }>> = {
  normal: [
    { meal: "sarapan", endMin: 10 * 60 + 30 },
    { meal: "makan_siang", endMin: 15 * 60 },
    { meal: "makan_malam", endMin: 21 * 60 + 30 },
  ],
  ramadan: [
    { meal: "sahur", endMin: 5 * 60 },
    { meal: "berbuka", endMin: 21 * 60 + 30 },
  ],
};

/** A meal candidate this many minutes before a planned IF meal still counts as that meal. */
const IF_MEAL_LEAD_MIN = 45;

export type SnackAdviceInput = {
  /** Item name for the sentence; the kind label stands in when missing. */
  name?: string;
  /** Candidate kcal (the whole scan / portion about to be saved). */
  kcal: number;
  kind: FoodKind;
  /** Slot the candidate is being logged to. */
  slot: Meal;
  /** Today's eaten kcal and the day's eat target. */
  eatenKcal: number;
  eatKcal: number;
  /** Today's tdee, when known: tells "defisit menipis" from "surplus". */
  tdeeKcal?: number | null;
  /** Kcal already logged per slot today. */
  eatenByMeal: Partial<Record<Meal, number>>;
  /** Current WIB time, minutes since midnight. */
  nowMin: number;
  ramadan: boolean;
  /** Overrides the default split of the day's mode. */
  split?: Partial<Record<Meal, number>>;
  /** IF state from fasting.today; ignored on Ramadan and when not active. */
  fasting?: Pick<FastingDay, "active" | "pattern" | "windowOpen"> | null;
};

export type UpcomingMeal = { label: string; needKcal: number };

export type AdviceSuggestion =
  | { type: "half"; label: string; kcal: number; verdict: AdviceVerdict }
  | { type: "swap"; label: string; text: string }
  | { type: "lighter-next"; label: string; targetKcal: number };

export type SnackAdvice = {
  verdict: AdviceVerdict;
  title: string;
  reason: string;
  numbers: {
    kcal: number;
    eatenKcal: number;
    eatKcal: number;
    /** Budget left before the candidate (never negative). */
    remainingKcal: number;
    /** Budget left after the candidate; negative = over target. */
    afterKcal: number;
    /** What the upcoming meals usually need. */
    reserveKcal: number;
    /** Room for this item without touching upcoming meals; may be negative. */
    spareKcal: number;
    overKcal: number;
  };
  upcoming: UpcomingMeal[];
  /** True when IF is active and the window is closed (or not yet open). */
  outsideWindow: boolean;
  suggestions: AdviceSuggestion[];
};

/** Meal-first rule for a multi-item scan: any makanan, else any camilan, else the first kind. */
export function dominantKind(kinds: FoodKind[]): FoodKind {
  if (kinds.includes("makanan")) return "makanan";
  if (kinds.includes("camilan")) return "camilan";
  return kinds[0] ?? "makanan";
}

type MakanT = TFunction<"makan">;

const kcalText = (n: number, t: MakanT) => t("snackAdvice.kcal", { n: Math.round(n) });

function joinLabels(labels: string[], t: MakanT): string {
  if (labels.length <= 1) return labels[0] ?? "";
  return t("snackAdvice.joinLast", { list: labels.slice(0, -1).join(", "), last: labels.at(-1) });
}

/** What each upcoming meal still needs, honouring Ramadan, IF and what is logged. */
function upcomingMeals(
  input: SnackAdviceInput,
  locale: Locale,
): {
  meals: UpcomingMeal[];
  outsideWindow: boolean;
  window: string | null;
} {
  const isMeal = input.kind === "makanan";
  const fasting = input.fasting;
  if (!input.ramadan && fasting?.active && fasting.pattern && fasting.windowOpen) {
    const window = windowTimes(fasting.windowOpen, windowHoursFor(fasting.pattern));
    const inside = insideWindow(input.nowMin, window);
    // Outside the window: closer to the next opening than to the last close
    // means the day's meals are still ahead, otherwise they are behind us.
    const sinceClose = (input.nowMin - (window.endMin % 1440) + 1440) % 1440;
    const closed = !inside && sinceClose <= minutesUntil(window.startMin, input.nowMin);
    const rel = inside ? (input.nowMin - window.startMin + 1440) % 1440 : -1;
    const meals = closed
      ? []
      : buildSchedule(fasting.pattern, fasting.windowOpen)
          // a snack or drink uses the camilan share, so that one is not reserved
          .filter((m) => m.kind !== "camilan" || isMeal)
          .filter((m) => m.atMin - window.startMin > rel + (isMeal ? IF_MEAL_LEAD_MIN : 0))
          .map((m) => ({
            label: getT(locale, "push")(`fasting.mealKind.${m.kind}`).toLowerCase(),
            needKcal: Math.round(m.share * input.eatKcal),
          }));
    return {
      meals,
      outsideWindow: !inside,
      window: `${fasting.windowOpen}-${fmtHHMM(window.endMin)}`,
    };
  }

  const split = { ...mealSplit(input.ramadan), ...input.split };
  const meals = MAIN_SLOTS[input.ramadan ? "ramadan" : "normal"]
    // a meal candidate is its own slot's meal; a snack sits on top of all of them
    .filter(({ meal, endMin }) => input.nowMin < endMin && !(isMeal && meal === input.slot))
    .map(({ meal }) => ({
      label: mealLabel(meal, locale).toLowerCase(),
      needKcal: Math.max(
        0,
        Math.round((split[meal] ?? 0) * input.eatKcal - (input.eatenByMeal[meal] ?? 0)),
      ),
    }))
    .filter((m) => m.needKcal > 0);
  return { meals, outsideWindow: false, window: null };
}

function verdictFor(kcal: number, remaining: number, spare: number): AdviceVerdict {
  if (kcal > remaining) return "lewat";
  return kcal <= spare ? "aman" : "hati-hati";
}

const GENERIC_SWAP_KINDS = ["makanan", "camilan", "minuman"] as const;

function swapSuggestion(
  kind: FoodKind,
  kcal: number,
  room: number,
  t: MakanT,
  locale: Locale,
): AdviceSuggestion | null {
  const label = t("snackAdvice.swap.label");
  if (kind === "camilan") {
    // Catalog values are TKPI 2019 rounded (ideas.ts); only a lighter idea that
    // fits the room left is worth naming, otherwise the generic wording stands.
    const idea = mealIdeas(room, "snack", 6, undefined, locale).find((i) => i.kcal < kcal);
    if (idea) {
      return {
        type: "swap",
        label,
        text: t("snackAdvice.swap.idea", {
          name: idea.name.toLowerCase(),
          kcal: kcalText(idea.kcal, t),
        }),
      };
    }
  }
  const generic = GENERIC_SWAP_KINDS.find((k) => k === kind);
  return generic ? { type: "swap", label, text: t(`snackAdvice.swap.generic.${generic}`) } : null;
}

/**
 * Verdict for one candidate item.
 * - aman: fits without touching what upcoming meals usually need.
 * - hati-hati: fits the day, but only by eating into an upcoming meal's share.
 * - lewat: would push the day over the eat target (no deficit left, or a surplus).
 * An IF window that is closed or not yet open lifts `aman` to `hati-hati` and says so.
 * Returns null when there is nothing to compare against (no target, no kcal).
 */
export function adviseSnack(
  input: SnackAdviceInput,
  locale: Locale = getActiveLocale(),
): SnackAdvice | null {
  const { kcal, eatenKcal, eatKcal } = input;
  if (!(eatKcal > 0) || !(kcal > 0)) return null;

  const t = getT(locale, "makan");
  const { meals, outsideWindow, window } = upcomingMeals(input, locale);
  const reserve = meals.reduce((sum, m) => sum + m.needKcal, 0);
  const remaining = Math.max(0, Math.round(eatKcal - eatenKcal));
  const spare = remaining - reserve;
  const after = Math.round(eatKcal - eatenKcal - kcal);
  const over = Math.max(0, -after);

  let verdict = verdictFor(kcal, remaining, spare);
  if (outsideWindow && verdict === "aman") verdict = "hati-hati";

  const upcomingLabel = joinLabels(
    meals.map((m) => m.label),
    t,
  );
  const parts = [
    t("snackAdvice.reason.head", {
      name: input.name?.trim() || t(`kind.${input.kind}`),
      kcal: kcalText(kcal, t),
    }),
  ];
  if (outsideWindow && window) {
    parts.push(t("snackAdvice.reason.windowClosed", { window }));
  }

  if (verdict === "lewat") {
    if (remaining === 0) {
      parts.push(
        t("snackAdvice.reason.overNoRoom", {
          eaten: kcalText(eatenKcal, t),
          target: kcalText(eatKcal, t),
          kcal: kcalText(kcal, t),
        }),
      );
    } else {
      parts.push(
        t("snackAdvice.reason.overSome", {
          remaining: kcalText(remaining, t),
          total: kcalText(eatenKcal + kcal, t),
          target: kcalText(eatKcal, t),
          over: kcalText(over, t),
        }),
      );
    }
    parts.push(
      input.tdeeKcal && eatenKcal + kcal > input.tdeeKcal
        ? t("snackAdvice.reason.surplus")
        : t("snackAdvice.reason.thinDeficit"),
    );
  } else if (reserve > 0) {
    const room = Math.max(0, spare);
    const roomKey = verdict === "aman" ? "safe" : room > 0 ? "some" : "none";
    parts.push(
      t(`snackAdvice.reason.reserve.${roomKey}`, {
        remaining: kcalText(remaining, t),
        upcoming: upcomingLabel,
        reserve: Math.round(reserve),
        room,
        noun: t(`snackAdvice.spareNoun.${input.kind}`),
      }),
    );
    if (verdict === "hati-hati") {
      parts.push(
        t("snackAdvice.reason.careful", { upcoming: upcomingLabel, after: kcalText(after, t) }),
      );
    }
  } else {
    parts.push(
      t("snackAdvice.reason.simple", {
        remaining: kcalText(remaining, t),
        after: kcalText(after, t),
      }),
    );
  }

  const suggestions: AdviceSuggestion[] = [];
  if (verdict !== "aman") {
    if (kcal >= 60) {
      const half = Math.round(kcal / 2);
      suggestions.push({
        type: "half",
        label: t("snackAdvice.half.label"),
        kcal: half,
        verdict: verdictFor(half, remaining, spare),
      });
    }
    const swap = swapSuggestion(input.kind, kcal, Math.max(spare, 0), t, locale);
    if (swap) suggestions.push(swap);
    if (verdict === "hati-hati" && meals.length > 0 && after > 0) {
      suggestions.push({
        type: "lighter-next",
        label: t("snackAdvice.lighterNext.label", { upcoming: upcomingLabel }),
        targetKcal: after,
      });
    }
  }

  return {
    verdict,
    title: t(`snackAdvice.verdict.${verdict}`),
    reason: parts.join(" "),
    numbers: {
      kcal,
      eatenKcal: Math.round(eatenKcal),
      eatKcal: Math.round(eatKcal),
      remainingKcal: remaining,
      afterKcal: after,
      reserveKcal: Math.round(reserve),
      spareKcal: spare,
      overKcal: over,
    },
    upcoming: meals,
    outsideWindow,
    suggestions,
  };
}

/** Neutral one-liner for a past day: no verdict, just the effect on that day's total. */
export function dayImpactLine(
  eatenKcal: number,
  eatKcal: number,
  kcal: number,
  locale: Locale = getActiveLocale(),
): string | null {
  if (!(kcal > 0)) return null;
  const t = getT(locale, "makan");
  const total = kcalText(Math.round(eatenKcal + kcal), t);
  if (!(eatKcal > 0)) return t("snackAdvice.dayImpact.noTarget", { total });
  return t("snackAdvice.dayImpact.withTarget", { total, target: kcalText(eatKcal, t) });
}
