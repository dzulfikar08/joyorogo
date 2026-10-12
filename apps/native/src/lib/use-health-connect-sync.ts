import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getGrantedPermissions } from "react-native-health-connect";

import { isHealthConnectSupported, syncHealthConnect } from "@/src/lib/health-connect";

const READ_RECORD_TYPES = [
  "ExerciseSession",
  "SleepSession",
  "Steps",
  "Distance",
  "ActiveCaloriesBurned",
];

/**
 * US-013: Health Connect is the primary activity source, so the sync runs by
 * itself when the dashboard opens. The first import stays manual (Profil) —
 * a permission dialog must never pop out of nowhere on the home screen; once
 * the user has granted the reads, every later app open syncs silently.
 */
export function useHealthConnectAutoSync(latestWeightKg: number | null, enabled: boolean) {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const run = async () => {
      if (!isHealthConnectSupported() || syncedRecently()) return;
      const granted = await getGrantedPermissions();
      const have = new Set<string>(
        granted.filter((p) => p.accessType === "read").map((p) => p.recordType),
      );
      if (!READ_RECORD_TYPES.every((t) => have.has(t))) return;
      const result = await syncHealthConnect(latestWeightKg);
      if (
        !cancelled &&
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
