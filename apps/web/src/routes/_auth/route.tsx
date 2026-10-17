import {
  Navigate,
  Outlet,
  createFileRoute,
  redirect,
  useRouterState,
} from "@tanstack/react-router";

import { IosInstallBanner } from "@/components/ios-install";
import BottomNav, { DesktopBar } from "@/components/bottom-nav";
import { LocaleSync } from "@/components/locale-sync";
import { sessionQuery, useSession } from "@/lib/auth-client";

export const Route = createFileRoute("/_auth")({
  component: AuthLayout,
  beforeLoad: async ({ context, location }) => {
    // Cached (and persisted) session answers instantly; a stale one is
    // revalidated in the background and AuthLayout reacts if it turned null.
    const session = await context.queryClient.ensureQueryData({
      ...sessionQuery,
      revalidateIfStale: true,
    });
    if (!session) {
      // Deep links (undangan, /grup/...) come back to the same screen after login.
      throw redirect({ to: "/login", search: { redirect: location.pathname } });
    }
    return { session };
  },
});

function AuthLayout() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const session = useSession();
  if (session.data === null) return <Navigate to="/login" search={{ redirect: pathname }} replace />;
  // Onboarding is a guided form; the app chrome starts once the plan exists.
  // VAR is a full-screen camera and keeps the screen to itself.
  const showNav = pathname !== "/onboarding" && !pathname.includes("/var/");
  return (
    <div className="min-h-svh">
      <LocaleSync />
      {showNav && <DesktopBar />}
      {showNav && <IosInstallBanner />}
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
