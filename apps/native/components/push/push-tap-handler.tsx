import * as Notifications from "expo-notifications";
import { router, useRootNavigationState, type Href } from "expo-router";
import { useEffect, useRef, useState } from "react";

import { authClient } from "@/lib/auth-client";
import { routeForNotificationData } from "@/src/lib/push-tap";

/**
 * Opens the screen a tapped push points at: warm taps through the response listener, cold starts through the last
 * response. A tap waits until the navigator exists and the session is known; signed out drops it. Each notification
 * id is handled once. Renders nothing; mount once in the root layout.
 */
export function PushTapHandler() {
  const navReady = Boolean(useRootNavigationState()?.key);
  const { data: session, isPending } = authClient.useSession();
  const signedIn = Boolean(session?.user.id);
  const [pending, setPending] = useState<Notifications.NotificationResponse | null>(null);
  const handled = useRef(new Set<string>());

  useEffect(() => {
    try {
      const sub = Notifications.addNotificationResponseReceivedListener(setPending);
      const last =
        typeof Notifications.getLastNotificationResponse === "function"
          ? Notifications.getLastNotificationResponse()
          : null;
      if (last) setPending(last);
      return () => sub.remove();
    } catch {
      return undefined;
    }
  }, []);

  useEffect(() => {
    if (!pending || !navReady || isPending) return;
    const id = pending.notification.request.identifier;
    setPending(null);
    if (handled.current.has(id)) return;
    handled.current.add(id);
    if (!signedIn) return;
    const href = routeForNotificationData(pending.notification.request.content.data);
    if (!href) return;
    try {
      router.push(href as Href);
    } catch {
      // navigation not ready after all: dropping one tap beats crashing
    }
  }, [pending, navReady, isPending, signedIn]);

  return null;
}
