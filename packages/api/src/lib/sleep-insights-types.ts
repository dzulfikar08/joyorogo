// Shared contract of the sleep insights feature (docs/sleep-insights-design.md): the wire shape of `sleepInsights.get` and
// the constants every side agrees on. Pure types and constants, no imports from the engine.

/** Bumped when the list of fields JoyoFit sends changes: a changed list needs a new yes. */
export const SLEEP_CONSENT_VERSION = 1;
/** Nights kept per account (trimmed on every write). */
export const SLEEP_RETENTION_NIGHTS = 90;
/** Nights per `upsertNights` call. */
export const SLEEP_MAX_NIGHTS_PER_PUSH = 14;

// Alcohol is only a general tip (owner decision): there is no personal alcohol factor.
export type SleepFactor = "caffeine" | "dinner" | "workout" | "regularity" | "temperature" | "humidity";
export type SleepConfidence = "maybe" | "leaning";
/** Per-night fixed outcome of a factor (design section 4). */
export type SleepOutcome = "asleep" | "awake";

export type SleepCardKind = "general" | "personal";

export interface SleepCardNight {
  /** wake date, 'YYYY-MM-DD' */
  date: string;
  exposed: boolean;
}

export interface SleepCard {
  /** `general:<topic>` or `personal:<factor>`; what `dismiss` takes. */
  id: string;
  kind: SleepCardKind;
  /** The factor of a personal card; the topic of a general card ('caffeine' | 'alcohol' | 'regularity' | 'jetlag'). */
  topic: string;
  /** Rendered server side in the requested locale (packages/i18n sleepInsights.json). */
  text: string;
  /** Personal cards only. */
  confidence: SleepConfidence | null;
  exposed: number | null;
  other: number | null;
  /** Personal cards: the compared nights, newest first (a dot per night). */
  nights: SleepCardNight[];
  sources: { label: string; url: string }[];
}

export interface SleepProgressRow {
  id: string;
  /** Rendered, e.g. "Butuh 4 malam lagi dengan kopi sore untuk membandingkan malammu." */
  text: string;
  have: number;
  need: number;
}

export interface SleepLastNight {
  wakeDate: string;
  asleepMin: number;
  awakeMin: number;
  awakenings: number;
  hrvMs: number | null;
  rhrBpm: number | null;
  hasStages: boolean;
  deepMin: number | null;
  remMin: number | null;
  /** Bedroom sensor means over the sleep window; null without a sensor. */
  room: { tempC: number; rhPct: number } | null;
}

export interface SleepInsightsView {
  enabled: boolean;
  /**
   * `ready`: Pro (or no paywall) and enough nights; `needs_nights`: not enough nights yet for a personal comparison;
   * `locked`: free account (personal cards are stripped to `lockedCount`).
   */
  personal: "ready" | "locked" | "needs_nights";
  /** Personal findings that exist; for a free account this is the teaser number. */
  lockedCount: number;
  cards: SleepCard[];
  progress: SleepProgressRow[];
  lastNight: SleepLastNight | null;
  /** Bedtime spread over the last 7 nights (needs 5): standard deviation in minutes. */
  regularity: { nights: number; sdMin: number } | null;
}

export interface SleepInsightsStatus {
  enabled: boolean;
  consentVersion: number;
  currentVersion: number;
  nights: number;
  latestWakeDate: string | null;
  freeDaysMask: number;
}

/** A finding that passed the gate: what the weekly reflection and the cards are made from. */
export interface SleepFinding {
  factor: SleepFactor;
  confidence: SleepConfidence;
  outcome: SleepOutcome;
  exposed: number;
  other: number;
  /** exposed mean minus other mean: minutes. */
  diff: number;
  /** temperature (°C) / humidity (%) findings: the person's own hottest-third / most humid-third cut-off, rounded; null otherwise. */
  threshold: number | null;
  nights: SleepCardNight[];
  /** Latest wake date the finding was computed through. */
  through: string;
}
