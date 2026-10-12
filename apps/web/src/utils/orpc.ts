import type { AppRouterClient } from "@joyorogo/api/routers/index";
import { ORPCError, createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import { QueryCache, QueryClient } from "@tanstack/react-query";

import { env } from "../env.public";

/** localStorage key holding the user id that owns the persisted cache. */
export const CACHE_OWNER_KEY = "jrg-user";

/**
 * Session ended mid-use (expired or revoked): wipe every cached and persisted
 * query before leaving, so nothing of this account survives for the next.
 */
function onUnauthorized(error: unknown) {
  if (error instanceof ORPCError && error.code === "UNAUTHORIZED") {
    localStorage.removeItem(CACHE_OWNER_KEY);
    queryClient.clear();
    persister.removeClient();
    if (!window.location.pathname.startsWith("/login")) window.location.assign("/login");
  }
}

// Screens own their loading/error states; no global toast layer. Data only
// changes through this device's mutations (which invalidate), so a 2-minute
// freshness window kills refetches on tab switches without showing stale
// numbers after a write.
export const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: onUnauthorized }),
  defaultOptions: {
    queries: {
      staleTime: 2 * 60 * 1000,
      // Must outlive the persisted cache so restored queries aren't dropped.
      gcTime: 24 * 60 * 60 * 1000,
      refetchOnWindowFocus: false,
      retry: (count, error) =>
        !(error instanceof ORPCError && error.status >= 400 && error.status < 500) && count < 1,
    },
  },
});

/**
 * The query cache survives reloads in localStorage, so opening the app shows
 * the last known numbers instantly and refreshes them in the background.
 * The buster ties a saved cache to one WIB day (yesterday's "today" must
 * never render as today's) and to the account that wrote it.
 */
export const persister = createSyncStoragePersister({
  storage: typeof window === "undefined" ? undefined : window.localStorage,
  key: "jrg-cache",
  throttleTime: 1000,
});

export function cacheBuster(): string {
  const wibToday = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return `${wibToday}:${localStorage.getItem(CACHE_OWNER_KEY) ?? "anon"}`;
}

/** Absolute API origin. "/" (or any path) means the API shares this origin,
 * as in the single-worker self-host build (apps/selfhost). */
export function getServerUrl(url: string) {
  const normalized = url.endsWith("/") ? url.slice(0, -1) : url;
  if (normalized && !normalized.startsWith("/")) return normalized;
  return `${window.location.origin}${normalized}`;
}

export const link = new RPCLink({
  url: `${getServerUrl(env.VITE_SERVER_URL)}/rpc`,
  fetch(url, options) {
    return fetch(url, {
      ...options,
      credentials: "include",
    });
  },
});

export const client: AppRouterClient = createORPCClient(link);

export const orpc = createTanstackQueryUtils(client);
