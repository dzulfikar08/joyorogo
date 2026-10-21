import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { Linking, Platform } from "react-native";

import {
  type FastingPattern,
  fmtHHMM,
  parseHHMM,
  windowHoursFor,
  windowTimes,
} from "@joyorogo/api/lib/fasting";
import { gainRemaining } from "@joyorogo/api/lib/gain";
import {
  DEFAULT_REMINDER_CONFIG,
  MEAL_REMINDER_KEYS,
  sanitizeConfig,
  type MealReminderKey,
  type ReminderConfig,
  type WaterReminder,
} from "@joyorogo/api/lib/reminder-config";
import { notePrefChanged } from "@joyorogo/api/lib/rogo-prefs-sync";
import { dayZoneOffsetMs, i18n } from "@joyorogo/i18n";

import { zoneToLocalMinutes } from "@/src/lib/reminder-time";

// --- Storage keys -------------------------------------------------------------

const CONFIG_KEY = "joyorogo.remind.config.v2";
// Legacy v1 flags: read once to migrate users who already had reminders on.
const LEGACY_MEALS_KEY = "joyorogo.remind.meals";
const LEGACY_WEIGH_IN_KEY = "joyorogo.remind.weighin";
// The IF schedule is derived from the server settings by components/fasting.
const FASTING_KEY = "joyorogo.remind.fasting";
const FASTING_SCHEDULE_KEY = "joyorogo.remind.fasting.schedule";
// Notifications scheduled before v2 carried no tag; one full cancel migrates.
const TAGGED_KEY = "joyorogo.remind.tagged";

/** Marks notifications this module scheduled, so the rest-timer one survives. */
const REMINDER_TAG = "reminder";

// --- Types ----------------------------------------------------------------------


/**
 * What the app knows locally at schedule time. `null` means unknown (not
 * loaded yet / offline), in which case nothing is skipped.
 */
export type ReminderContext = {
  eaten: Record<MealReminderKey, boolean> | null;
  weighedToday: boolean | null;
  fasting: { pattern: FastingPattern; windowStart: string } | null;
  /**
   * Naikin BB plan only: kcal still to eat today. `null` = unknown (not loaded yet) or not a
   * gain plan; the evening reminder is not scheduled then.
   */
  gain: { remainingKcal: number } | null;
};

/** One IF reminder of the day; hours/minutes are wall-clock in the day zone. */
export type FastingReminder = { hour: number; minute: number; title: string; body: string };



// --- Channels (Android) -----------------------------------------------------------

const CHANNEL_IDS = ["meals", "water", "weighin", "fasting"] as const;
type ChannelId = (typeof CHANNEL_IDS)[number];

/** Channel names are shown in system settings, so they follow the app language too. */
let channelsReady: { locale: string; ready: Promise<void> } | null = null;

/**
 * Android 13+ shows the permission dialog only after at least one channel
 * exists, and every scheduled reminder needs its channel, so this runs before
 * both. No-op elsewhere. Runs again after a language switch to rename them.
 */
