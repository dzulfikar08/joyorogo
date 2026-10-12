import {
  Navigate,
  Outlet,
  createFileRoute,
  redirect,
  useRouterState,
} from "@tanstack/react-router";

import BottomNav, { DesktopBar } from "@/components/bottom-nav";
import { sessionQuery, useSession } from "@/lib/auth-client";

export const Route = createFileRoute("/_auth")({
  component: AuthLayout,
  beforeLoad: async ({ context }) => {
    // Cached (and persisted) session answers instantly; a stale one is
    // revalidated in the background and AuthLayout reacts if it turned null.
    const session = await context.queryClient.ensureQueryData({
      ...sessionQuery,
      revalidateIfStale: true,
    });
    if (!session) {
      throw redirect({ to: "/login" });
    }
    return { session };
  },
});

function AuthLayout() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const session = useSession();
  if (session.data === null) return <Navigate to="/login" replace />;
  // Onboarding is a guided form; the app chrome starts once the plan exists.
  const showNav = pathname !== "/onboarding";
  return (
    <div className="min-h-svh">
      {showNav && <DesktopBar />}
      <main>
        <Outlet />
      </main>
      {showNav && (
        <>
          <div
            aria-hidden="true"
            className="h-[calc(5.5rem+env(safe-area-inset-bottom))] md:hidden"
          />
          <BottomNav />
        </>
      )}
    </div>
  );
}
