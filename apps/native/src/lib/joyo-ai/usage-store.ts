import { recordUsage, todayUsage, type UsageState } from "@joyorogo/api/lib/joyo-ai/usage";
import type { Usage } from "@joyorogo/api/lib/joyo-ai/types";

import type { SettingsKv } from "./settings-store";

export const USAGE_KEY = "joyorogo.ai.usage";

/** The calendar day of this device, `YYYY-MM-DD`: the own-key daily ceiling resets at the person's local midnight. */
export function localDay(ms: number): string {
  const d = new Date(ms);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/**
 * The calls and tokens spent today with the person's own key, counted on this phone only (the provider's `usage`, not an estimate
 * of money). Calls are counted in memory at once and written behind, so two quick calls never read a stale file.
 */
export function createUsageStore(kv: SettingsKv, now: () => number = Date.now) {
  let state: UsageState | null = null;
  let loading: Promise<UsageState> | null = null;
  const listeners = new Set<() => void>();
  const read = (): Promise<UsageState> => {
    loading ??= (async () => {
      let raw: unknown = null;
      try {
        const text = await kv.get(USAGE_KEY);
        raw = text === null ? null : JSON.parse(text);
      } catch {
        raw = null;
      }
      state = todayUsage(raw, localDay(now()));
      return state;
    })();
    return loading;
  };
  return {
    /** Today's usage (zero when the stored day is another). */
    async today(): Promise<UsageState> {
      const stored = await read();
      return todayUsage(state ?? stored, localDay(now()));
    },
    /** Today's count as far as memory knows (zero before the first read): the sync check in front of a provider call. */
    peek(): UsageState {
      return todayUsage(state, localDay(now()));
    },
    /** Counts one provider call, with its tokens when the provider reported them. */
    async record(usage: Usage | null): Promise<UsageState> {
      // Once read, the count changes in the same tick as the call (no await first), so the next ceiling check sees it.
      if (state === null) await read();
      state = recordUsage(state, localDay(now()), usage);
      for (const listener of listeners) listener();
      try {
        await kv.set(USAGE_KEY, JSON.stringify(state));
      } catch {
        // The count of this session stays.
      }
      return state;
    },
    async clear(): Promise<void> {
      state = todayUsage(null, localDay(now()));
      loading = Promise.resolve(state);
      for (const listener of listeners) listener();
      try {
        await kv.remove(USAGE_KEY);
      } catch {
        // Removed with the folder.
      }
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}
export type UsageStore = ReturnType<typeof createUsageStore>;