export function ensureNotificationChannels(): Promise<void> {
  if (Platform.OS !== "android") return Promise.resolve();
  const locale = i18n.language;
  if (channelsReady?.locale === locale) return channelsReady.ready;
  const ready = (async () => {
    for (const id of CHANNEL_IDS) {
      await Notifications.setNotificationChannelAsync(id, {
        name: i18n.t(`settings:reminders.notification.channel.${id}.name`),
        description: i18n.t(`settings:reminders.notification.channel.${id}.description`),
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }
  })().catch((e: unknown) => {
    channelsReady = null;
    throw e;
  });
  channelsReady = { locale, ready };
  return ready;
}

// Reminders must also appear when the app happens to be open at the
// scheduled time, not only from the system tray.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

// --- Permission ---------------------------------------------------------------------

/** blocked = the system will not show the dialog again; only Settings can fix it. */
export type NotificationPermission = "granted" | "undetermined" | "blocked";

export async function getNotificationPermission(): Promise<NotificationPermission> {
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return "granted";
    return current.canAskAgain ? "undetermined" : "blocked";
  } catch {
    return "blocked";
  }
}

/** Triggers the system dialog. Call only after the styled pre-prompt. */
export async function requestNotificationPermission(): Promise<boolean> {
  try {
    await ensureNotificationChannels();
    const requested = await Notifications.requestPermissionsAsync();
    return requested.granted;
  } catch {
    return false;
  }
}

export function openNotificationSettings(): Promise<void> {
  return Linking.openSettings();
}

// --- Config persistence -----------------------------------------------------------


/** The config this phone has stored, or undefined while the person never saved one (the legacy flags do not count). */
export async function readStoredReminderConfig(): Promise<ReminderConfig | undefined> {
  try {
    const raw = await SecureStore.getItemAsync(CONFIG_KEY);
    return raw ? sanitizeConfig(JSON.parse(raw)) : undefined;
  } catch {
    return undefined;
  }
}

export async function loadReminderConfig(): Promise<ReminderConfig> {
  try {
    const raw = await SecureStore.getItemAsync(CONFIG_KEY);
    if (raw) return sanitizeConfig(JSON.parse(raw));
  } catch {
    // Fall through to the legacy flags / defaults.
  }
  // First run on v2: carry the old fixed 09:00/13:00/19:00 + 07:00 choices over.
  const [meals, weighIn] = await Promise.all([
    readFlag(LEGACY_MEALS_KEY),
    readFlag(LEGACY_WEIGH_IN_KEY),
  ]);
  const base = DEFAULT_REMINDER_CONFIG;
  return {
    ...base,
    meals: {
      sarapan: { enabled: meals, time: "09:00" },
      makan_siang: { enabled: meals, time: "13:00" },
      makan_malam: { enabled: meals, time: "19:00" },
    },
    weighIn: { ...base.weighIn, enabled: weighIn },
  };
}

/** Stores the config without telling the account or rescheduling (used when the config came from the account). */
export function writeReminderConfig(config: ReminderConfig): Promise<void> {
  return writeJson(CONFIG_KEY, config);
}

/** Persists the config, reschedules with the last known local context and tells the account. */
export async function saveReminderConfig(config: ReminderConfig): Promise<void> {
  await writeReminderConfig(config);
  await rescheduleAll();
  await notePrefChanged("reminders", config);
}

// --- IF notifications (settings-card) ---------------------------------------------

/**
 * IF mode replaces the fixed meal reminders with the fasting schedule
 * (window open, meals, 30-minutes-to-close). `reminders` comes from lib/fasting
 * dayReminders; null keeps the stored schedule. Returns the effective state:
 * false when enabling without notification permission (the caller asks first).
 */
export async function setFastingReminders(
  enabled: boolean,
  reminders: FastingReminder[] | null,
): Promise<boolean> {
  if (enabled && (await getNotificationPermission()) !== "granted") return false;
  await writeFlag(FASTING_KEY, enabled);
  if (reminders !== null) {
    await writeJson(FASTING_SCHEDULE_KEY, reminders);
  }
  await rescheduleAll();
  return enabled;
}

async function readFastingReminders(): Promise<FastingReminder[]> {
  try {
    const raw = await SecureStore.getItemAsync(FASTING_SCHEDULE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is FastingReminder =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as FastingReminder).hour === "number" &&
        typeof (item as FastingReminder).minute === "number" &&
        typeof (item as FastingReminder).title === "string" &&
        typeof (item as FastingReminder).body === "string",
    );
  } catch {
    return [];
  }
}

// --- Scheduling ---------------------------------------------------------------------

type Slot = { channel: ChannelId; kind: string; title: string; body: string };

/** Minutes-of-day in the person's day zone → this device's wall-clock minutes-of-day. */
function zoneToDeviceMinutes(zoneMin: number): number {
  return zoneToLocalMinutes(zoneMin, -new Date().getTimezoneOffset(), dayZoneOffsetMs() / 60_000);
}

function content(slot: Slot): Notifications.NotificationContentInput {
  return { title: slot.title, body: slot.body, data: { app: REMINDER_TAG, kind: slot.kind } };
}

async function scheduleDaily(minutes: number, slot: Slot): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    content: content(slot),
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour: Math.floor(minutes / 60),
      minute: minutes % 60,
      channelId: slot.channel,
    },
  });
}

