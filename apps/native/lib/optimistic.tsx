import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  QueryClient,
  QueryKey,
  UseMutationResult,
} from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";

import {
  DELETE_COMMIT_MS,
  undoLabel,
  UNDO_TOAST_MS,
  applySummaryDelta,
  applyWeightCheckIn,
  deletedMsg,
  type DaySummaryLike,
  type SummaryDelta,
} from "@joyorogo/api/lib/optimistic";
import { jakartaToday } from "@joyorogo/api/lib/engine";
import { i18n } from "@joyorogo/i18n";

import { useToast } from "@/components/toast";
import { errorMessage } from "@/utils/format";

export type Snapshot = { restore(): void };

type UndoEntry<TRow> = {
  row: TRow;
  committed: boolean;
  restore(): void;
  timer: ReturnType<typeof setTimeout>;
};

/**
 * Collects optimistic cache patches for one mutation attempt. Every patch
 * cancels in-flight fetches for the keys it touches (so a landing response
 * never overwrites the optimistic value) and remembers the previous value.
 */
export class OptimisticCache {
  private qc: QueryClient;
  private restores: Array<() => void> = [];

  constructor(queryClient: QueryClient) {
    this.qc = queryClient;
  }

  /** Flat-array caches (food.listByDate, exercise lists, feeds...). */
  list<T>(key: QueryKey, update: (rows: T[]) => T[]): void {
    const old = this.qc.getQueryData<T[]>(key);
    const next = update(old ?? []);
    void this.qc.cancelQueries({ queryKey: key });
    this.qc.setQueryData(key, next);
    this.restores.push(() => {
      if (old === undefined) this.qc.removeQueries({ queryKey: key });
      else this.qc.setQueryData(key, old);
    });
  }

  /** Object caches (water.today, session, plate.byDate...). */
  value<T>(key: QueryKey, update: (old: T | undefined) => T | undefined): void {
    const old = this.qc.getQueryData<T>(key);
    const next = update(old);
    void this.qc.cancelQueries({ queryKey: key });
    this.qc.setQueryData(key, next);
    this.restores.push(() => {
      if (old === undefined) this.qc.removeQueries({ queryKey: key });
      else this.qc.setQueryData(key, old);
    });
  }

  /** Every cached day summary, any date, prefix [["day","summary"]]. */
  summary(delta: SummaryDelta): void {
    this.patchSummaries((summary) => applySummaryDelta(summary, delta, jakartaToday()));
  }

  /** Weigh-in math on every cached day summary. */
  weight(delta: { date: string; weightKg: number }): void {
    this.patchSummaries((summary) => applyWeightCheckIn(summary, delta, jakartaToday()));
  }

  private patchSummaries(patch: (summary: DaySummaryLike) => DaySummaryLike): void {
    const queries = this.qc.getQueryCache().findAll({ queryKey: [["day", "summary"]] });
    const old = new Map<QueryKey, DaySummaryLike>();
    for (const query of queries) {
      const current = query.state.data as DaySummaryLike | undefined;
      if (current === undefined) continue;
      old.set(query.queryKey, current);
      void this.qc.cancelQueries({ queryKey: query.queryKey });
      this.qc.setQueryData(query.queryKey, patch(current));
    }
    this.restores.push(() => {
      for (const [key, value] of old) this.qc.setQueryData(key, value);
    });
  }

  /** One restore-everything handle for onError and delete undo. */
  snapshot(): Snapshot {
    const restores = [...this.restores];
    return {
      restore: () => {
        for (const restore of restores.reverse()) restore();
      },
    };
  }
}

/**
 * Core optimistic mutation: patch the cache instantly, roll back + error
 * toast on failure, optional undoable success toast, targeted invalidates
 * once the request settles.
 */
