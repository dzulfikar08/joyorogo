import {
  Activity,
  Bike,
  Dumbbell,
  Flower2,
  Footprints,
  Goal,
  Mountain,
  PersonStanding,
  Volleyball,
  Waves,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import type { SportKind } from "./aggregate";

/**
 * First match wins, so specific names come before broad ones ("Pool Swimming" is a swim, "Mountain Hike" a hike).
 * Names are the watch's English sport names; the same order as JoyoFit's own sportIcon rules (watch-fit
 * src/features/workouts/sportIcon.ts), limited to the pictograms Lucide has.
 */
const RULES: readonly [RegExp, LucideIcon][] = [
  [/swim|diving|snorkel|rowing|kayak|canoe|surf|sail|paddle/i, Waves],
  [/hik|orienteer|climb/i, Mountain],
  [/walk/i, PersonStanding],
  [/run|trail|treadmill|obstacle|high-intensity|hiit/i, Footprints],
  [/cycl|spinning|bik|\bride\b|bmx/i, Bike],
  [/soccer|futsal|football/i, Goal],
  [/volleyball|basketball|handball|sepak/i, Volleyball],
  [/yoga|pilates|stretch|tai chi|meditat/i, Flower2],
  [/strength|weight|crossfit|functional|physical training|core training|barbell/i, Dumbbell],
];

const KIND_ICON: Partial<Record<SportKind, LucideIcon>> = {
  run: Footprints,
  walk: PersonStanding,
  ride: Bike,
  swim: Waves,
};

/** Pictogram for a workout by its sport name; an unknown name falls back to its kind, then to the activity pulse. */
export function sportIcon(sportName: string, kind: string): LucideIcon {
  return (
    RULES.find(([pattern]) => pattern.test(sportName))?.[1] ??
    KIND_ICON[kind as SportKind] ??
    Activity
  );
}

/** CSS color of a sport kind in charts (theme tokens, so it follows light and dark). */
export const SPORT_COLOR: Record<SportKind, string> = {
  run: "var(--primary)",
  walk: "var(--recovery)",
  ride: "var(--bakar)",
  swim: "var(--tidur)",
  other: "var(--chart-5)",
};
