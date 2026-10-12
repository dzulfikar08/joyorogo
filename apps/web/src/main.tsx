import { QueryClientProvider } from "@tanstack/react-query";
import { persistQueryClient } from "@tanstack/react-query-persist-client";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import ReactDOM from "react-dom/client";

import Loader from "./components/loader";
import { sessionQuery } from "./lib/auth-client";
import { routeTree } from "./routeTree.gen";
import { cacheBuster, orpc, persister, queryClient } from "./utils/orpc";

const router = createRouter({
  routeTree,
  // Hover/touchstart on a link runs the target's loader (data + code), so
  // most navigations find everything already cached.
  defaultPreload: "intent",
  // React Query owns freshness; the router must always ask it.
  defaultPreloadStaleTime: 0,
  scrollRestoration: true,
  defaultPendingComponent: () => <Loader />,
  context: { orpc, queryClient },
  Wrap: function WrapComponent({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  },
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const rootElement = document.getElementById("app");

if (!rootElement) {
  throw new Error("Root element not found");
}

const [, restored] = persistQueryClient({
  queryClient,
  persister,
  maxAge: 24 * 60 * 60 * 1000,
  buster: cacheBuster(),
  dehydrateOptions: {
    // A signed-out session is never worth restoring: right after sign-in it
    // would make the gates believe the user is still anonymous.
    shouldDehydrateQuery: (query) =>
      query.state.status === "success" &&
      !(query.queryKey[0] === "session" && query.state.data === null),
  },
});

// localStorage restore settles within a frame; mounting after it lets the
// auth gate and the first screen read cached data instead of the network.
void restored.finally(() => {
  // Returning visitors: start the session check now, in parallel with the
  // route chunk download, instead of after it.
  void queryClient.prefetchQuery(sessionQuery);
  ReactDOM.createRoot(rootElement).render(<RouterProvider router={router} />);
});
