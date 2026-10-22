// Platform facade over the two on-device health stores: Health Connect on
// Android, Apple Health (HealthKit) on iOS. react-native-health-connect must
// never be imported at module scope on iOS (its TurboModule lookup throws
// outside Android), so each implementation is require()d inside its branch.
import { Platform } from "react-native";

import { getAppleHealthModule } from "@/modules/apple-health";
import type * as AppleHealth from "@/src/lib/apple-health";
import type * as HealthConnect from "@/src/lib/health-connect";
import { recordHealthSync } from "@/src/lib/health-last-sync-store";

export type HealthSyncResult = {
  workoutsImported: number;
  workoutsSkipped: number;
  activityDays: number;
  sleepNights: number;
};

export function isHealthSyncSupported(): boolean {
  if (Platform.OS === "android") return true;
  if (Platform.OS === "ios") return getAppleHealthModule() != null;
  return false;
}

export async function syncHealthData(latestWeightKg: number | null): Promise<HealthSyncResult> {
  if (Platform.OS === "ios") {
    const { syncAppleHealth } = require("@/src/lib/apple-health") as typeof AppleHealth;
    const result = await syncAppleHealth(latestWeightKg);
    await recordHealthSync(result);
    return result;
  }
  if (Platform.OS === "android") {
    const { syncHealthConnect } = require("@/src/lib/health-connect") as typeof HealthConnect;
    const result = await syncHealthConnect(latestWeightKg);
    await recordHealthSync(result);
    return result;
  }
  return { workoutsImported: 0, workoutsSkipped: 0, activityDays: 0, sleepNights: 0 };
}

/**
 * Whether the app may already read the health store, without asking anything: Health Connect's five read permissions
 * on Android, and on iOS that the HealthKit prompt was answered plus a first import finished (HealthKit never says
 * whether the answer was yes). The same gate the silent auto-sync on Beranda uses.
 */
export async function isHealthConnected(): Promise<boolean> {
  try {
    if (Platform.OS === "ios") {
      const apple = getAppleHealthModule();
      if (!apple || (await apple.getRequestStatus()) !== 2) return false;
      const { hasCompletedFirstSync } = require("@/src/lib/apple-health") as typeof AppleHealth;
      return await hasCompletedFirstSync();
    }
    if (Platform.OS === "android") {
      const { hasReadPermissions } = require("@/src/lib/health-connect") as typeof HealthConnect;
      return await hasReadPermissions();
    }
  } catch {
    // Health Connect missing or not initialised: not connected as far as the app can tell.
  }
  return false;
}
