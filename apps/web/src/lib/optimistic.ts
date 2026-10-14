import { jakartaToday } from "@joyorogo/api/lib/engine";
import {
  DELETE_COMMIT_MS,
  UNDO_LABEL,
  UNDO_TOAST_MS,
  applySummaryDelta,
  applyWeightCheckIn,
  deletedMsg,
  removeById,
  upsertById,
  type SummaryDelta,
} from "@joyorogo/api/lib/optimistic";

export { UNDO_LABEL, UNDO_TOAST_MS, DELETE_COMMIT_MS };
import type { AppRouterClient } from "@joyorogo/api/routers/index";
import {
  useMutation,
  useQueryClient,
  type QueryClient,
  type QueryKey,
  type UseMutationResult,
} from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

import { client } from "@/utils/orpc";

export type Snapshot = { restore(): void };

/** The food.listByDate cache shape this helper family patches. */
export type FoodListData<T extends { kcal: number; protein?: number | null; carbs?: number | null; fat?: number | null; fiber?: number | null }> = {
  items: T[];
  totals: { kcal: number; protein: number; carbs: number; fat: number; fiber: number };
};

/** Land a row in one food.listByDate cache and lift the rendered totals. */
export function insertFoodRow<T extends { id: string } & { kcal: number; protein?: number | null; carbs?: number | null; fat?: number | null; fiber?: number | null }>(
  cache: OptimisticCache,
  listKey: QueryKey,
  row: T,
): void {
  cache.value<FoodListData<T>>(listKey, (old) =>
    old
      ? {
          ...old,
          items: upsertById(old.items, row),
          totals: {
            kcal: old.totals.kcal + row.kcal,
            protein: old.totals.protein + (row.protein ?? 0),
            carbs: old.totals.carbs + (row.carbs ?? 0),
            fat: old.totals.fat + (row.fat ?? 0),
            fiber: old.totals.fiber + (row.fiber ?? 0),
          },
        }
      : old,
  );
}

/** Strip one row from a food.listByDate cache, pulling totals down with it. */
export function stripFoodRow<T extends { id: string; kcal: number; protein?: number | null; carbs?: number | null; fat?: number | null; fiber?: number | null }>(
  cache: OptimisticCache,
  listKey: QueryKey,
  row: T,
): void {
  cache.value<FoodListData<T>>(listKey, (old) => {
    if (!old || !old.items.some((item) => item.id === row.id)) return old;
    return {
      ...old,
      items: removeById(old.items, row.id),
      totals: {
        kcal: Math.max(0, old.totals.kcal - row.kcal),
        protein: Math.max(0, old.totals.protein - (row.protein ?? 0)),
        carbs: Math.max(0, old.totals.carbs - (row.carbs ?? 0)),
        fat: Math.max(0, old.totals.fat - (row.fat ?? 0)),
        fiber: Math.max(0, old.totals.fiber - (row.fiber ?? 0)),
      },
    };
  });
}

type RestoreFn = () => void;

/** Minimal infinite-query cache shape this helper patches (row accessor decides page internals). */
type InfiniteData = { pages: unknown[]; pageParams: unknown[] };

/** Default page shape: `{ items: T[] }`; Array.isArray validates before the row cast. */
function defaultPageRows<P extends object, T>(page: P): T[] {
  if ("items" in page && Array.isArray(page.items)) {
    const rows: T[] = page.items;
    return rows;
  }
  return [];
}

/**
 * Collects optimistic cache patches; snapshot().restore() puts every patched
 * key back. In-flight fetches for patched keys are cancelled (fire-and-forget)
 * so a racing refetch doesn't clobber the patch before settle invalidates.
 */
export class OptimisticCache {
  private client: QueryClient;
  private restores: RestoreFn[] = [];

  constructor(queryClient: QueryClient) {
    this.client = queryClient;
  }

  private patch<T>(key: QueryKey, update: (old: T | undefined) => T | undefined): void {
    const previous = this.client.getQueryData<T>(key);
    void this.client.cancelQueries({ queryKey: key });
    this.client.setQueryData<T>(key, (old) => update(old));
    this.restores.push(() => this.client.setQueryData(key, previous));
  }

