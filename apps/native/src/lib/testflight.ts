import { File, Paths } from "expo-file-system";
import { Platform } from "react-native";

let cached: boolean | null = null;

/**
 * True in a TestFlight install, where StoreKit purchases run in Apple's
 * Sandbox and charge nothing. iOS keeps the app's receipt in the bundle:
 * `StoreKit/receipt` for App Store installs, `StoreKit/sandboxReceipt` for
 * TestFlight. Reading that file needs no native module, so it ships over the
 * air. Android and anything unreadable answer false.
 */
export function isTestFlightBuild(): boolean {
  if (cached !== null) return cached;
  if (Platform.OS !== "ios") return (cached = false);
  try {
    cached = new File(Paths.bundle, "StoreKit", "sandboxReceipt").exists;
  } catch {
    cached = false;
  }
  return cached;
}
