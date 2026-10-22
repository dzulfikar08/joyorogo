import {
  parseSettingsText,
  defaultSettings,
  type AiSettings,
} from "@joyorogo/api/lib/joyo-ai/settings";

/** The storage the store needs (`FileKeyValue` fits; `get` may be sync or async). */
export interface SettingsKv {
  get(key: string): string | null | Promise<string | null>;
  set(key: string, value: string): void | Promise<void>;
  remove(key: string): void | Promise<void>;
}

export const SETTINGS_KEY = "joyorogo.ai.settings";

export interface SettingsSnapshot {
  settings: AiSettings;
  /** The stored settings have been read: before that the defaults show, and nothing may be decided from them. */
  loaded: boolean;
}

/**
 * The Joyo AI settings of this phone: one record (engine, provider, models, consents, ceiling), in a file, never synced. Reads are
 * served from memory; the first `load()` fills it from the file. Updates apply at once and are written behind; a failing disk
 * keeps the session's values and the next launch falls back to what was stored before (which is always the safer, less-consented state).
 */
export function createSettingsStore(kv: SettingsKv) {
  let snapshot: SettingsSnapshot = { settings: defaultSettings, loaded: false };
  let loading: Promise<void> | null = null;
  const listeners = new Set<() => void>();
  const publish = (next: SettingsSnapshot) => {
    snapshot = next;
    for (const listener of listeners) listener();
  };

  const store = {
    getSnapshot: (): SettingsSnapshot => snapshot,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    /** Reads the stored record once; later calls return the same promise. */
    load(): Promise<void> {
      loading ??= (async () => {
        let text: string | null = null;
        try {
          text = await kv.get(SETTINGS_KEY);
        } catch {
          text = null;
        }
        // `update` waits for this read, and `reset` marks the store loaded itself, so only a first read lands here.
        if (!snapshot.loaded) publish({ settings: parseSettingsText(text), loaded: true });
      })();
      return loading;
    },
    /** Changes some settings. Waits for the stored record first, so an early update never overwrites it with defaults. */
    async update(
      patch: Partial<AiSettings> | ((current: AiSettings) => AiSettings | Partial<AiSettings>),
    ): Promise<AiSettings> {
      if (!snapshot.loaded) await store.load();
      const current = snapshot.settings;
      const change = typeof patch === "function" ? patch(current) : patch;
      const next = parseSettingsText(JSON.stringify({ ...current, ...change }));
      publish({ settings: next, loaded: true });
      try {
        await kv.set(SETTINGS_KEY, JSON.stringify(next));
      } catch {
        // Best effort: see above.
      }
      return next;
    },
    /** Back to the defaults (delete everything). */
    async reset(): Promise<void> {
      publish({ settings: defaultSettings, loaded: true });
      loading = Promise.resolve();
      try {
        await kv.remove(SETTINGS_KEY);
      } catch {
        // The file is also removed by the folder delete of "delete everything".
      }
    },
  };
  return store;
}
export type SettingsStore = ReturnType<typeof createSettingsStore>;
