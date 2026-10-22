import { useQuery } from "@tanstack/react-query";

import type { HealthLastSync } from "@/src/lib/health-last-sync";
import { readHealthLastSync } from "@/src/lib/health-last-sync-store";
import { isHealthConnected, isHealthSyncSupported } from "@/src/lib/health-sync";

export type HealthStatus = {
  /** this build can talk to a health store at all (Android; iOS with the HealthKit module) */
  supported: boolean;
  connected: boolean;
  last: HealthLastSync | null;
};

/** Where Health Connect / Apple Health stands on this phone: possible, allowed, and when the last import finished. */
export function useHealthStatus(enabled = true) {
  return useQuery<HealthStatus>({
    enabled,
    queryKey: ["health", "status"],
    queryFn: async () => {
      if (!isHealthSyncSupported()) return { supported: false, connected: false, last: null };
      const [connected, last] = await Promise.all([isHealthConnected(), readHealthLastSync()]);
      return { supported: true, connected, last };
    },
  });
}
