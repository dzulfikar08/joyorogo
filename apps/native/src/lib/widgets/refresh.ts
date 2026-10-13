import { authClient } from "@/lib/auth-client";
import { client } from "@/utils/orpc";

import type { WidgetSnapshot } from "./snapshot";
import { writeSnapshot } from "./snapshot";

/** Headless fetches must finish before Android tears the task down. */
const REFRESH_TIMEOUT_MS = 8000;

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("widget refresh timeout")), REFRESH_TIMEOUT_MS);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Headless data refresh for the widget task handler.
 *
 * Runs inside the launcher's periodic WIDGET_UPDATE (every 30 min) or when a
 * widget is added. The session cookie comes from SecureStore via the
 * better-auth expo client, and the fetch reuses the same orpc client as the
 * app, so endpoint and cookie handling stay in one place.
 *
 * Returns the fresh snapshot, or null when nothing changed (offline,
 * timeout) so the caller keeps the last drawn state.
 */
export async function refreshSnapshotFromApi(
  current: WidgetSnapshot,
): Promise<WidgetSnapshot | null> {
  const cookie = await authClient.getCookie();
  if (!cookie) {
    return current.signedIn ? writeSnapshot({ signedIn: false }) : current;
  }

  try {
    const [summary, inboxItems] = await Promise.all([
      withTimeout(client.day.summary({})),
      withTimeout(client.group.inbox({ limit: 3 })),
    ]);

    const items = inboxItems.map((item) => ({
      id: item.id,
      kind: item.kind,
      senderName: item.senderName,
      message: item.message,
      groupName: item.groupName,
      createdAt: item.createdAt,
      readAt: item.readAt,
    }));
    const day =
      summary.hasProfile && summary.targets
        ? {
            date: summary.date,
            eatenKcal: summary.eatenKcal,
            eatKcal: summary.targets.eatKcal,
            proteinEatenG: summary.protein?.eatenG ?? null,
            proteinTargetG: summary.protein?.targetG ?? null,
            streakDays: summary.streakDays,
          }
        : null;

    return writeSnapshot({
      signedIn: true,
      day,
      inbox: {
        unread: items.filter((item) => item.readAt === null).length,
        items,
      },
    });
  } catch (error) {
    // Expired session: flip the widget to the signed-out state.
    if ((error as { code?: unknown } | null)?.code === "UNAUTHORIZED") {
      return current.signedIn ? writeSnapshot({ signedIn: false }) : current;
    }
    return null;
  }
}
