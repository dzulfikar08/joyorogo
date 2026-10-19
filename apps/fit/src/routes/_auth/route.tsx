import { useQuery } from "@tanstack/react-query";
import {
  Navigate,
  Outlet,
  createFileRoute,
  redirect,
  useRouterState,
} from "@tanstack/react-router";

import { LocaleSync } from "@/components/locale-sync";
import { ProWall } from "@/components/pro-wall";
import { Shell } from "@/components/shell";
import { PageLoader, QueryError } from "@/components/states";
import { sessionQuery, useSession } from "@/lib/auth-client";
import { orpc } from "@/lib/orpc";

export const Route = createFileRoute("/_auth")({
  component: AuthLayout,
  beforeLoad: async ({ context, location }) => {
    const session = await context.queryClient.ensureQueryData({
      ...sessionQuery,
      revalidateIfStale: true,
    });
    if (!session) throw redirect({ to: "/login", search: { redirect: location.pathname } });
    return { session };
  },
});

/** Signed in. Pro opens the app; anything else sees the wall (cloudAccess is the same rule the API enforces). */
function AuthLayout() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const session = useSession();
  const access = useQuery(orpc.fitness.cloudAccess.queryOptions());

  if (session.data === null)
    return <Navigate to="/login" search={{ redirect: pathname }} replace />;
  if (!session.data || access.isPending) return <PageLoader />;
  if (access.isError) {
    return (
      <div className="grid min-h-svh place-items-center">
        <QueryError error={access.error} onRetry={() => void access.refetch()} />
      </div>
    );
  }
  if (!access.data.unlocked) {
    return (
      <ProWall
        session={session.data}
        onRecheck={() => void access.refetch()}
        checking={access.isFetching}
      />
    );
  }
  return (
    <Shell session={session.data}>
      <LocaleSync />
      <Outlet />
    </Shell>
  );
}
