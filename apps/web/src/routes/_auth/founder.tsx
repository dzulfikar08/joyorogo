import { createFileRoute, redirect } from "@tanstack/react-router";

import { validatePaywallSearch } from "@/lib/billing";

/** Old link: the paywall now lives at /pro. Search params carry over. */
export const Route = createFileRoute("/_auth/founder")({
  validateSearch: validatePaywallSearch,
  beforeLoad: ({ search }) => {
    throw redirect({ to: "/pro", search, replace: true });
  },
});
