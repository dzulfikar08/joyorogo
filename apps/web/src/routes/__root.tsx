import { Toaster } from "@joyorogo/ui/components/sonner";
import type { QueryClient } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { HeadContent, Outlet, createRootRouteWithContext } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";

import { ThemeProvider } from "@/components/theme-provider";
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

// Each layout owns its chrome: the signed-in shell (_auth) has the tab bar
// and desktop top bar; public pages render their own slim header.
function RootComponent() {
  return (
    <>
      <HeadContent />
      <ThemeProvider>
        <Outlet />
        <Toaster position="top-center" />
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
