import { createFileRoute } from "@tanstack/react-router";
import { useCallback } from "react";

import { JoyoPage } from "@/components/joyo/joyo-page";
import { sanitizeAsk } from "@/lib/joyo-chat";

type JoyoSearch = { ask?: string };

/**
 * "Joyo AI": the hosted nutrition chat (Pro). `?ask=` is a question an entry point (the food row, a scan result) put in the
 * composer; it is never sent by itself and is dropped from the URL once taken.
 */
export const Route = createFileRoute("/_auth/joyo")({
  validateSearch: (search: Record<string, unknown>): JoyoSearch => ({ ask: sanitizeAsk(search.ask) }),
  component: JoyoRoute,
});

function JoyoRoute() {
  const { ask } = Route.useSearch();
  const navigate = Route.useNavigate();
  const onAskTaken = useCallback(() => void navigate({ search: {}, replace: true }), [navigate]);
  return <JoyoPage ask={ask} onAskTaken={onAskTaken} />;
}
