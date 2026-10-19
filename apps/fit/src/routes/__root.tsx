import { ThemeProvider } from "@joyorogo/ui/hooks/use-theme";
import type { QueryClient } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { Outlet, createRootRouteWithContext } from "@tanstack/react-router";
import { Fragment } from "react";
import { useTranslation } from "react-i18next";

import type { orpc } from "@/lib/orpc";

import "../index.css";

export interface RouterAppContext {
  orpc: typeof orpc;
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterAppContext>()({
  component: RootComponent,
});

function RootComponent() {
  // Remount the tree on a language switch: strings read through the shared format helpers (dates, units) have no
  // subscription of their own. The URL and the query cache live outside the tree and survive.
  const { i18n } = useTranslation();
  return (
    <>
      <ThemeProvider defaultTheme="system" storageKey="vite-ui-theme">
        <Fragment key={i18n.language}>
          <Outlet />
        </Fragment>
      </ThemeProvider>
      {import.meta.env.DEV && <ReactQueryDevtools buttonPosition="bottom-left" />}
    </>
  );
}
