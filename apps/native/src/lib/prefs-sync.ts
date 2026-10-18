import { isLocale } from "@joyorogo/i18n";
import { ROGO_PREF_KEYS, type RogoPrefKey } from "@joyorogo/api/lib/rogo-prefs";
import {
  bindPrefNotes,
  createPrefsSync,
  emptyPrefsMeta,
  withTimeout,
  type PrefItem,
  type PrefsBackend,
  type PrefsStore,
} from "@joyorogo/api/lib/rogo-prefs-sync";
import { DEFAULT_REMINDER_CONFIG, type ReminderConfig } from "@joyorogo/api/lib/reminder-config";
import * as SecureStore from "expo-secure-store";

import { DEFAULT_STICKER_PREFS, loadStickerPrefs, writeStickerPrefs } from "@/components/sticker/prefs";
import { client, orpc, queryClient } from "@/utils/orpc";

import { readDismissal, writeDismissal } from "./dismissals";
import { readAddBackPref, writeAddBackPref } from "./exercise-credit-prefs";
import { setLocale } from "./i18n";
import { loadMakanPrefs, writeMakanPref } from "./makan-prefs";
import { readStoredReminderConfig, rescheduleAll, writeReminderConfig } from "./notifications";
import { applyThemePref, loadThemePref, writeThemePref } from "./theme-pref";

// Account preferences on this phone (what is synced and what is not: packages/api/src/lib/rogo-prefs.ts). The merge
// logic is shared with the web app (rogo-prefs-sync.ts); this file is the phone's storage, its setting readers and
// writers, and the triggers.

/** How long the sign-in screen waits for the account's preferences before moving on. */
const RESTORE_WAIT_MS = 4000;

/** How long sign-out waits to upload the last edits. */
const FLUSH_WAIT_MS = 3000;

// One SecureStore entry per item plus a small header: SecureStore values are meant to stay small, and the reminder
// config alone is most of a kilobyte.
const HEADER_KEY = "joyorogo.sync.meta.v1";
const itemKey = (key: string) => `joyorogo.sync.item.v1.${key}`;

type Header = { userId: string | null; cursor: number };

