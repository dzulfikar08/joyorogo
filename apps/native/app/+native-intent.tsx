import { mapNativeIntentPath } from "@/src/lib/native-intent-path";

// The Strava and COROS OAuth redirects (joyorogo://joyorogo.com/strava?code=...,
// joyorogo://joyorogo.com/coros?code=...&state=...) are consumed by
// WebBrowser.openAuthSessionAsync in their cards; without
// this the router would also try to open them and land on +not-found.
// Invite links (joyorogo://gabung/<CODE> or the https twin, if the OS ever
// hands it over) must land on the join screen, not +not-found.
// The Android "Foto makanan" widget opens joyorogo://makan-ai (the camera).
// The rules live in src/lib/native-intent-path.ts so they are unit-tested.
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  return mapNativeIntentPath(path);
}
