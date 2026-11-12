import { queryOptions, useQuery } from "@tanstack/react-query";
import { createAuthClient } from "better-auth/react";

import { SERVER_URL } from "./env";
import { queryClient } from "./orpc";
import { setSessionHint } from "./session-hint";

export const authClient = createAuthClient({
  // better-auth derives its route-matching base from this URL's path: it must equal the server mount (/api/auth).
  baseURL: `${SERVER_URL}/api/auth`,
});

export type Session = typeof authClient.$Infer.Session;

/** One session lookup per app load; signed-out answers are cached too, so the gate does not refetch per navigation. */
export const sessionQuery = queryOptions({
  queryKey: ["session"],
  queryFn: async (): Promise<Session | null> => {
    const { data } = await authClient.getSession();
    setSessionHint(data !== null && data !== undefined);
    return data ?? null;
  },
  staleTime: 5 * 60 * 1000,
});

export function useSession() {
  return useQuery(sessionQuery);
}

/** Signs out and wipes every cached query (workouts and sleep included). */
export async function signOut() {
  await authClient.signOut();
  setSessionHint(false);
  queryClient.clear();
}
