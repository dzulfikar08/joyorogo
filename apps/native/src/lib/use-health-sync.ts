import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Platform } from "react-native";

import { getAppleHealthModule } from "@/modules/apple-health";
import type * as AppleHealth from "@/src/lib/apple-health";
import type * as HealthConnect from "@/src/lib/health-connect";
import type { HealthSyncResult } from "@/src/lib/health-sync";
import { recordHealthSync } from "@/src/lib/health-last-sync-store";

/**
 * US-013: health data is the primary activity source, so the sync runs by
 * itself when the dashboard opens. The first import stays manual (Profil) —
 * a permission dialog must never pop out of nowhere on the home screen:
 * Android checks the already-granted Health Connect permissions, iOS checks
 * that the HealthKit prompt was answered (status 'unnecessary') plus that a
 * first manual sync completed, because HealthKit cannot report grant state.
 */
export function useHealthAutoSync(latestWeightKg: number | null, enabled: boolean) {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const run = async () => {
      if (syncedRecently()) return;
      let result: HealthSyncResult | null = null;
      if (Platform.OS === "ios") {
        const apple = getAppleHealthModule();
        // HKAuthorizationRequestStatus.unnecessary === 2: the user already
        // answered the prompt, so syncing cannot trigger a new dialog.
        if (!apple || (await apple.getRequestStatus()) !== 2) return;
        const { hasCompletedFirstSync, syncAppleHealth } =
          require("@/src/lib/apple-health") as typeof AppleHealth;
        if (!(await hasCompletedFirstSync())) return;
        result = await syncAppleHealth(latestWeightKg);
      } else if (Platform.OS === "android") {
        const { hasReadPermissions, syncHealthConnect } =
          require("@/src/lib/health-connect") as typeof HealthConnect;
        if (!(await hasReadPermissions())) return;
        result = await syncHealthConnect(latestWeightKg);
      }
      if (result) await recordHealthSync(result);
      if (
        !cancelled &&
        result &&
        (result.workoutsImported > 0 || result.activityDays > 0 || result.sleepNights > 0)
      ) {
        queryClient.invalidateQueries();
      }
    };
    run().catch(() => {
      // Silent by design: the manual flow in Profil surfaces errors and
      // permission prompts where the user can act on them.
    });
    return () => {
      cancelled = true;
    };
    // Run at most once per mount state change — latestWeightKg only sharpens
    // the kcal estimate and must not retrigger a sync.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);
}

const SYNC_THROTTLE_MS = 15 * 60 * 1000;
let lastSyncAt = 0;

function syncedRecently(): boolean {
  if (Date.now() - lastSyncAt < SYNC_THROTTLE_MS) return true;
  lastSyncAt = Date.now();
  return false;
}
