import { isRogoPrefDefault, isRogoPrefKey, ROGO_PREF_KEYS, sanitizeRogoPref, type RogoPrefKey } from "./rogo-prefs";
import {
  remoteWins,
  runSync,
  type LocalState,
  type RecordAdapter,
  type SyncIo,
  type SyncReport,
  type WireRecord,
} from "./sync-engine";

// The phone half of account preference sync, shared by the native app and the web app (packages/api is the one place
// both import): the pref records, the merge with the engine, account binding and the triggers. Each platform supplies
// only storage (`PrefsStore`), the typed oRPC calls (`io`) and how a key is read and written on that device
// (`PrefsBackend`). Keys, sanitizers and the device-specific list: rogo-prefs.ts.

/** A preference as this phone last saw it. `dirty` = changed here, not acknowledged by the server yet. */
export interface PrefItem {
  updatedAt: number;
  deletedAt: number | null;
  dirty: boolean;
  /** `{"value": ...}`; a tombstone keeps `{"value":null}`. */
  json: string;
}

export interface PrefsMeta {
  /** The account the cursor and the items belong to; null until the first sign-in on this device. */
  userId: string | null;
  cursor: number;
  items: Record<string, PrefItem>;
}

export interface PrefsStore {
  read(): Promise<PrefsMeta>;
  /** Persists `meta`; `changed` lists the item keys that were added, changed or removed since the last write. */
  write(meta: PrefsMeta, changed: readonly string[]): Promise<void>;
}

/** Where one device keeps the actual setting behind each key. Writing never marks a key as locally edited. */
export interface PrefsBackend {
  /** The device's current value, or undefined while the setting is at its default / was never chosen. */
  read(key: RogoPrefKey): Promise<unknown | undefined>;
  /** Stores a value received from the account; undefined puts the setting back to its default. */
  write(key: RogoPrefKey, value: unknown | undefined): Promise<void>;
  /** After a sync that changed these keys: tells live consumers (theme, scheduled reminders). */
  applied?(keys: RogoPrefKey[]): Promise<void> | void;
}

export interface PrefsSyncDeps {
  store: PrefsStore;
  io: Pick<SyncIo, "now" | "pull" | "push">;
  /** The backend for the signed-in account (some local keys carry the user id). */
  backend(userId: string): PrefsBackend;
  /** Quiet time after a local edit before it is uploaded. */
  debounceMs?: number;
}

export interface PrefsSync {
  /** The signed-in account that syncs run for; null while signed out (edits then wait, nothing is sent). */
  setUser(userId: string | null): void;
  /** Records a local edit of `key` (already written to the device). Malformed values are ignored. */
  note(key: string, value: unknown): Promise<void>;
  /** Pulls and pushes now. Concurrent calls share one queued run. Null when signed out. */
  sync(): Promise<SyncReport | null>;
  /** Sets the user and syncs, giving up waiting after `timeoutMs` (the sync itself carries on). */
  restore(userId: string, timeoutMs: number): Promise<SyncReport | null>;
  /** Stops syncing (sign-out): drops the pending upload timer. Device values stay as they are. */
  forget(): void;
  /** Edits not acknowledged by the server yet. */
  pending(): Promise<number>;
}

