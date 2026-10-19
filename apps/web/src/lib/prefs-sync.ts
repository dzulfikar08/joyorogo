import { parseMakanView } from "@joyorogo/api/lib/diary-view";
import { parseFoodKindFilter } from "@joyorogo/api/lib/food-kind";
import type { RogoPrefKey } from "@joyorogo/api/lib/rogo-prefs";
import {
  bindPrefNotes,
  createPrefsSync,
  emptyPrefsMeta,
  type PrefItem,
  type PrefsBackend,
  type PrefsMeta,
  type PrefsStore,
  withTimeout,
} from "@joyorogo/api/lib/rogo-prefs-sync";
import { THEME_REREAD_EVENT } from "@joyorogo/ui/hooks/use-theme";

import { THEME_STORAGE_KEY } from "@/components/theme-provider";
import { client } from "@/utils/orpc";

import { dismissalStoreKey, writeDismissal } from "./dismissals";
import { readAddBackPref, writeAddBackPref } from "./exercise-credit-prefs";
import { storedKind, storedMakanView, writeMakanPref } from "./makan-prefs";
import { STORY_PREFS_KEY } from "./story-prefs";

// Account preferences in this browser (what is synced and what is not: packages/api/src/lib/rogo-prefs.ts). The
// merge logic is shared with the native app (rogo-prefs-sync.ts); this file is the browser's storage and its setting
// readers and writers. The reminder choices are a native feature: this browser neither reads nor stores them.

const META_KEY = "jrg-prefs-sync";

function readMeta(): PrefsMeta {
  const meta = emptyPrefsMeta();
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(META_KEY) ?? "null");
    if (typeof parsed !== "object" || parsed === null) return meta;
    const { userId, cursor, items } = parsed as Partial<PrefsMeta>;
    meta.userId = typeof userId === "string" ? userId : null;
    meta.cursor = typeof cursor === "number" ? cursor : 0;
    if (typeof items === "object" && items !== null) {
      for (const [key, value] of Object.entries(items)) {
        const item = value as Partial<PrefItem> | null;
        if (
          item &&
          typeof item.updatedAt === "number" &&
          typeof item.json === "string" &&
          typeof item.dirty === "boolean" &&
          (item.deletedAt === null || typeof item.deletedAt === "number")
        ) {
          meta.items[key] = { updatedAt: item.updatedAt, deletedAt: item.deletedAt, dirty: item.dirty, json: item.json };
        }
      }
    }
  } catch {
    // Unreadable or blocked storage: start from nothing; the account has the data.
  }
  return meta;
}

const store: PrefsStore = {
  read: async () => readMeta(),
  write: async (meta) => {
    try {
      localStorage.setItem(META_KEY, JSON.stringify(meta));
    } catch {
      // Private mode / quota: a lost write costs one more pull, never data.
    }
  },
};

/** The theme is stored as a bare word, not JSON. */
function readText(key: string): string | undefined {
  try {
    return localStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

function readJson(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null");
  } catch {
    return null;
  }
}

function readDevice(key: RogoPrefKey, userId: string): unknown | undefined {
  switch (key) {
    case "theme":
      return readText(THEME_STORAGE_KEY);
    case "makan.view":
      return storedMakanView();
    case "makan.kind":
      return storedKind();
    case "sticker":
      return readJson(STORY_PREFS_KEY) ?? undefined;
    case "dismissed.handlePrompt":
    case "dismissed.stravaRetention7d":
    case "dismissed.energyModel":
      return localStorage.getItem(dismissalStoreKey(key, userId)) === "1" ? true : undefined;
    case "exercise.addBack.enabled":
    case "exercise.addBack.pct":
    case "exercise.addBack.cap":
      return readAddBackPref(key);
    case "reminders":
      return undefined;
  }
}

function writeDevice(key: RogoPrefKey, userId: string, value: unknown | undefined): void {
  try {
    switch (key) {
      case "theme":
        if (value === undefined) localStorage.removeItem(THEME_STORAGE_KEY);
        else localStorage.setItem(THEME_STORAGE_KEY, String(value));
        return;
      case "makan.view":
        writeMakanPref("view", parseMakanView(value));
        return;
      case "makan.kind":
        writeMakanPref("kind", parseFoodKindFilter(value));
        return;
      case "sticker":
        if (value === undefined) localStorage.removeItem(STORY_PREFS_KEY);
        else localStorage.setItem(STORY_PREFS_KEY, JSON.stringify(value));
        return;
      case "dismissed.handlePrompt":
      case "dismissed.stravaRetention7d":
      case "dismissed.energyModel":
        writeDismissal(key, userId, value === true);
        return;
      case "exercise.addBack.enabled":
      case "exercise.addBack.pct":
      case "exercise.addBack.cap":
        writeAddBackPref(key, value);
        return;
      case "reminders":
        return;
    }
  } catch {
    // Storage blocked: the account keeps the value.
  }
}

function backend(userId: string): PrefsBackend {
  return {
    read: async (key) => readDevice(key, userId),
    write: async (key, value) => writeDevice(key, userId, value),
    // The theme provider is on screen: it reads the stored choice again. Everything else is read when it mounts next.
    applied: (keys) => {
      if (keys.includes("theme")) window.dispatchEvent(new Event(THEME_REREAD_EVENT));
    },
  };
}

const RESTORE_WAIT_MS = 4000;

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

/** Sign-out: the browser keeps its settings but stops syncing them. */
export const forgetPrefsSync = prefsSync.forget;

/** Before sign-out (the session is still valid): uploads edits that are still waiting for their quiet time. */
export async function flushPrefsSync(): Promise<void> {
  await withTimeout(prefsSync.sync().catch(() => null), 3000);
}

/** Sign-in: the account's preferences are applied before the app opens, for at most `RESTORE_WAIT_MS`. */
export async function restoreAccountPrefs(userId: string): Promise<void> {
  await prefsSync.restore(userId, RESTORE_WAIT_MS);
}
