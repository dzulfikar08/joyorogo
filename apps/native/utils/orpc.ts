import type { AppRouterClient } from "@joyorogo/api/routers/index";
import { LOCALE_HEADER, i18n } from "@joyorogo/i18n";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { QueryCache, QueryClient } from "@tanstack/react-query";
import { Platform } from "react-native";

import { authClient } from "@/lib/auth-client";
import { mirrorFoodCall } from "@/src/lib/health-nutrition";

// Must stay named `ENV`: varlock's babel plugin only inlines `ENV.X` reads;
// anything else hits the runtime proxy, which throws in release builds.
import { ENV } from "../src/env";

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error) => {
      console.log(error);
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 2 * 60 * 1000,
      gcTime: 30 * 60 * 1000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

async function expoFetch(request: Request, init?: RequestInit) {
  const { fetch } = await import("expo/fetch");

  return fetch(request.url, {
    body: await request.blob(),
    headers: request.headers,
    method: request.method,
    signal: request.signal,
    ...init,
  });
}

/**
 * Server origin for RPC. EXPO_PUBLIC_SERVER_URL is the source of truth; on
 * web it can come back empty when the env injection layer is unavailable
 * (metro web dev), so fall back to same-origin instead of an invalid URL.
 */
function serverBaseUrl(): string {
  if (ENV.EXPO_PUBLIC_SERVER_URL) return ENV.EXPO_PUBLIC_SERVER_URL;
  if (Platform.OS === "web" && typeof window !== "undefined") {
    return window.location.origin;
  }
  return "http://localhost:3000";
}

export const link = new RPCLink({
  url: `${serverBaseUrl()}/rpc`,
  interceptors: [
    async (options) => {
      const output = await options.next();
      mirrorFoodCall(options.path, options.input, output);
      return output;
    },
  ],
  fetch(request, init) {
    return expoFetch(request, {
      ...init,
      // Better Auth Expo forwards the session cookie manually on native.
      credentials: Platform.OS === "web" ? "include" : "omit",
    });
  },
  async headers() {
    // The server writes errors in the language the UI shows.
    const locale = { [LOCALE_HEADER]: i18n.language };
    if (Platform.OS === "web") {
      return locale;
    }
    const headers = new Map<string, string>(Object.entries(locale));
    const cookies = await authClient.getCookie();
    if (cookies) {
      headers.set("Cookie", cookies);
    }
    return Object.fromEntries(headers);
  },
});

export const client: AppRouterClient = createORPCClient(link);

export const orpc = createTanstackQueryUtils(client);

/**
 * Quota FORBIDDEN from the ai routers carries `data.paywall`; the caller
 * opens the paywall screen instead of showing a plain error. Duck-typed on
 * purpose: ORPCError is reconstructed from JSON, and `instanceof` breaks
 * across dependency graphs (same reason orpc ships Symbol.hasInstance).
 */
export function isPaywallError(error: unknown): boolean {
  const err = error as { code?: unknown; data?: { paywall?: unknown } } | null;
  return err?.code === "FORBIDDEN" && err?.data?.paywall === true;
}