  /** Flat-array caches. */
  list<T>(key: QueryKey, update: (rows: T[]) => T[]): void {
    this.patch<T[]>(key, (old) => update(old ?? []));
  }

  /**
   * Infinite-query caches: applies `update` to the row array of every page.
   * `pickRows` reads rows out of one page (defaults to `{ items }` pages —
   * pass an accessor when the page shape differs).
   */
  eachPage<T, P extends object>(
    key: QueryKey,
    update: (rows: T[]) => T[],
    pickRows: (page: P) => T[] = defaultPageRows,
  ): void {
    this.patch<InfiniteData>(key, (old) => {
      if (!old) return old;
      const pages = (old.pages as P[]).map((page) => {
        const rows = pickRows(page);
        const next = update(rows);
        return next === rows ? page : { ...page, items: next };
      });
      return { ...old, pages };
    });
  }

  /** Arbitrary object caches (water.today, settings, session, ...). */
  value<T>(key: QueryKey, update: (old: T | undefined) => T | undefined): void {
    this.patch<T>(key, update);
  }

  /**
   * Every cache whose key starts with `prefix` (e.g. all feed tab variants):
   * `update` transforms the whole cached value; untouched data passes through.
   */
  matching<T>(prefix: QueryKey, update: (old: T) => T): void {
    void this.client.cancelQueries({ queryKey: prefix });
    const matches = this.client.getQueriesData<T>({ queryKey: prefix });
    for (const [key, previous] of matches) {
      this.client.setQueryData<T>(key, (old) => (old ? update(old) : old));
      this.restores.push(() => this.client.setQueryData(key, previous));
    }
  }

  /** Every cached day.summary (any date) gets the food/exercise/sleep delta. */
  summary(delta: SummaryDelta): void {
    const today = jakartaToday();
    const matches = this.client.getQueriesData({ queryKey: [["day", "summary"]] });
    for (const [key, previous] of matches) {
      this.client.setQueryData(key, (old: unknown) =>
        old ? applySummaryDelta(old as never, delta, today) : old,
      );
      this.restores.push(() => this.client.setQueryData(key, previous));
    }
  }

  /** Weigh-in on every cached day.summary. */
  weight(delta: { date: string; weightKg: number }): void {
    const today = jakartaToday();
    const matches = this.client.getQueriesData({ queryKey: [["day", "summary"]] });
    for (const [key, previous] of matches) {
      this.client.setQueryData(key, (old: unknown) =>
        old ? applyWeightCheckIn(old as never, delta, today) : old,
      );
      this.restores.push(() => this.client.setQueryData(key, previous));
    }
  }

  snapshot(): Snapshot {
    const restores = this.restores;
    this.restores = [];
    return {
      restore: () => {
        for (const restore of [...restores].reverse()) restore();
      },
    };
  }
}

/**
 * Core optimistic mutation: onMutate cancel+patch+snapshot; onError restore +
 * toast.error; onSuccess optional toast (with an Urungkan action when the
 * call site supplies an undo); onSettled invalidate keys.
 */
export function useOptimisticMutation<TInput, TData>(config: {
  mutationFn: (input: TInput) => Promise<TData>;
  patch?: (input: TInput, cache: OptimisticCache) => void;
  invalidate?: (input: TInput, data: TData | undefined) => readonly QueryKey[];
  success?: (
    input: TInput,
    data: TData,
  ) => { message: string; undo?: () => void } | undefined;
  onError?: (error: Error, input: TInput) => void;
}): UseMutationResult<TData, Error, TInput, Snapshot> {
  const queryClient = useQueryClient();
  return useMutation<TData, Error, TInput, Snapshot>({
    mutationFn: config.mutationFn,
    onMutate: (input) => {
      const cache = new OptimisticCache(queryClient);
      config.patch?.(input, cache);
      return cache.snapshot();
    },
    onError: (error, input, snapshot) => {
      snapshot?.restore();
      toast.error(error.message);
      config.onError?.(error, input);
    },
    onSuccess: (data, input) => {
      const s = config.success?.(input, data);
      if (!s) return;
      if (s.undo) {
        toast.success(s.message, {
          duration: UNDO_TOAST_MS,
          action: { label: UNDO_LABEL, onClick: s.undo },
        });
      } else {
        toast.success(s.message);
      }
    },
    onSettled: (data, _error, input) => {
      for (const key of config.invalidate?.(input, data) ?? []) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    },
  });
}

