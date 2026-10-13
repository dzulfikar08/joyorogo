import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";

const MEALS_KEY = "joyorogo.remind.meals";
const WEIGH_IN_KEY = "joyorogo.remind.weighin";
const FASTING_KEY = "joyorogo.remind.fasting";
const FASTING_SCHEDULE_KEY = "joyorogo.remind.fasting.schedule";

/** One IF reminder of the day; hours/minutes are WIB wall-clock. */
export type FastingReminder = { hour: number; minute: number; title: string; body: string };

// WIB assumption: calendar triggers run on the device's wall clock. iOS honors
// the `timezone` field, but Android ignores it and uses the device-local time
// — so exact 09:00/13:00/19:00 delivery on Android assumes the device is set
// to WIB (Asia/Jakarta). We still pass the IANA identifier for iOS.
const JAKARTA = "Asia/Jakarta";

const MEAL_REMINDERS = [
  {
    hour: 9,
    minute: 0,
    title: "Sarapan dulu yuk",
    body: "Catat sarapanmu biar kalori harianmu tetap terpantau.",
  },
  {
    hour: 13,
    minute: 0,
    title: "Makan siang waktunya",
    body: "Jangan lupa catat makan siangmu sebelum lupa.",
  },
  {
    hour: 19,
    minute: 0,
    title: "Makan malam nih",
    body: "Catat makan malammu supaya rencana harianmu akurat.",
  },
] as const;

const WEIGH_IN_REMINDER = {
  hour: 7,
  minute: 0,
  title: "Timbang pagi",
  body: "Satu langkah kecil: catat berat badanmu hari ini.",
} as const;

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

export type ReminderPrefs = { meals: boolean; weighIn: boolean; fasting: boolean };

export async function loadReminderPrefs(): Promise<ReminderPrefs> {
  return {
    meals: await readFlag(MEALS_KEY),
    weighIn: await readFlag(WEIGH_IN_KEY),
    fasting: await readFlag(FASTING_KEY),
  };
}

// Returns the effective state: true only when the reminder is on AND the
// notification permission was granted, so the caller can mirror it on the
// Switch even when the user rejects the permission prompt.
export async function setMealReminders(enabled: boolean): Promise<boolean> {
  if (enabled && !(await ensureNotificationPermission())) return false;
  await writeFlag(MEALS_KEY, enabled);
  await rescheduleAll();
  return enabled;
}

export async function setWeighInReminder(enabled: boolean): Promise<boolean> {
  if (enabled && !(await ensureNotificationPermission())) return false;
  await writeFlag(WEIGH_IN_KEY, enabled);
  await rescheduleAll();
  return enabled;
}

/**
 * IF mode replaces the fixed 09:00/13:00/19:00 meal reminders with the
 * fasting schedule (window open, meals, 30-minutes-to-close). `reminders`
 * comes from lib/fasting dayReminders; null disables the mode. Returns the
 * effective state like the other toggles: false when permission was denied.
 */
export async function setFastingReminders(
  enabled: boolean,
  reminders: FastingReminder[] | null,
): Promise<boolean> {
  if (enabled && !(await ensureNotificationPermission())) return false;
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

// Cancels every notification this app scheduled, THROUGH the same queue as
// reschedules — sign-out can then never race a mid-flight reschedule back
// into existence. Persisted choices stay intact for the next sign-in.
export async function teardownReminders(): Promise<void> {
  const run = rescheduleQueue.then(async () => {
    try {
      await Notifications.cancelAllScheduledNotificationsAsync();
    } catch {
      // Best-effort; never block sign-out on it.
    }
  });
  rescheduleQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export async function cancelAllAppReminders(): Promise<void> {
  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
  } catch {
    // Scheduling is best-effort; never block sign-out on it.
  }
}

async function ensureNotificationPermission(): Promise<boolean> {
  try {
    const existing = await Notifications.getPermissionsAsync();
    if (existing.granted) return true;
    const requested = await Notifications.requestPermissionsAsync();
    return requested.granted;
  } catch {
    return false;
  }
}

function calendarTrigger(hour: number, minute: number): Notifications.CalendarTriggerInput {
  return {
    type: Notifications.SchedulableTriggerInputTypes.CALENDAR,
    hour,
    minute,
    repeats: true,
    timezone: JAKARTA,
  };
}

async function scheduleMeals(): Promise<void> {
  for (const meal of MEAL_REMINDERS) {
    await Notifications.scheduleNotificationAsync({
      content: { title: meal.title, body: meal.body },
      trigger: calendarTrigger(meal.hour, meal.minute),
    });
  }
}

// Toggling one group cancels and reschedules everything from persisted
// prefs — avoids bookkeeping of per-group scheduled ids. Rapid toggles are
// serialized so concurrent runs cannot interleave cancel/schedule steps and
// double-schedule the same reminder.
let rescheduleQueue: Promise<void> = Promise.resolve();

function rescheduleAll(): Promise<void> {
  const run = rescheduleQueue.then(doReschedule);
  rescheduleQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function doReschedule(): Promise<void> {
  await cancelAllAppReminders();
  const prefs = await loadReminderPrefs();
  try {
    // IF mode on → its schedule REPLACES the fixed meal reminders.
    if (prefs.fasting) {
      for (const reminder of await readFastingReminders()) {
        await Notifications.scheduleNotificationAsync({
          content: { title: reminder.title, body: reminder.body },
          trigger: calendarTrigger(reminder.hour, reminder.minute),
        });
      }
    } else if (prefs.meals) {
      await scheduleMeals();
    }
    if (prefs.weighIn) {
      await Notifications.scheduleNotificationAsync({
        content: { title: WEIGH_IN_REMINDER.title, body: WEIGH_IN_REMINDER.body },
        trigger: calendarTrigger(WEIGH_IN_REMINDER.hour, WEIGH_IN_REMINDER.minute),
      });
    }
  } catch {
    // Scheduling is best-effort; the choice is already persisted.
  }
}

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
