import { authClient } from "@/lib/auth-client";

export type SessionGate = "loading" | "anon" | "authed";

/**
 * Every protected screen starts here: show a spinner while the session
 * restores, send anonymous users to /login, render when authed.
 */
export function useSessionGate(): SessionGate {
  const { data, isPending } = authClient.useSession();
  if (isPending) return "loading";
  return data ? "authed" : "anon";
}
