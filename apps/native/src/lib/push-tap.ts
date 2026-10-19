import { nativeHref, parsePushData } from "@joyorogo/api/lib/push-link";

/**
 * Expo Router href for a tapped notification's `data`, or null for anything the push pipeline did not send
 * (local reminders, the rest timer, malformed payloads).
 */
export function routeForNotificationData(data: unknown): string | null {
  const parsed = parsePushData(data);
  return parsed ? nativeHref(parsed.link) : null;
}
