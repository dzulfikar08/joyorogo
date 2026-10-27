import { useQuery } from "@tanstack/react-query";

import { useSessionGate } from "@/lib/use-session-gate";
import { orpc } from "@/utils/orpc";

/** The caller's whole shelf (earned and locked). `data.enabled === false` means the feature is off: hide every entry point. */
export function useBadges() {
  const gate = useSessionGate();
  return useQuery(orpc.badge.mine.queryOptions({ enabled: gate === "authed", staleTime: 60_000 }));
}
