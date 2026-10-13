import { requireOptionalNativeModule } from "expo";
import { Platform } from "react-native";

export type AppleHealthWorkout = {
  id: string;
  // HKWorkoutActivityType raw value (iOS 16+ numbering; deployment target is 16.4).
  activityType: number;
  start: string;
  end: string;
  kcal: number | null;
  distanceMeters: number | null;
};

export type AppleHealthDayTotals = {
  // WIB calendar day, 'YYYY-MM-DD'
  date: string;
  steps: number;
  distanceMeters: number;
  activeKcal: number;
};

export type AppleHealthSleepSample = {
  start: string;
  end: string;
  // HKCategoryValueSleepAnalysis raw value
  value: number;
};

type AppleHealthNativeModule = {
  isAvailable(): Promise<boolean>;
  requestAuthorization(): Promise<boolean>;
  // HKAuthorizationRequestStatus raw value: 0 notDetermined, 1 shouldRequest,
  // 2 unnecessary (the prompt was already answered).
  getRequestStatus(): Promise<number>;
  getWorkouts(fromMs: number, toMs: number): Promise<AppleHealthWorkout[]>;
  getDailyTotals(fromMs: number, toMs: number): Promise<AppleHealthDayTotals[]>;
  getSleepSamples(fromMs: number, toMs: number): Promise<AppleHealthSleepSample[]>;
};

// Null on Android and web so callers branch on Platform.OS instead of
// importing iOS-only code paths.
export function getAppleHealthModule(): AppleHealthNativeModule | null {
  if (Platform.OS !== "ios") return null;
  return requireOptionalNativeModule<AppleHealthNativeModule>("AppleHealth");
}
