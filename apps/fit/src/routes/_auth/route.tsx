import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
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
import { loadFeedbackWidget } from "@/lib/feedback";
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
  // The feedback page is for every signed-in account: reporting a problem is not behind the paywall.
  if (!access.data.unlocked && pathname !== "/issues") {
    return (
      <ProWall
        session={session.data}
        onRecheck={() => access.refetch()}
        checking={access.isFetching}
      />
    );
  }
  return (
    <Shell session={session.data}>
      <FeedbackPreload />
      <LocaleSync />
      <Outlet />
    </Shell>
  );
}

/**
 * Loads the feedback widget once the app is open, while the browser is idle: from then on it keeps the last console
 * errors and failed requests, which a bug report sends along. It shows nothing until the account menu opens it.
 */
function FeedbackPreload() {
  useEffect(() => {
    const load = () => void loadFeedbackWidget().catch(() => {});
    if ("requestIdleCallback" in window) {
      const id = window.requestIdleCallback(load, { timeout: 5000 });
      return () => window.cancelIdleCallback(id);
    }
    const id = globalThis.setTimeout(load, 2000);
    return () => globalThis.clearTimeout(id);
  }, []);
  return null;
}
