/**
 * Pure rules of the over-the-air (expo-updates) status, free of React Native imports so
 * `bun test` can run them. use-ota-update.ts feeds these what `Updates.useUpdates()` reports.
 */

/** What the Profil card and the banner show about OTA. "disabled" = dev client, Expo Go, web, or a build without updates. */
export type OtaPhase = "disabled" | "idle" | "checking" | "downloading" | "ready" | "error";

export interface OtaSnapshot {
  /** `Updates.isEnabled` on a native platform. */
  enabled: boolean;
  isChecking: boolean;
  isDownloading: boolean;
  /** A downloaded update (or a rollback to the embedded bundle) waits for the next launch. */
  isUpdatePending: boolean;
  /** The last check or download failed and nothing newer has succeeded since. */
  hasError: boolean;
}

/** Ready beats everything: a downloaded update is usable even if a later re-check fails. */
export function otaPhase(s: OtaSnapshot): OtaPhase {
  if (!s.enabled) return "disabled";
  if (s.isUpdatePending) return "ready";
  if (s.isDownloading) return "downloading";
  if (s.isChecking) return "checking";
  return s.hasError ? "error" : "idle";
}

/** Which bundle is running: the one inside the binary, a downloaded update, or the crash fallback. */
export type OtaSource = "embedded" | "update" | "emergency";

export function otaSource(isEmbeddedLaunch: boolean, isEmergencyLaunch: boolean): OtaSource {
  if (isEmergencyLaunch) return "emergency";
  return isEmbeddedLaunch ? "embedded" : "update";
}

/** The download progress (0..1 from expo-updates) as a whole percent, null when unknown. */
export function otaPercent(progress: number | null | undefined): number | null {
  if (typeof progress !== "number" || !Number.isFinite(progress)) return null;
  return Math.min(100, Math.max(0, Math.round(progress * 100)));
}
