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
import { Shell, ShellSkeleton } from "@/components/shell";
import { QueryError } from "@/components/states";
import { sessionQuery, useSession } from "@/lib/auth-client";
import { hasSessionHint } from "@/lib/session-hint";
import { orpc } from "@/lib/orpc";

export const Route = createFileRoute("/_auth")({
  component: AuthLayout,
  beforeLoad: async ({ context, location }) => {
    // What the frame needs is requested at once, beside the page chunk and the page's own reads, not after the frame
    // has rendered: the Pro check and the account's language.
    const warmFrame = () => {
      void context.queryClient.prefetchQuery(orpc.fitness.cloudAccess.queryOptions());
      void context.queryClient.prefetchQuery(orpc.profile.myProfile.queryOptions());
    };
    // A returning browser does not wait for the session answer: AuthLayout sends a refused session to /login.
    // First-time visitors are checked before anything else.
    if (hasSessionHint()) {
      void context.queryClient.prefetchQuery(sessionQuery);
      warmFrame();
      return;
    }
    const session = await context.queryClient.ensureQueryData({
      ...sessionQuery,
      revalidateIfStale: true,
    });
    if (!session) throw redirect({ to: "/login", search: { redirect: location.pathname } });
    warmFrame();
  },
});

/** Signed in. Pro opens the app; anything else sees the wall (cloudAccess is the same rule the API enforces). */
function AuthLayout() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const session = useSession();
  const access = useQuery(orpc.fitness.cloudAccess.queryOptions());

  if (session.data === null)
    return <Navigate to="/login" search={{ redirect: pathname }} replace />;
  if (!session.data || access.isPending) return <ShellSkeleton />;
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
