import * as FileSystem from "expo-file-system/legacy";
import * as Notifications from "expo-notifications";

// Leftovers of the removed in-app strength logger.
const DRAFT_URI = `${FileSystem.documentDirectory ?? ""}latihan-aktif.json`;
// The rest-end notification had a random id kept only in memory, so a pending
// one survives only as content: match the old id/en titles.
const REST_TITLES = new Set(["Istirahat selesai", "Rest over"]);

async function cancelPendingRestNotifications() {
  try {
    const pending = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(
      pending
        .filter((n) => REST_TITLES.has(n.content.title ?? ""))
        .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)),
    );
  } catch {
    // Permission denied / simulator: nothing scheduled.
  }
}

/**
 * Delete the old active-workout draft if still on the device and cancel any
 * pending rest timer notification. Returns true when a draft existed, so the
 * caller can show the one-time notice.
 */
export async function clearLegacyDraft(): Promise<boolean> {
  let hadDraft = false;
  try {
    const info = await FileSystem.getInfoAsync(DRAFT_URI);
    if (info.exists) {
      hadDraft = true;
      await FileSystem.deleteAsync(DRAFT_URI, { idempotent: true });
    }
  } catch {
    // Unreadable file system: nothing to clean.
  }
  if (hadDraft) await cancelPendingRestNotifications();
  return hadDraft;
}
