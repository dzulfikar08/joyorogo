import { queryOptions, useQuery } from "@tanstack/react-query";
import { createAuthClient } from "better-auth/react";

import { env } from "../env.public";
import { CACHE_OWNER_KEY, getServerUrl, persister, queryClient } from "../utils/orpc";

export const authClient = createAuthClient({
  // better-auth derives its route-matching base from this URL's path, so the
  // public auth path must equal the server-side mount (/api/auth everywhere)
  baseURL: new URL("/api/auth", getServerUrl(env.VITE_SERVER_URL)).toString(),
});

export type Session = typeof authClient.$Infer.Session;

/** Drop every cached query except the session itself, in memory and on disk. */
function forgetUserData() {
  queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== "session" });
  persister.removeClient();
}

/**
 * One session lookup per app load instead of one per navigation. Signed-in
 * sessions are persisted with the query cache (signed-out ones never are),
 * so a returning user passes the auth gate without waiting on the network;
 * it revalidates in the background.
 *
 * The cache belongs to whoever signed in: when the account behind the
 * cookie changes (sign-out elsewhere, another account, expiry), the previous
 * owner's diary data is dropped before anything can render it.
 */
export const sessionQuery = queryOptions({
  queryKey: ["session"],
  queryFn: async (): Promise<Session | null> => {
    const { data } = await authClient.getSession();
    const owner = data?.user.id ?? null;
    if (localStorage.getItem(CACHE_OWNER_KEY) !== owner) forgetUserData();
    if (owner) localStorage.setItem(CACHE_OWNER_KEY, owner);
    else localStorage.removeItem(CACHE_OWNER_KEY);
    return data ?? null;
  },
  staleTime: 5 * 60 * 1000,
});

export function useSession() {
  return useQuery(sessionQuery);
}

/** Signs out and wipes every cached and persisted query (diary data included). */
export async function signOut() {
  await authClient.signOut();
  localStorage.removeItem(CACHE_OWNER_KEY);
  queryClient.clear();
  persister.removeClient();
}
