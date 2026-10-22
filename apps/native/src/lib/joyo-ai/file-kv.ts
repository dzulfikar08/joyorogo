/**
 * The key-value store behind the Joyo AI conversations and settings on this phone: one small file per key, in the app's own
 * documents folder. Not SecureStore (about 2 KB per value; a conversation is far larger) and never read by any sync code.
 * The file access is injected (`FileIo`) so the logic runs in tests without the native module; `native-io.ts` binds it.
 */
export interface FileIo {
  read(name: string): Promise<string | null>;
  write(name: string, text: string): Promise<void>;
  remove(name: string): Promise<void>;
  /** Every file this store ever wrote. */
  clear(): Promise<void>;
}

/** The shape Core's conversation store takes (`get` may be async). */
export interface FileKeyValue {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  /** Drops every key (delete everything). */
  clear(): Promise<void>;
}

/** A key as a file name: percent-encoded, so any key is safe on every file system and two keys never share a file. */
export const fileNameOf = (key: string): string =>
  `${encodeURIComponent(key).replace(/\./g, "%2E")}.json`;

/**
 * Reads see the latest write at once (a cache of what this run wrote or read); writes and removals of the same store are applied
 * one after the other, so a quick set-then-remove never leaves the old value behind. A failing disk is the caller's catch: the
 * cache still holds the value for this session.
 */
export function createFileKeyValue(io: FileIo): FileKeyValue {
  const cache = new Map<string, string | null>();
  let queue: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(job: () => Promise<T>): Promise<T> => {
    const run = queue.then(job, job);
    queue = run.catch(() => undefined);
    return run;
  };
  return {
    async get(key) {
      if (cache.has(key)) return cache.get(key) ?? null;
      // Let pending writes land first, so a read after a write sees the write even if the cache was bypassed by `clear`.
      await queue;
      if (cache.has(key)) return cache.get(key) ?? null;
      const value = await io.read(fileNameOf(key));
      if (!cache.has(key)) cache.set(key, value);
      return cache.get(key) ?? null;
    },
    set(key, value) {
      cache.set(key, value);
      return enqueue(() => io.write(fileNameOf(key), value));
    },
    remove(key) {
      cache.set(key, null);
      return enqueue(() => io.remove(fileNameOf(key)));
    },
    clear() {
      cache.clear();
      return enqueue(() => io.clear());
    },
  };
}
