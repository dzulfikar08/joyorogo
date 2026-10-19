import type { AppRouterClient } from "@joyorogo/api/routers/index";
import { LOCALE_HEADER, i18n } from "@joyorogo/i18n";
import { ORPCError, createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { QueryCache, QueryClient } from "@tanstack/react-query";

import { SERVER_URL } from "./env";
import { FitApiError } from "./fit-api";

/** Session ended mid-use (expired or revoked): drop every cached query before leaving, so nothing of this account survives. */
function onUnauthorized(error: unknown) {
  if (error instanceof ORPCError && error.code === "UNAUTHORIZED") {
    queryClient.clear();
    if (!window.location.pathname.startsWith("/login")) window.location.assign("/login");
  }
}

// Analysis data is read-only here and only changes when the phone syncs, so a few minutes of freshness avoids refetching
// on every tab switch. Nothing is persisted to localStorage: a shared computer keeps no health data after sign-out.
export const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: onUnauthorized }),
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
      retry: (count, error) =>
        !(error instanceof ORPCError && error.status >= 400 && error.status < 500) && count < 1,
    },
  },
});

const link = new RPCLink({
  url: `${SERVER_URL}/rpc`,
  // The server writes errors in the language the UI shows.
  headers: () => ({ [LOCALE_HEADER]: i18n.language }),
  // The session cookie lives on the API host (sameSite none), so every call is credentialed.
  fetch: (url, options) => fetch(url, { ...options, credentials: "include" }),
});

export const client: AppRouterClient = createORPCClient(link);
export const orpc = createTanstackQueryUtils(client);

/** The API answered "Pro only": the Pro wall handles it, no error screen. */
export function isPaywall(error: unknown): boolean {
  if (error instanceof FitApiError) return error.paywall;
  return (
    error instanceof ORPCError &&
    error.code === "FORBIDDEN" &&
    (error.data as { paywall?: boolean } | undefined)?.paywall === true
  );
}