/**
 * Daily reminder that can skip TODAY. Repeating triggers cannot be told to
 * miss one occurrence, so it is scheduled as seven weekly triggers and
 * today's weekday is left out when its time is still ahead and the thing is
 * already logged. The skipped weekday returns on the next sync (every app
 * open and every log), so a gap only lasts while the app stays closed.
 */
async function scheduleDailySkippable(
  minutes: number,
  slot: Slot,
  skipToday: boolean,
): Promise<void> {
  const now = new Date();
  const todayWeekday = now.getDay() + 1; // expo: 1 = Sunday
  const stillAhead = minutes > now.getHours() * 60 + now.getMinutes();
  for (let weekday = 1; weekday <= 7; weekday++) {
    if (skipToday && stillAhead && weekday === todayWeekday) continue;
    await Notifications.scheduleNotificationAsync({
      content: content(slot),
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
        weekday,
        hour: Math.floor(minutes / 60),
        minute: minutes % 60,
        channelId: slot.channel,
      },
    });
  }
}

function mealCopy(key: MealReminderKey): { title: string; body: string } {
  return {
    title: i18n.t(`settings:reminders.notification.meal.${key}.title`),
    body: i18n.t(`settings:reminders.notification.meal.${key}.body`),
  };
}

export function waterSlotMinutes(water: Pick<WaterReminder, "start" | "end" | "everyHours">): number[] {
  const start = parseHHMM(water.start);
  const end = parseHHMM(water.end);
  if (start === null || end === null || end < start) return [];
  const slots: number[] = [];
  for (let m = start; m <= end && slots.length < 12; m += water.everyHours * 60) slots.push(m);
  return slots;
}

async function schedulePlan(
  config: ReminderConfig,
  ctx: ReminderContext,
  fastingOn: boolean,
): Promise<void> {
  // IF mode on → its schedule REPLACES the fixed meal reminders.
  if (fastingOn) {
    for (const reminder of await readFastingReminders()) {
      await scheduleDaily(zoneToDeviceMinutes(reminder.hour * 60 + reminder.minute), {
        channel: "fasting",
        kind: "fasting",
        title: reminder.title,
        body: reminder.body,
      });
    }
  } else {
    for (const key of MEAL_REMINDER_KEYS) {
      const meal = config.meals[key];
      const minutes = parseHHMM(meal.time);
      if (!meal.enabled || minutes === null) continue;
      await scheduleDailySkippable(
        minutes,
        { channel: "meals", kind: key, ...mealCopy(key) },
        ctx.eaten?.[key] === true,
      );
    }
  }

  const weighMinutes = parseHHMM(config.weighIn.time);
  if (config.weighIn.enabled && weighMinutes !== null) {
    await scheduleDailySkippable(
      weighMinutes,
      {
        channel: "weighin",
        kind: "weighin",
        title: i18n.t("settings:reminders.notification.weighIn.title"),
        body: i18n.t("settings:reminders.notification.weighIn.body"),
      },
      ctx.weighedToday === true,
    );
  }

  // Naikin BB: one evening nudge, only while the target is still not reached today. Skipped
  // for today (when its time is still ahead) as soon as the day reaches the target.
  const gainMinutes = parseHHMM(config.gainEvening.time);
  if (config.gainEvening.enabled && gainMinutes !== null && ctx.gain) {
    // Same state rule as the day ring: remaining = target - eaten, so (remaining, 0) classifies alike.
    const left = gainRemaining(ctx.gain.remainingKcal, 0);
    const short = left.state === "short";
    await scheduleDailySkippable(
      gainMinutes,
      {
        channel: "meals",
        kind: "gain-evening",
        // The kcal in the title is the number at schedule time; once reached it would read 0, so
        // the other weekdays carry the plain title until the next sync finds the day short again.
        title: short
          ? i18n.t("gain:reminder.title", { kcal: Math.max(10, Math.round(left.kcal / 10) * 10) })
          : i18n.t("gain:nativeToday.reminder.titleReached"),
        body: i18n.t("gain:reminder.body"),
      },
      !short,
    );
  }

  // Water has no smart skip: the glass count is not known to a repeating
  // trigger, and 12 slots x 7 weekdays would blow iOS's 64-pending limit.
  if (config.water.enabled) {
    for (const minutes of waterSlotMinutes(config.water)) {
      await scheduleDaily(minutes, {
        channel: "water",
        kind: "water",
        title: i18n.t("settings:reminders.notification.water.title"),
        body: i18n.t("settings:reminders.notification.water.body"),
      });
    }
  }

  if (ctx.fasting) {
    const window = windowTimes(ctx.fasting.windowStart, windowHoursFor(ctx.fasting.pattern));
    const closeLabel = fmtHHMM(window.endMin);
    // The IF set already nudges at window open; do not buzz twice.
    if (config.window.open && !fastingOn) {
      await scheduleDaily(zoneToDeviceMinutes(window.startMin), {
        channel: "fasting",
        kind: "window-open",
        title: i18n.t("settings:reminders.notification.windowOpen.title"),
        body: i18n.t("settings:reminders.notification.windowOpen.body", { time: closeLabel }),
      });
    }
    if (config.window.close) {
      await scheduleDaily(zoneToDeviceMinutes(window.endMin), {
        channel: "fasting",
        kind: "window-close",
        title: i18n.t("settings:reminders.notification.windowClose.title"),
        body: i18n.t("settings:reminders.notification.windowClose.body", {
          time: fmtHHMM(window.startMin),
        }),
      });
    }
  }
}

