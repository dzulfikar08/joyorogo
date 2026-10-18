import { fmtHHMM, parseHHMM } from "./fasting";

// The reminder choices of the native app, kept pure so the app (which stores and schedules them) and the account
// sync (rogo-prefs.ts, which validates what another phone sends) share one sanitizer.

export type MealReminderKey = "sarapan" | "makan_siang" | "makan_malam";

export type TimedReminder = { enabled: boolean; time: string };

export type WaterReminder = {
  enabled: boolean;
  start: string;
  end: string;
  everyHours: 2 | 3 | 4;
};

export type ReminderConfig = {
  meals: Record<MealReminderKey, TimedReminder>;
  water: WaterReminder;
  weighIn: TimedReminder;
  /** Naikin BB only: evening nudge while today's intake is still short of the target. */
  gainEvening: TimedReminder;
  /** Eating-window start/end of the IF schedule; times come from the IF settings. */
  window: { open: boolean; close: boolean };
};

export const MEAL_REMINDER_KEYS: readonly MealReminderKey[] = ["sarapan", "makan_siang", "makan_malam"];

export const WATER_INTERVALS = [2, 3, 4] as const;

export const DEFAULT_REMINDER_CONFIG: ReminderConfig = {
  meals: {
    sarapan: { enabled: false, time: "07:30" },
    makan_siang: { enabled: false, time: "12:30" },
    makan_malam: { enabled: false, time: "19:00" },
  },
  water: { enabled: false, start: "08:00", end: "20:00", everyHours: 2 },
  weighIn: { enabled: false, time: "07:00" },
  gainEvening: { enabled: false, time: "20:00" },
  window: { open: false, close: false },
};

function sanitizeTimed(raw: unknown, fallback: TimedReminder): TimedReminder {
  const item = (raw ?? {}) as Partial<TimedReminder>;
  return {
    enabled: item.enabled === true,
    time:
      typeof item.time === "string" && parseHHMM(item.time) !== null
        ? fmtHHMM(parseHHMM(item.time)!)
        : fallback.time,
  };
}

/** Any stored or received value, cleaned to a complete config: unknown keys are dropped, bad members fall back. */
export function sanitizeConfig(raw: unknown): ReminderConfig {
  const base = DEFAULT_REMINDER_CONFIG;
  const value = (raw ?? {}) as Partial<Record<keyof ReminderConfig, unknown>>;
  const meals = (value.meals ?? {}) as Partial<Record<MealReminderKey, unknown>>;
  const water = (value.water ?? {}) as Partial<WaterReminder>;
  const window = (value.window ?? {}) as Partial<ReminderConfig["window"]>;
  const start =
    typeof water.start === "string" && parseHHMM(water.start) !== null
      ? fmtHHMM(parseHHMM(water.start)!)
      : base.water.start;
  const end =
    typeof water.end === "string" && parseHHMM(water.end) !== null
      ? fmtHHMM(parseHHMM(water.end)!)
      : base.water.end;
  return {
    meals: {
      sarapan: sanitizeTimed(meals.sarapan, base.meals.sarapan),
      makan_siang: sanitizeTimed(meals.makan_siang, base.meals.makan_siang),
      makan_malam: sanitizeTimed(meals.makan_malam, base.meals.makan_malam),
    },
    water: {
      enabled: water.enabled === true,
      start,
      end,
      everyHours: WATER_INTERVALS.find((n) => n === water.everyHours) ?? base.water.everyHours,
    },
    weighIn: sanitizeTimed(value.weighIn, base.weighIn),
    gainEvening: sanitizeTimed(value.gainEvening, base.gainEvening),
    window: { open: window.open === true, close: window.close === true },
  };
}
