import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import ReactDOM from "react-dom/client";

import { ErrorScreen, NotFoundScreen } from "@/components/error-screen";
import { PageLoader } from "@/components/states";
import "@/lib/i18n";
import { sessionQuery } from "@/lib/auth-client";
import { orpc, queryClient } from "@/lib/orpc";
import { routeTree } from "./routeTree.gen";

const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  // React Query owns freshness; the router must always ask it.
  defaultPreloadStaleTime: 0,
  scrollRestoration: true,
  defaultPendingComponent: PageLoader,
  defaultErrorComponent: ErrorScreen,
  defaultNotFoundComponent: NotFoundScreen,
  context: { orpc, queryClient },
  Wrap: ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  ),
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const rootElement = document.getElementById("app");
if (!rootElement) throw new Error("Root element not found");

// Start the session check now, in parallel with the route chunks, instead of after they load.
void queryClient.prefetchQuery(sessionQuery);
ReactDOM.createRoot(rootElement).render(<RouterProvider router={router} />);
