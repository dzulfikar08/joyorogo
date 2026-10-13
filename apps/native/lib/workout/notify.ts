import * as Notifications from "expo-notifications";

// Registered at module import (active workout screen) so the rest-timer
// notification shows even when the app is backgrounded when it fires.
void Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

let scheduledId: string | null = null;

/** Local notification when the rest timer ends while the app is hidden. */
export async function scheduleRestEndNotification(seconds: number) {
  await cancelRestEndNotification();
  try {
    scheduledId = await Notifications.scheduleNotificationAsync({
      content: {
        title: "Istirahat selesai",
        body: "Waktunya set berikutnya.",
        sound: true,
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds },
    });
  } catch {
    // Permission denied / simulator: timer in-app still works.
  }
}

export async function cancelRestEndNotification() {
  if (scheduledId === null) return;
  const id = scheduledId;
  scheduledId = null;
  try {
    await Notifications.cancelScheduledNotificationAsync(id);
  } catch {
    // Already gone.
  }
}