type PendingDelete<TRow> = {
  timer: ReturnType<typeof setTimeout>;
  snapshot: Snapshot;
  row: TRow;
};

/**
 * Delayed-commit delete: the row vanishes immediately via `patch`, the real
 * DELETE only fires after the undo window. Undo restores the snapshot and
 * never talks to the server; a commit failure restores and toasts the error;
 * unmount flushes every pending commit so nothing is silently dropped.
 * Concurrent deletes are independent (keyed by row id); undoing after the
 * commit has started is a no-op.
 */
export function useDelayedDelete<TRow extends { id: string }>(config: {
  remove: (row: TRow) => Promise<unknown>;
  patch: (row: TRow, cache: OptimisticCache) => void;
  label: (row: TRow) => string;
  fallback?: string;
  invalidate?: (row: TRow) => readonly QueryKey[];
}): (row: TRow) => void {
  const queryClient = useQueryClient();
  const configRef = useRef(config);
  configRef.current = config;
  const pending = useRef(new Map<string, PendingDelete<TRow>>());

  useEffect(
    () => () => {
      for (const entry of pending.current.values()) {
        clearTimeout(entry.timer);
        void configRef.current.remove(entry.row).catch(() => {});
      }
      pending.current.clear();
    },
    [],
  );

  return (row: TRow) => {
    const cache = new OptimisticCache(queryClient);
    configRef.current.patch(row, cache);
    const snapshot = cache.snapshot();
    const entry: PendingDelete<TRow> = { timer: null as never, snapshot, row };
    entry.timer = setTimeout(() => {
      if (pending.current.get(row.id) !== entry) return;
      pending.current.delete(row.id);
      void configRef.current
        .remove(row)
        .then(() => {
          for (const key of configRef.current.invalidate?.(row) ?? []) {
            void queryClient.invalidateQueries({ queryKey: key });
          }
        })
        .catch((error: unknown) => {
          snapshot.restore();
          toast.error(error instanceof Error ? error.message : String(error));
        });
    }, DELETE_COMMIT_MS);
    pending.current.set(row.id, entry);
    toast.success(deletedMsg(configRef.current.label(row), configRef.current.fallback), {
      duration: UNDO_TOAST_MS,
      action: {
        label: UNDO_LABEL,
        onClick: () => {
          const current = pending.current.get(row.id);
          if (!current || current !== entry) return;
          clearTimeout(entry.timer);
          entry.snapshot.restore();
          pending.current.delete(row.id);
        },
      },
    });
  };
}

/* ---- Check-in family hooks (weight / waist) shared by Beranda, Berat, Profil ---- */

type WeightCheckInInput = Parameters<AppRouterClient["weight"]["checkIn"]>[0];
type WeightCheckInRow = Awaited<ReturnType<AppRouterClient["weight"]["checkIn"]>>;
type WaistCheckInInput = Parameters<AppRouterClient["waist"]["checkIn"]>[0];
type WaistCheckInRow = Awaited<ReturnType<AppRouterClient["waist"]["checkIn"]>>;

type HistoryData<E> = { entries: E[] };

/** Latest kg recorded for `date` across every cached weight.history variant. */
function cachedWeightKg(queryClient: QueryClient, date: string): number | null {
  const histories = queryClient.getQueriesData<HistoryData<{ id: string; date: string; weightKg: number }>>(
    { queryKey: [["weight", "history"]] },
  );
  for (const [, data] of histories) {
    const hit = data?.entries.find((entry) => entry.date === date);
    if (hit) return hit.weightKg;
  }
  return null;
}

