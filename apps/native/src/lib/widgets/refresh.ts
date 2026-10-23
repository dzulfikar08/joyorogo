import { authClient } from "@/lib/auth-client";
import { singleFlight } from "@/src/lib/single-flight";
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
 *
 * The launcher starts one headless run per widget on the same tick and WorkManager runs them side by side in this
 * JS instance, so concurrent calls share one fetch instead of making three API calls each.
 */
export const refreshSnapshotFromApi = singleFlight(fetchSnapshot);

async function fetchSnapshot(current: WidgetSnapshot): Promise<WidgetSnapshot | null> {
  const cookie = await authClient.getCookie();
  if (!cookie) {
    return current.signedIn ? writeSnapshot({ signedIn: false }) : current;
  }

  try {
    const [summary, inboxItems, fast] = await Promise.all([
      withTimeout(client.day.summary({})),
      withTimeout(client.group.inbox({ limit: 50 })),
      withTimeout(client.fasting.today({})),
    ]);

    const unreadItems = inboxItems
      .filter((item) => item.readAt === null)
      .map((item) => ({
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
            zone: summary.zone,
            eatenKcal: summary.eatenKcal,
            eatKcal: summary.targets.eatKcal,
            proteinEatenG: summary.protein?.eatenG ?? null,
            proteinTargetG: summary.protein?.targetG ?? null,
            streakDays: summary.streakDays,
            streak: summary.streak
              ? { days: summary.streak.days, lastLoggedDate: summary.streak.lastLoggedDate }
              : null,
            maternal: summary.targets.maternal != null,
            gain: summary.targets.maternal == null && summary.targets.gain != null,
          }
        : null;
    // Absolute window times only: the launcher redraws every 30 minutes, so
    // countdown text would go stale between refreshes.
    const fasting =
      fast.active && fast.state && fast.windowOpen && fast.windowClose
        ? {
            state: fast.state,
            windowOpen: fast.windowOpen,
            windowClose: fast.windowClose,
          }
        : null;

    return writeSnapshot({
      signedIn: true,
      day,
      fasting,
      inbox: {
        unread: unreadItems.length,
        items: unreadItems.slice(0, 3),
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
