import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";

/** Hash format: `#tab?key=value&…` — the query part keeps filter/pagination state across reloads. */
export function currentTab(): string {
  return window.location.hash.replace(/^#/, "").split("?")[0] || "overview";
}

export const PAGE_SIZES = [10, 25, 50, 100];
export const DEFAULT_PAGE_SIZE = 25;

const subscribe = (onChange: () => void) => {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
};
const readHash = () => window.location.hash;

export type HashPatch = Record<string, string | number | null>;

/**
 * Read/write the current tab's hash query params. `set` merges the patch into
 * the URL (null or "" deletes). A change pushes a history entry so back/forward
 * and reload keep state; `replace` swaps the entry instead (typing in a search box).
 */
export function useHashQuery(tab: string) {
  const hash = useSyncExternalStore(subscribe, readHash);
  const params = useMemo(() => new URLSearchParams(hash.split("?")[1] ?? ""), [hash]);

  const set = useCallback(
    (patch: HashPatch, options?: { replace?: boolean }) => {
      const next = new URLSearchParams(window.location.hash.split("?")[1] ?? "");
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === "") next.delete(key);
        else next.set(key, String(value));
      }
      const q = next.toString();
      const target = `#${q ? `${tab}?${q}` : tab}`;
      if (target === window.location.hash) return;
      if (options?.replace) {
        window.history.replaceState(null, "", target);
        // replaceState is silent; every hook instance listens for hashchange.
        window.dispatchEvent(new HashChangeEvent("hashchange"));
      } else {
        window.location.hash = target;
      }
    },
    [tab],
  );

  return { params, set };
}

/** Positive integer URL param, or the default when absent or malformed. */
export function intParam(value: string | null, fallback: number): number {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 ? n : fallback;
}

/**
 * page / pageSize URL state. Defaults (page 1, 25 per page) stay out of the
 * URL; changing the page size returns to page 1.
 */
export function usePaging(
  params: URLSearchParams,
  set: (patch: HashPatch, options?: { replace?: boolean }) => void,
  keys: { page: string; pageSize: string } = { page: "page", pageSize: "pageSize" },
) {
  const page = intParam(params.get(keys.page), 1);
  const sized = intParam(params.get(keys.pageSize), DEFAULT_PAGE_SIZE);
  const pageSize = PAGE_SIZES.includes(sized) ? sized : DEFAULT_PAGE_SIZE;
  return {
    page,
    pageSize,
    setPage: (next: number, options?: { replace?: boolean }) =>
      set({ [keys.page]: next <= 1 ? null : next }, options),
    setPageSize: (next: number) =>
      set({
        [keys.pageSize]: next === DEFAULT_PAGE_SIZE ? null : next,
        [keys.page]: null,
      }),
  };
}

/** A shortened result set (rows deleted, filter tightened) can leave the URL past the last page: step back to it. */
export function useClampPage(
  total: number | undefined,
  paging: ReturnType<typeof usePaging>,
  settled: boolean,
) {
  const { page, pageSize, setPage } = paging;
  useEffect(() => {
    if (total === undefined || !settled) return;
    const last = Math.max(1, Math.ceil(total / pageSize));
    if (page > last) setPage(last, { replace: true });
  }, [total, page, pageSize, settled]); // eslint-disable-line react-hooks/exhaustive-deps
}
