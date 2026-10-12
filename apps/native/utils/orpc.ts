import type { AppRouterClient } from "@joyorogo/api/routers/index";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { QueryCache, QueryClient } from "@tanstack/react-query";
import { Platform } from "react-native";

import { authClient } from "@/lib/auth-client";

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
  fetch(request, init) {
    return expoFetch(request, {
      ...init,
      // Better Auth Expo forwards the session cookie manually on native.
      credentials: Platform.OS === "web" ? "include" : "omit",
    });
  },
  async headers() {
    if (Platform.OS === "web") {
      return {};
    }
    const headers = new Map<string, string>();
    const cookies = await authClient.getCookie();
    if (cookies) {
      headers.set("Cookie", cookies);
    }
    return Object.fromEntries(headers);
  },
});

export const client: AppRouterClient = createORPCClient(link);

export const orpc = createTanstackQueryUtils(client);