export function useOptimisticMutation<TInput, TData, TContext = void>(config: {
  mutationFn: (input: TInput) => Promise<TData>;
  patch?: (input: TInput, cache: OptimisticCache) => TContext;
  invalidate?: (input: TInput, data: TData | undefined) => readonly QueryKey[];
  success?: (
    input: TInput,
    data: TData,
    context: TContext | undefined,
  ) => { message: string; undo?: () => void } | undefined;
  onError?: (error: Error, input: TInput) => void;
}): UseMutationResult<TData, Error, TInput> {
  const queryClient = useQueryClient();
  const toast = useToast();

  type MutateContext = { snapshot: Snapshot | null; context: TContext | undefined };

  return useMutation<TData, Error, TInput>({
    mutationFn: config.mutationFn,
    onMutate: (input): MutateContext => {
      if (!config.patch) {
        return { snapshot: null, context: undefined };
      }
      const cache = new OptimisticCache(queryClient);
      const context = config.patch(input, cache);
      return { snapshot: cache.snapshot(), context };
    },
    onError: (error, input, rawContext) => {
      (rawContext as MutateContext | undefined)?.snapshot?.restore();
      toast.error(i18n.t("misc:optimistic.saveFailed"), errorMessage(error));
      config.onError?.(error, input);
    },
    onSuccess: (data, input, rawContext) => {
      const feedback = config.success?.(input, data, (rawContext as MutateContext)?.context);
      if (feedback) {
        toast.success(
          feedback.message,
          undefined,
          feedback.undo ? { label: undoLabel(), onPress: feedback.undo } : undefined,
        );
      }
    },
    onSettled: (data, _error, input) => {
      for (const key of config.invalidate?.(input, data) ?? []) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    },
  });
}

/**
 * Delayed-commit delete: the row disappears and the summary drops right
 * away, the real DELETE only fires after the undo window. Undo restores the
 * pre-delete cache and never talks to the server; a pending delete is
 * flushed when the screen unmounts so nothing is lost.
 */
export function useDelayedDelete<TRow extends { id: string }>(config: {
  remove: (row: TRow) => Promise<unknown>;
  patch: (row: TRow, cache: OptimisticCache) => void;
  label: (row: TRow) => string;
  fallback?: string;
  /** Screen navigates away mid-window? Keep the timer running instead. */
  flushOnUnmount?: boolean;
  invalidate?: (row: TRow) => readonly QueryKey[];
}): (row: TRow) => void {
  const queryClient = useQueryClient();
  const toast = useToast();
  const configRef = useRef(config);
  configRef.current = config;
  const pending = useRef(new Map<string, UndoEntry<TRow>>());

  const commit = useCallback((entry: UndoEntry<TRow>) => {
    entry.committed = true;
    void configRef.current
      .remove(entry.row)
      .then(() => {
        for (const key of configRef.current.invalidate?.(entry.row) ?? []) {
          void queryClient.invalidateQueries({ queryKey: key });
        }
      })
      .catch((error: unknown) => {
        entry.restore();
        toast.error(i18n.t("misc:optimistic.deleteFailed"), errorMessage(error));
      });
  }, [queryClient, toast]);

  // Unmount flush: pending deletes fire immediately, nothing is lost.
  useEffect(() => {
    const entries = pending.current;
    return () => {
      for (const [id, entry] of entries) {
        clearTimeout(entry.timer);
        entries.delete(id);
        if (!entry.committed) {
          if (configRef.current.flushOnUnmount === false) {
            // Keep the undo window alive: re-schedule outside the unmounting
            // screen so the commit still fires when the window closes.
            entry.timer = setTimeout(() => commit(entry), DELETE_COMMIT_MS);
            pending.current.set(id, entry);
          } else {
            commit(entry);
          }
        }
      }
    };
  }, [commit]);

  return useCallback(
    (row: TRow) => {
      const cache = new OptimisticCache(queryClient);
      configRef.current.patch(row, cache);
      const snapshot = cache.snapshot();
      const restore = () => snapshot.restore();

      toast.success(
        deletedMsg(configRef.current.label(row), configRef.current.fallback),
        undefined,
        {
          label: undoLabel(),
          onPress: () => {
            const entry = pending.current.get(row.id);
            if (entry === undefined || entry.committed) return;
            clearTimeout(entry.timer);
            pending.current.delete(row.id);
            restore();
          },
        },
      );

      const entry: UndoEntry<TRow> = {
        row,
        committed: false,
        restore,
        timer: setTimeout(() => {
          pending.current.delete(row.id);
          commit(entry);
        }, UNDO_TOAST_MS),
      };
      pending.current.set(row.id, entry);
    },
    [commit, queryClient, toast],
  );
}

export { undoLabel, UNDO_TOAST_MS, DELETE_COMMIT_MS };
