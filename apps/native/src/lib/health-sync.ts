// Platform facade over the two on-device health stores: Health Connect on
// Android, Apple Health (HealthKit) on iOS. react-native-health-connect must
// never be imported at module scope on iOS (its TurboModule lookup throws
// outside Android), so each implementation is require()d inside its branch.
import { Platform } from "react-native";

import { getAppleHealthModule } from "@/modules/apple-health";
import type * as AppleHealth from "@/src/lib/apple-health";
import type * as HealthConnect from "@/src/lib/health-connect";

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
    return syncAppleHealth(latestWeightKg);
  }
  if (Platform.OS === "android") {
    const { syncHealthConnect } = require("@/src/lib/health-connect") as typeof HealthConnect;
    return syncHealthConnect(latestWeightKg);
  }
  return { workoutsImported: 0, workoutsSkipped: 0, activityDays: 0, sleepNights: 0 };
}