async function readJson(key: string): Promise<unknown> {
  try {
    const raw = await SecureStore.getItemAsync(key);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}

function toItem(value: unknown): PrefItem | null {
  if (typeof value !== "object" || value === null) return null;
  const { updatedAt, deletedAt, dirty, json } = value as Record<string, unknown>;
  if (typeof updatedAt !== "number" || typeof json !== "string" || typeof dirty !== "boolean") return null;
  if (deletedAt !== null && typeof deletedAt !== "number") return null;
  return { updatedAt, deletedAt, dirty, json };
}

const store: PrefsStore = {
  async read() {
    const header = (await readJson(HEADER_KEY)) as Partial<Header> | null;
    const meta = emptyPrefsMeta();
    meta.userId = typeof header?.userId === "string" ? header.userId : null;
    meta.cursor = typeof header?.cursor === "number" ? header.cursor : 0;
    const items = await Promise.all(ROGO_PREF_KEYS.map(async (key) => [key, toItem(await readJson(itemKey(key)))] as const));
    for (const [key, item] of items) if (item) meta.items[key] = item;
    return meta;
  },

  async write(meta, changed) {
    try {
      const header: Header = { userId: meta.userId, cursor: meta.cursor };
      await SecureStore.setItemAsync(HEADER_KEY, JSON.stringify(header));
      for (const key of changed) {
        const item = meta.items[key];
        if (item) await SecureStore.setItemAsync(itemKey(key), JSON.stringify(item));
        else await SecureStore.deleteItemAsync(itemKey(key));
      }
    } catch {
      // Best-effort: a lost write costs one more pull, never data.
    }
  },
};

async function readDevice(key: RogoPrefKey, userId: string): Promise<unknown | undefined> {
  switch (key) {
    case "theme":
      return loadThemePref();
    case "reminders":
      return readStoredReminderConfig();
    case "makan.view":
      return (await loadMakanPrefs()).view;
    case "makan.kind":
      return (await loadMakanPrefs()).kind;
    case "sticker":
      return loadStickerPrefs();
    case "exercise.addBack.enabled":
    case "exercise.addBack.pct":
    case "exercise.addBack.cap":
    case "exercise.assumedActive":
      return readAddBackPref(key);
    case "dismissed.handlePrompt":
    case "dismissed.stravaRetention7d":
    case "dismissed.addBackNotice2":
      return (await readDismissal(key, userId)) ? true : undefined;
  }
}

async function writeDevice(key: RogoPrefKey, userId: string, value: unknown | undefined): Promise<void> {
  switch (key) {
    case "theme":
      return writeThemePref(value as "light" | "dark" | "system" | undefined);
    case "reminders":
      // A reset stores the stock config explicitly: with nothing stored the screen would fall back to the legacy flags.
      return writeReminderConfig((value as ReminderConfig | undefined) ?? DEFAULT_REMINDER_CONFIG);
    case "makan.view":
      return writeMakanPref("view", value as string | undefined);
    case "makan.kind":
      return writeMakanPref("kind", value as string | undefined);
    case "sticker":
      return writeStickerPrefs((value as typeof DEFAULT_STICKER_PREFS | undefined) ?? DEFAULT_STICKER_PREFS);
    case "exercise.addBack.enabled":
    case "exercise.addBack.pct":
    case "exercise.addBack.cap":
    case "exercise.assumedActive":
      return writeAddBackPref(key, value);
    case "dismissed.handlePrompt":
    case "dismissed.stravaRetention7d":
    case "dismissed.addBackNotice2":
      return writeDismissal(key, userId, value === true);
  }
}

function backend(userId: string): PrefsBackend {
  return {
    read: (key) => readDevice(key, userId),
    write: (key, value) => writeDevice(key, userId, value),
    async applied(keys) {
      // The theme is on screen right now; the reminder choices need new notifications. Everything else (makan view,
      // sticker options, dismissals) is read when its screen mounts next.
      if (keys.includes("theme")) applyThemePref(await loadThemePref());
      // Never asks for permission: without it nothing is scheduled and the choices wait.
      if (keys.includes("reminders")) await rescheduleAll();
    },
  };
}

const prefsSync = createPrefsSync({
  store,
  io: {
    now: Date.now,
    pull: (since) => client.sync.pull({ ns: "rogo", since }),
    push: (clientNow, records) => client.sync.push({ ns: "rogo", clientNow, records }),
  },
  backend,
});

bindPrefNotes(prefsSync.note);

export const startPrefsSync = prefsSync.setUser;
export const syncPrefs = prefsSync.sync;
export const prefsPending = prefsSync.pending;

/** Sign-out: the phone keeps its settings (they are device settings too) but stops syncing them. */
export const forgetPrefsSync = prefsSync.forget;

/** Before sign-out (the session is still valid): uploads edits that are still waiting for their quiet time. */
export async function flushPrefsSync(): Promise<void> {
  await withTimeout(prefsSync.sync().catch(() => null), FLUSH_WAIT_MS);
}

/** The saved account language, applied now (the late-applied path is components/locale-sync.tsx). */
async function applyAccountLocale(): Promise<void> {
  const data = await queryClient.fetchQuery(orpc.profile.myProfile.queryOptions());
  const locale = data.profile?.locale;
  if (isLocale(locale)) await setLocale(locale);
}

/**
 * Sign-in: the account's preferences and language are on this phone before the first screen. Never waits longer
 * than `RESTORE_WAIT_MS`; whatever is still running finishes in the background.
 */
export async function restoreAccountPrefs(userId: string): Promise<void> {
  await withTimeout(
    Promise.all([prefsSync.restore(userId, RESTORE_WAIT_MS), applyAccountLocale().catch(() => undefined)]),
    RESTORE_WAIT_MS,
  );
}