/** Upserts one entry (matched by date, keeping the cached row id) in every weight.history cache. */
function upsertWeightEntries(
  queryClient: QueryClient,
  row: { date: string; weightKg: number },
): void {
  const histories = queryClient.getQueriesData<HistoryData<{ id: string; date: string; weightKg: number }>>(
    { queryKey: [["weight", "history"]] },
  );
  for (const [key, data] of histories) {
    queryClient.setQueryData(key, (old: typeof data) => {
      if (!old) return old;
      const existing = old.entries.find((entry) => entry.date === row.date);
      const next = upsertById(old.entries, { ...existing, ...row, id: existing?.id ?? crypto.randomUUID() });
      return { ...old, entries: next };
    });
  }
}

/** Optimistic weigh-in shared by every weight check-in UI: history caches get
 * the upserted row, every day.summary gets latestWeight/weightLoggedToday.
 * Undo re-checks-in the previous kg when the cache had one for that date. */
export function useWeightCheckIn(
  message: string | ((row: NonNullable<WeightCheckInRow>) => string) = "Berat dicatat",
): UseMutationResult<WeightCheckInRow, Error, WeightCheckInInput> {
  const queryClient = useQueryClient();
  const previousKg = useRef<number | null>(null);
  return useOptimisticMutation<WeightCheckInInput, WeightCheckInRow>({
    mutationFn: (input) => client.weight.checkIn(input),
    patch: (input, cache) => {
      const date = input.date ?? jakartaToday();
      previousKg.current = cachedWeightKg(queryClient, date);
      upsertWeightEntries(queryClient, { date, weightKg: input.weightKg });
      cache.weight({ date, weightKg: input.weightKg });
    },
    invalidate: () => [["weight"], ["day"], ["profile"]],
    success: (input, row) => {
      if (!row) return undefined;
      const prev = previousKg.current;
      previousKg.current = null;
      const text = typeof message === "function" ? message(row) : message;
      if (prev === null || prev === row.weightKg) return { message: text };
      return {
        message: text,
        undo: () => void client.weight.checkIn({ weightKg: prev, date: row.date }),
      };
    },
  });
}

/** Latest cm recorded for `date` across every cached waist.history variant. */
function cachedWaistCm(queryClient: QueryClient, date: string): number | null {
  const histories = queryClient.getQueriesData<HistoryData<{ id: string; date: string; waistCm: number }>>(
    { queryKey: [["waist", "history"]] },
  );
  for (const [, data] of histories) {
    const hit = data?.entries.find((entry) => entry.date === date);
    if (hit) return hit.waistCm;
  }
  return null;
}

/** Upserts one entry (matched by date, keeping the cached row id) in every waist.history cache. */
function upsertWaistEntries(
  queryClient: QueryClient,
  row: { date: string; waistCm: number },
): void {
  const histories = queryClient.getQueriesData<HistoryData<{ id: string; date: string; waistCm: number }>>(
    { queryKey: [["waist", "history"]] },
  );
  for (const [key, data] of histories) {
    queryClient.setQueryData(key, (old: typeof data) => {
      if (!old) return old;
      const existing = old.entries.find((entry) => entry.date === row.date);
      const next = upsertById(old.entries, { ...existing, ...row, id: existing?.id ?? crypto.randomUUID() });
      return { ...old, entries: next };
    });
  }
}

/** Optimistic waist check-in, mirroring useWeightCheckIn (undo = previous cm). */
export function useWaistCheckIn(
  message: string | ((row: NonNullable<WaistCheckInRow>) => string) = "Lingkar perut dicatat",
): UseMutationResult<WaistCheckInRow, Error, WaistCheckInInput> {
  const queryClient = useQueryClient();
  const previousCm = useRef<number | null>(null);
  return useOptimisticMutation<WaistCheckInInput, WaistCheckInRow>({
    mutationFn: (input) => client.waist.checkIn(input),
    patch: (input, cache) => {
      const date = input.date ?? jakartaToday();
      previousCm.current = cachedWaistCm(queryClient, date);
      upsertWaistEntries(queryClient, { date, waistCm: input.waistCm });
    },
    invalidate: () => [["waist"]],
    success: (input, row) => {
      if (!row) return undefined;
      const prev = previousCm.current;
      previousCm.current = null;
      const text = typeof message === "function" ? message(row) : message;
      if (prev === null || prev === row.waistCm) return { message: text };
      return {
        message: text,
        undo: () => void client.waist.checkIn({ waistCm: prev, date: row.date }),
      };
    },
  });
}