// Every change cancels our notifications and reschedules from persisted
// config — avoids bookkeeping of per-group scheduled ids. Runs are serialized
// so concurrent triggers cannot interleave cancel/schedule steps and
// double-schedule the same reminder.
let rescheduleQueue: Promise<void> = Promise.resolve();
let lastContext: ReminderContext = { eaten: null, weighedToday: null, fasting: null, gain: null };

function enqueue(job: () => Promise<void>): Promise<void> {
  const run = rescheduleQueue.then(job);
  rescheduleQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** Re-plans every reminder from the stored config; schedules nothing without notification permission. */
export function rescheduleAll(): Promise<void> {
  return enqueue(doReschedule);
}

/**
 * Called by the root sync with what the app currently knows (meals logged
 * today, weighed today, IF window). Re-plans all reminders against it.
 */
export function syncReminders(ctx: ReminderContext): Promise<void> {
  lastContext = ctx;
  return rescheduleAll();
}

async function cancelOwnReminders(): Promise<void> {
  try {
    if ((await SecureStore.getItemAsync(TAGGED_KEY)) !== "1") {
      // Pre-v2 reminders have no tag; wipe them once.
      await Notifications.cancelAllScheduledNotificationsAsync();
      await SecureStore.setItemAsync(TAGGED_KEY, "1");
      return;
    }
    const pending = await Notifications.getAllScheduledNotificationsAsync();
    for (const item of pending) {
      if ((item.content.data as { app?: unknown } | null)?.app === REMINDER_TAG) {
        await Notifications.cancelScheduledNotificationAsync(item.identifier);
      }
    }
  } catch {
    // Best-effort; never block sign-out on it.
  }
}

// Cancels every reminder this module scheduled, THROUGH the same queue as
// reschedules — sign-out can then never race a mid-flight reschedule back
// into existence. Persisted choices stay intact for the next sign-in.
export function teardownReminders(): Promise<void> {
  return enqueue(cancelOwnReminders);
}

async function doReschedule(): Promise<void> {
  await cancelOwnReminders();
  if ((await getNotificationPermission()) !== "granted") return;
  try {
    await ensureNotificationChannels();
    const [config, fastingOn] = await Promise.all([
      loadReminderConfig(),
      readFlag(FASTING_KEY),
    ]);
    await schedulePlan(config, lastContext, fastingOn);
  } catch {
    // Scheduling is best-effort; the choice is already persisted.
  }
}

// --- Persistence helpers --------------------------------------------------------------

async function readFlag(key: string): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(key)) === "1";
  } catch {
    return false;
  }
}

async function writeFlag(key: string, value: boolean): Promise<void> {
  try {
    await SecureStore.setItemAsync(key, value ? "1" : "0");
  } catch {
    // Persistence is best-effort.
  }
}

async function writeJson(key: string, value: unknown): Promise<void> {
  try {
    await SecureStore.setItemAsync(key, JSON.stringify(value));
  } catch {
    // Persistence is best-effort.
  }
}