/** `work`'s answer, or null once `ms` passed (the work itself carries on). */
export async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T | null> {
  let stop = () => {};
  const timeout = new Promise<null>((resolve) => {
    const handle = setTimeout(() => resolve(null), ms);
    stop = () => clearTimeout(handle);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    stop();
  }
}

const TOMBSTONE_JSON = '{"value":null}';

/** The `value` of a stored document, or undefined when it is not `{"value": ...}`. */
function docValue(json: string): unknown | undefined {
  try {
    const doc: unknown = JSON.parse(json);
    return typeof doc === "object" && doc !== null && "value" in doc ? doc.value : undefined;
  } catch {
    return undefined;
  }
}

function wire(id: string, item: PrefItem): WireRecord {
  return { kind: "pref", id, json: item.json, updatedAt: item.updatedAt, deletedAt: item.deletedAt, rank: 0 };
}

export function emptyPrefsMeta(): PrefsMeta {
  return { userId: null, cursor: 0, items: {} };
}

export function createPrefsSync(deps: PrefsSyncDeps): PrefsSync {
  const debounceMs = deps.debounceMs ?? 2000;
  let loaded: Promise<PrefsMeta> | null = null;
  let activeUser: string | null = null;
  let cancelTimer = () => {};
  // Runs queue behind each other: one pull+push at a time. `waiting` is the run that has not started yet.
  let tail: Promise<unknown> = Promise.resolve();
  let waiting: Promise<SyncReport | null> | null = null;
  let writes: Promise<void> = Promise.resolve();

  const state = () => (loaded ??= deps.store.read());

  // Persistence is best-effort like every other setting store here: a failed write costs a re-pull, never a crash.
  function persist(meta: PrefsMeta, changed: readonly string[]): Promise<void> {
    writes = writes.then(() => deps.store.write(meta, changed)).catch(() => undefined);
    return writes;
  }

  /**
   * Ties the stored cursor and items to `userId`. The first account on a device adopts what the phone already has
   * (an edit older than any other, so it only fills what the account lacks). A different account starts from its own
   * prefs: this phone's marks and cursor are dropped, never uploaded into it, and its values stay on the phone for
   * keys the account has none for.
   */
  async function bind(meta: PrefsMeta, backend: PrefsBackend, userId: string): Promise<void> {
    if (meta.userId === userId) return;
    const first = meta.userId === null;
    const changed = Object.keys(meta.items);
    meta.userId = userId;
    meta.cursor = 0;
    if (!first) {
      meta.items = {};
    } else {
      for (const key of ROGO_PREF_KEYS) {
        if (meta.items[key]) continue;
        const clean = sanitizeRogoPref(key, await backend.read(key));
        if (clean === undefined || isRogoPrefDefault(key, clean)) continue;
        meta.items[key] = { updatedAt: 0, deletedAt: null, dirty: true, json: JSON.stringify({ value: clean }) };
        changed.push(key);
      }
    }
    await persist(meta, changed);
  }

  function adapter(meta: PrefsMeta, backend: PrefsBackend, applied: Set<RogoPrefKey>): RecordAdapter {
    return {
      kind: "pref",
      async listDirty(limit) {
        return Object.entries(meta.items)
          .filter(([, item]) => item.dirty)
          .slice(0, limit)
          .map(([id, item]) => wire(id, item));
      },
      async markPushed(sent, serverTimes) {
        const changed: string[] = [];
        for (const record of sent) {
          const item = meta.items[record.id];
          // Edited while the request was out: stays dirty and goes in the next push.
          if (!item || item.updatedAt !== record.updatedAt || item.json !== record.json) continue;
          meta.items[record.id] = { ...item, ...serverTimes(record), dirty: false };
          changed.push(record.id);
        }
        await persist(meta, changed);
      },
      async applyRemote(remote, skew) {
        const key = remote.id;
        if (!isRogoPrefKey(key)) return false;
        const known = meta.items[key];
        const local: LocalState | null = known ? { ...wire(key, known), dirty: known.dirty } : null;
        if (!remoteWins(local, remote, skew)) return false;
        let value: unknown | undefined;
        if (remote.deletedAt === null) {
          value = sanitizeRogoPref(key, docValue(remote.json));
          // Not a value this build accepts (a newer app's shape, a bad client): keep what the phone has.
          if (value === undefined) return false;
        }
        meta.items[key] = { updatedAt: remote.updatedAt, deletedAt: remote.deletedAt, dirty: false, json: remote.json };
        await backend.write(key, value);
        applied.add(key);
        await persist(meta, [key]);
        return true;
      },
    };
  }

  async function syncAs(userId: string): Promise<SyncReport> {
    const meta = await state();
    const backend = deps.backend(userId);
    await bind(meta, backend, userId);
    const applied = new Set<RogoPrefKey>();
    const io: SyncIo = {
      ...deps.io,
      getCursor: async () => meta.cursor,
      setCursor: async (cursor) => {
        meta.cursor = cursor;
        await persist(meta, []);
      },
    };
    try {
      return await runSync(io, [adapter(meta, backend, applied)]);
    } finally {
      if (applied.size > 0) await backend.applied?.([...applied]);
    }
  }

  function sync(): Promise<SyncReport | null> {
    if (activeUser === null) return Promise.resolve(null);
    if (waiting) return waiting;
    const run = tail.then(() => {
      waiting = null;
      return activeUser === null ? null : syncAs(activeUser);
    });
    waiting = run;
    tail = run.catch(() => undefined);
    return run;
  }

  function schedule(): void {
    if (activeUser === null) return;
    cancelTimer();
    const handle = setTimeout(() => {
      sync().catch(() => undefined);
    }, debounceMs);
    cancelTimer = () => clearTimeout(handle);
  }

  function setUser(userId: string | null): void {
    activeUser = userId;
    if (userId === null) cancelTimer();
  }

  return {
    setUser,

    async note(key, value) {
      if (!isRogoPrefKey(key)) return;
      const clean = sanitizeRogoPref(key, value);
      if (clean === undefined) return;
      const meta = await state();
      const reset = isRogoPrefDefault(key, clean);
      const json = reset ? TOMBSTONE_JSON : JSON.stringify({ value: clean });
      const previous = meta.items[key];
      if (previous && previous.json === json && (previous.deletedAt === null) === !reset) return;
      const now = deps.io.now();
      meta.items[key] = { updatedAt: now, deletedAt: reset ? now : null, dirty: true, json };
      await persist(meta, [key]);
      schedule();
    },

    sync,

    restore(userId, timeoutMs) {
      setUser(userId);
      return withTimeout(sync().catch(() => null), timeoutMs);
    },

    forget() {
      setUser(null);
    },

    async pending() {
      const meta = await state();
      return Object.values(meta.items).filter((item) => item.dirty).length;
    },
  };
}

// The setters of each setting call `notePrefChanged` after their own write; the platform's sync module binds the sink
// when it is created. Kept apart from the controller so a setter never imports the modules that import the setter.
type PrefNoteSink = (key: string, value: unknown) => Promise<void>;
let sink: PrefNoteSink | null = null;

export function bindPrefNotes(next: PrefNoteSink): void {
  sink = next;
}

export function notePrefChanged(key: string, value: unknown): Promise<void> {
  return sink ? sink(key, value) : Promise.resolve();
}
