import type { QueryClient } from "@tanstack/react-query";

import { syncPrefs } from "@/lib/prefs-sync";
import { orpc } from "@/utils/orpc";

/** The server reads the calibration prefs from the synced record: push the edit, then refetch what depends on it. */
export async function refreshAfterCalibrationPref(queryClient: QueryClient): Promise<void> {
  await syncPrefs().catch(() => null);
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: orpc.day.key() }),
    queryClient.invalidateQueries({ queryKey: orpc.profile.key() }),
    queryClient.invalidateQueries({ queryKey: orpc.fasting.key() }),
    queryClient.invalidateQueries({ queryKey: orpc.weight.key() }),
    queryClient.invalidateQueries({ queryKey: orpc.stats.key() }),
  ]);
}
