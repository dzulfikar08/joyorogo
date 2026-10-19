import { useCallback, useEffect, useState } from "react";

import { client } from "@/utils/orpc";

/** Why `enableWebPush` did not end up with a live subscription. */
export type WebPushFailure =
  | "unsupported"
  | "denied"
  | "serverNotReady"
  | "noKeys"
  | "failed";

export type WebPushResult = { ok: true } | { ok: false; reason: WebPushFailure };

/** `unsupported` = no Notification / service worker / PushManager (e.g. iOS Safari outside an installed PWA). */
export type WebPushPermission = "unsupported" | NotificationPermission;

/** PushManager.applicationServerKey accepts a base64url string, but
 * BufferSource is the portable form across browsers. */
function base64UrlToUint8Array(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  const raw = atob(padded + pad);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** Browser can do Web Push at all. Safe to call during SSR (returns false). */
export function isWebPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "Notification" in window &&
    "serviceWorker" in navigator &&
    "PushManager" in window
  );
}

export function webPushPermission(): WebPushPermission {
  return isWebPushSupported() ? Notification.permission : "unsupported";
}

/** This browser's live push subscription, or null (never throws). */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!isWebPushSupported()) return null;
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    return (await registration?.pushManager.getSubscription()) ?? null;
  } catch {
    return null;
  }
}

/** Permission → /sw.js → VAPID subscribe → save on the server. */
export async function enableWebPush(): Promise<WebPushResult> {
  try {
    if (!isWebPushSupported()) return { ok: false, reason: "unsupported" };
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return { ok: false, reason: "denied" };
    const registration = await navigator.serviceWorker.register("/sw.js");
    const { key } = await client.push.vapidPublicKey();
    if (!key) return { ok: false, reason: "serverNotReady" };
    let subscription = await registration.pushManager.getSubscription();
    subscription ??= await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToUint8Array(key),
    });
    const json = subscription.toJSON();
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
      return { ok: false, reason: "noKeys" };
    }
    await client.push.subscribeWeb({
      endpoint: json.endpoint,
      keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
    });
    return { ok: true };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

/** Best effort: browser unsubscribe + server row removal. Leftover server rows are pruned on 404/410. */
export async function disableWebPush(): Promise<void> {
  try {
    const subscription = await currentSubscription();
    if (!subscription) return;
    const { endpoint } = subscription.toJSON();
    await subscription.unsubscribe();
    if (endpoint) await client.push.unsubscribeWeb({ endpoint });
  } catch {
    // Best effort.
  }
}

/**
 * Live permission + subscription state of this browser. `ready` flips after
 * the first client-side read so prerendered HTML and hydration agree.
 */
export function useWebPush() {
  const [state, setState] = useState<{
    ready: boolean;
    permission: WebPushPermission;
    subscribed: boolean;
  }>({ ready: false, permission: "unsupported", subscribed: false });

  const refresh = useCallback(async () => {
    const subscribed = (await currentSubscription()) !== null;
    setState({ ready: true, permission: webPushPermission(), subscribed });
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { ...state, refresh };
}
