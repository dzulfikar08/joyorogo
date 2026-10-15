// Food hint next to the JoyoFit scores of a day. Qualitative on purpose: the
// scores come from a watch and say how hard the day was and how rested the
// body is, not how many grams to eat, so no gram or kcal target is invented
// here. The kcal target shown in the diary does not move with these scores.
//
// Thresholds follow JoyoFit's own bands: recovery red below 34 and yellow below
// 67, sleep "bad" below 75% of the estimated need. Strain is 0..21; JoyoFit
// puts an hour of steady running at about 11 and two hard hours at about 18,
// so 14 and up counts as a hard day here.

export const READINESS_LABELS = ["Primed", "Balanced", "Strained", "Run down"] as const;
export type Readiness = (typeof READINESS_LABELS)[number];

export type FitnessDay = {
  recoveryPct: number | null;
  strain: number | null;
  sleepPct: number | null;
  readiness: Readiness | null;
};

export const HARD_STRAIN = 14;
export const LOW_RECOVERY_PCT = 34;
export const SHORT_SLEEP_PCT = 75;

/** Readiness word in Indonesian for the card; the stored label stays JoyoFit's English one. */
export const READINESS_ID: Record<Readiness, string> = {
  Primed: "Siap tancap",
  Balanced: "Seimbang",
  Strained: "Terbebani",
  "Run down": "Kelelahan",
};

/** True when there is at least one number or word worth showing. */
export function hasFitnessData(day: FitnessDay | null | undefined): day is FitnessDay {
  return !!day && (day.recoveryPct !== null || day.strain !== null || day.sleepPct !== null || day.readiness !== null);
}

/** Up to two short hints for the day's food; empty when nothing stands out. */
export function fitnessHints(day: FitnessDay): string[] {
  const hints: string[] = [];

  if (day.strain !== null && day.strain >= HARD_STRAIN) {
    hints.push(
      "Hari ini berat untuk tubuhmu, jadi kebutuhan energi dan karbohidrat lebih tinggi dari biasanya. Cukupi cairan juga.",
    );
  }

  const lowRecovery = day.recoveryPct !== null && day.recoveryPct < LOW_RECOVERY_PCT;
  const strained = day.readiness === "Strained" || day.readiness === "Run down";
  const shortSleep = day.sleepPct !== null && day.sleepPct < SHORT_SLEEP_PCT;
  if (lowRecovery || strained || shortSleep) {
    const why = lowRecovery
      ? "Pemulihanmu rendah"
      : shortSleep && !strained
        ? "Tidurmu kurang"
        : "Tubuhmu sedang terbebani";
    hints.push(`${why}: utamakan protein, cairan, dan tidur malam ini.`);
  }

  return hints;
}
