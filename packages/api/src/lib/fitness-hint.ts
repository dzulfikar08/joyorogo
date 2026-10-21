// Food hint next to the JoyoFit scores of a day. Qualitative on purpose: the
// scores come from a watch and say how hard the day was and how rested the
// body is, not how many grams to eat, so no gram or kcal target is invented
// here. The kcal target shown in the diary does not move with these scores.
//
// Thresholds follow JoyoFit's own bands: recovery red below 34 and yellow below
// 67, sleep "bad" below 75% of the estimated need. Strain is 0..21; JoyoFit
// puts an hour of steady running at about 11 and two hard hours at about 18,
// so 14 and up counts as a hard day here.

import { fmtDecimal, fmtInt, getActiveLocale, getT } from "@joyorogo/i18n";
import type { Locale } from "@joyorogo/i18n";

import { localizedLabels } from "./engine";

export const READINESS_LABELS = ["Primed", "Balanced", "Strained", "Run down"] as const;
export type Readiness = (typeof READINESS_LABELS)[number];

export type FitnessDay = {
  recoveryPct: number | null;
  strain: number | null;
  sleepPct: number | null;
  readiness: Readiness | null;
};

export const HARD_STRAIN = 14;
/** Two hard hours in JoyoFit's own scale (see header); the upper band of a hard day. */
export const VERY_HARD_STRAIN = 18;
export const LOW_RECOVERY_PCT = 34;
export const SHORT_SLEEP_PCT = 75;

const READINESS_KEY = {
  Primed: "primed",
  Balanced: "balanced",
  Strained: "strained",
  "Run down": "runDown",
} as const satisfies Record<Readiness, string>;

/** Readiness word in the user's language for the card; the stored label stays JoyoFit's English one. */
export function readinessLabel(readiness: Readiness, locale: Locale = getActiveLocale()): string {
  return getT(locale, "makan")(`fitnessCard.readiness.${READINESS_KEY[readiness]}`);
}

/** Readiness words for the card, following the active language (lazy, see `localizedLabels`). */
export const READINESS_ID: Record<Readiness, string> = localizedLabels(
  READINESS_LABELS,
  readinessLabel,
);

/** True when there is at least one number or word worth showing. */
export function hasFitnessData(day: FitnessDay | null | undefined): day is FitnessDay {
  return !!day && (day.recoveryPct !== null || day.strain !== null || day.sleepPct !== null || day.readiness !== null);
}

/** What stands out in a day's scores; one definition for the free hints and the Premium guidance. */
export function readinessFlags(day: FitnessDay) {
  const lowRecovery = day.recoveryPct !== null && day.recoveryPct < LOW_RECOVERY_PCT;
  const strained = day.readiness === "Strained" || day.readiness === "Run down";
  const shortSleep = day.sleepPct !== null && day.sleepPct < SHORT_SLEEP_PCT;
  return {
    hardDay: day.strain !== null && day.strain >= HARD_STRAIN,
    veryHardDay: day.strain !== null && day.strain >= VERY_HARD_STRAIN,
    lowRecovery,
    strained,
    shortSleep,
    needsRest: lowRecovery || strained || shortSleep,
  };
}

/** Up to two short hints for the day's food; empty when nothing stands out. */
export function fitnessHints(day: FitnessDay, locale: Locale = getActiveLocale()): string[] {
  const t = getT(locale, "makan");
  const hints: string[] = [];
  const { hardDay, lowRecovery, strained, shortSleep, needsRest } = readinessFlags(day);

  if (hardDay) hints.push(t("fitnessCard.hint.hardDay"));

  if (needsRest) {
    hints.push(
      lowRecovery
        ? t("fitnessCard.hint.rest.lowRecovery")
        : shortSleep && !strained
          ? t("fitnessCard.hint.rest.shortSleep")
          : t("fitnessCard.hint.rest.strained"),
    );
  }

  return hints;
}

/** One headline number of the compact JoyoFit card; `unit` is shown small right after the value. */
export type FitnessFigure = {
  id: "recovery" | "strain" | "readiness";
  label: string;
  value: string;
  unit: string | null;
};

/**
 * The at most three figures the compact card shows: recovery, strain and the readiness word. Sleep is left out on
 * purpose (the diary's stats list and the Tidur screen already own it). A score JoyoFit did not push is skipped, not
 * shown as a dash.
 */
export function fitnessFigures(day: FitnessDay, locale: Locale = getActiveLocale()): FitnessFigure[] {
  const t = getT(locale, "makan");
  const figures: FitnessFigure[] = [];
  if (day.recoveryPct !== null) {
    figures.push({ id: "recovery", label: t("fitnessCard.metric.recovery"), value: fmtInt(day.recoveryPct, locale), unit: "%" });
  }
  if (day.strain !== null) {
    figures.push({ id: "strain", label: t("fitnessCard.metric.strain"), value: fmtDecimal(day.strain, 1, locale), unit: "/21" });
  }
  if (day.readiness !== null) {
    figures.push({ id: "readiness", label: t("fitnessCard.metric.readiness"), value: readinessLabel(day.readiness, locale), unit: null });
  }
  return figures;
}

/**
 * The single short line under the figures, or null when nothing stands out. Rest comes before a hard day: the
 * longer food hints for both live in the detail sheet (`fitnessHints`).
 */
export function fitnessVerdict(day: FitnessDay, locale: Locale = getActiveLocale()): string | null {
  const t = getT(locale, "makan");
  const { hardDay, lowRecovery, strained, shortSleep } = readinessFlags(day);
  if (lowRecovery) return t("fitnessCard.verdict.lowRecovery");
  if (strained) return t("fitnessCard.verdict.strained");
  if (shortSleep) return t("fitnessCard.verdict.shortSleep");
  if (hardDay) return t("fitnessCard.verdict.hardDay");
  return null;
}

/** Locked teaser the free tier sees under the hints; the action opens the Founder paywall. Each field follows the active language. */
export const FOOD_GUIDANCE_TEASER = {
  get title() {
    return getT(getActiveLocale(), "makan")("fitnessCard.teaser.title");
  },
  get body() {
    return getT(getActiveLocale(), "makan")("fitnessCard.teaser.body");
  },
  get action() {
    return getT(getActiveLocale(), "makan")("fitnessCard.teaser.action");
  },
};
