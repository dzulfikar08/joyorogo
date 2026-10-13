import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { authClient, googleSignIn } from "./auth-client";
import { ApiError, get } from "./api";

/**
 * Server-side gating: GET /api/admin/me returns 401 (no session) or 403
 * (signed in, not on ADMIN_EMAILS). The UI mirrors that verdict so nothing
 * admin-related renders without the server having already approved it.
 */
export function useAdminGate() {
  return useQuery({
    queryKey: ["admin-me"],
    queryFn: async () => {
      try {
        await get<{ ok: true }>("/api/admin/me");
        return { state: "admin" as const };
      } catch (err) {
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
          const { data } = await authClient.getSession();
          return {
            state: err.status === 403 ? ("not-admin" as const) : ("signed-out" as const),
            email: data?.user.email ?? null,
          };
        }
        throw err;
      }
    },
    retry: false,
    staleTime: 60_000,
  });
}

export function useSignIn() {
  return useMutation({ mutationFn: () => googleSignIn() });
}

export function useSignOut() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => authClient.signOut(),
    onSuccess: () => qc.clear(),
  });
}
