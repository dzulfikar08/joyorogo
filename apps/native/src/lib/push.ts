import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

import { i18n } from "@joyorogo/i18n";

import { authClient } from "@/lib/auth-client";
import { client } from "@/utils/orpc";

import { ensureNotificationChannels, getNotificationPermission } from "./notifications";

// Remote push (docs/push.md): the server is the hub, this phone only registers its Expo token. Every path here is
// best effort: an old binary, no EAS project, a simulator, offline or signed out all end in a quiet no-op.

const STORE_KEY = "joyorogo.push.registered.v1";
const REREGISTER_MS = 20 * 60 * 60 * 1000;

const PUSH_CHANNELS = ["social", "group", "meal", "weigh", "recap"] as const;

type Registered = { token: string; userId: string; locale: string; at: number };

let channelsReady: { locale: string; ready: Promise<void> } | null = null;

/** Android channels the server targets (`channelId` = category). Renamed after a language switch. */
export function ensurePushChannels(): Promise<void> {
  if (Platform.OS !== "android") return Promise.resolve();
  const locale = i18n.language;
  if (channelsReady?.locale === locale) return channelsReady.ready;
  const ready = (async () => {
    for (const id of PUSH_CHANNELS) {
      await Notifications.setNotificationChannelAsync(id, {
        name: i18n.t(`notifications:native.channel.${id}.name`),
        description: i18n.t(`notifications:native.channel.${id}.description`),
        importance:
          id === "social" || id === "group"
            ? Notifications.AndroidImportance.HIGH
            : Notifications.AndroidImportance.DEFAULT,
      });
    }
  })().catch((e: unknown) => {
    channelsReady = null;
    throw e;
  });
  channelsReady = { locale, ready };
  return ready;
}

function easProjectId(): string | null {
  const fromConfig: unknown = Constants.expoConfig?.extra?.eas?.projectId;
  const fromEas: unknown = Constants.easConfig?.projectId;
  if (typeof fromConfig === "string" && fromConfig) return fromConfig;
  if (typeof fromEas === "string" && fromEas) return fromEas;
  return null;
}

/** This phone's Expo push token, or null (no project id, no Google services, not granted, simulator, old binary). */
export async function getPushToken(): Promise<string | null> {
  try {
    const projectId = easProjectId();
    if (!projectId) return null;
    if ((await getNotificationPermission()) !== "granted") return null;
    if (typeof Notifications.getExpoPushTokenAsync !== "function") return null;
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
    return typeof data === "string" && data.startsWith("ExponentPushToken[") ? data : null;
  } catch {
    return null;
  }
}

async function readRegistered(): Promise<Registered | null> {
  try {
    const raw = await SecureStore.getItemAsync(STORE_KEY);
    return raw ? (JSON.parse(raw) as Registered) : null;
  } catch {
    return null;
  }
}

async function writeRegistered(value: Registered | null): Promise<void> {
  try {
    if (value) await SecureStore.setItemAsync(STORE_KEY, JSON.stringify(value));
    else await SecureStore.deleteItemAsync(STORE_KEY);
  } catch {
    // storage unavailable: the next start registers again
  }
}

let inFlight: Promise<boolean> | null = null;

/**
 * Registers this phone with the account when notifications are allowed and someone is signed in. Tokens rotate, so
 * it runs on every start/foreground, but skips the call when nothing changed in the last ~day (`force` ignores that,
 * used right after the permission was granted). Returns whether a token is registered. Never throws.
 */
export function registerPush(options: { force?: boolean } = {}): Promise<boolean> {
  inFlight ??= doRegister(options.force === true).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function doRegister(force: boolean): Promise<boolean> {
  try {
    if (Platform.OS !== "android" && Platform.OS !== "ios") return false;
    const session = await authClient.getSession();
    const userId = session.data?.user.id;
    if (!userId) return false;
    if ((await getNotificationPermission()) !== "granted") return false;
    await ensureNotificationChannels().catch(() => {});
    await ensurePushChannels().catch(() => {});
    const token = await getPushToken();
    if (!token) return false;
    const locale = i18n.language;
    const last = await readRegistered();
    const fresh =
      last !== null &&
      last.token === token &&
      last.userId === userId &&
      last.locale === locale &&
      Date.now() - last.at < REREGISTER_MS;
    if (fresh && !force) return true;
    await client.push.registerDevice({
      app: "joyorogo",
      platform: Platform.OS,
      expoToken: token,
      locale,
    });
    await writeRegistered({ token, userId, locale, at: Date.now() });
    return true;
  } catch {
    return false;
  }
}

/** Sign-out: tell the server to stop pushing to this phone (best effort, needs the session, so call it first). */
export async function unregisterPush(): Promise<void> {
  try {
    const last = await readRegistered();
    if (last) await client.push.unregisterDevice({ expoToken: last.token });
  } catch {
    // the server drops dead tokens itself once Expo reports them
  } finally {
    await writeRegistered(null);
  }
}

/** Account deleted: the server rows are gone with it, only the local marker needs to go. */
export function forgetPush(): Promise<void> {
  return writeRegistered(null);
}
