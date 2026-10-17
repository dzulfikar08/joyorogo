import { Toaster } from "@joyorogo/ui/components/sonner";
import type { QueryClient } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { HeadContent, Outlet, createRootRouteWithContext } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import { Fragment, useEffect } from "react";
import { useTranslation } from "react-i18next";

import { IosInstallHost } from "@/components/ios-install";
import { ThemeProvider } from "@/components/theme-provider";
import { reportSignIn, signInPending } from "@/lib/analytics";
import { useSession } from "@/lib/auth-client";
import type { orpc } from "@/utils/orpc";

import "../index.css";

export interface RouterAppContext {
  orpc: typeof orpc;
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterAppContext>()({
  component: RootComponent,
  // Public pages set their own title (src/lib/seo.ts); descriptions, icons,
  // and share tags live in each page's static HTML (blog/pages.ts).
  head: () => ({ meta: [{ title: "JoyoRogo" }] }),
});

/** Mounted only while a Google sign-in is pending; reports it once the session exists. */
function SignInReporter() {
  const session = useSession();
  useEffect(() => {
    if (session.data) reportSignIn();
  }, [session.data]);
  return null;
}

// Each layout owns its chrome: the signed-in shell (_auth) has the tab bar
// and desktop top bar; public pages render their own slim header.
function RootComponent() {
  // Remount the tree on a language switch: strings read through the shared
  // format helpers (dates, units) have no subscription of their own. The URL
  // and the query cache live outside the tree and survive.
  const { i18n } = useTranslation();
  return (
    <>
      <HeadContent />
      <ThemeProvider>
        <Fragment key={i18n.language}>
          <Outlet />
          {signInPending() && <SignInReporter />}
          <IosInstallHost />
          <Toaster position="top-center" />
        </Fragment>
      </ThemeProvider>
      {import.meta.env.DEV && (
        <>
          <TanStackRouterDevtools position="bottom-left" />
          <ReactQueryDevtools position="bottom" buttonPosition="bottom-right" />
        </>
      )}
    </>
  );
}
