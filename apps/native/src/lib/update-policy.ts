/**
 * Pure rules of the in-app update prompt, kept free of React Native imports so
 * `bun test` can run them. The hooks in app-update.ts feed these the clock and
 * the persisted timestamps.
 */

/** Resume checks run at most once per 6 hours; a cold start always checks. */
export const CHECK_THROTTLE_MS = 6 * 60 * 60 * 1000;

/** "Nanti" hides the banner for 24 hours. */
export const DISMISS_MS = 24 * 60 * 60 * 1000;

/** Installer package name of the Play Store app; builds installed by it get the Play flow. */
export const PLAY_STORE_INSTALLER = "com.android.vending";

/** True when enough time has passed since the last check (or there was none). */
export function shouldCheck(lastCheckedAt: number | null, now: number): boolean {
  if (lastCheckedAt === null) return true;
  // A clock that moved backwards must not lock checks out for hours.
  if (lastCheckedAt > now) return true;
  return now - lastCheckedAt >= CHECK_THROTTLE_MS;
}

/** True while a previous "Nanti" is still inside its 24 h window. */
export function isDismissed(dismissedAt: number | null, now: number): boolean {
  if (dismissedAt === null) return false;
  if (dismissedAt > now) return false;
  return now - dismissedAt < DISMISS_MS;
}

/** Parses a persisted millisecond timestamp; anything that is not one counts as "never". */
export function parseTimestamp(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** Parses a version code as the native build string ("1466631"); 0 when unusable. */
export function parseVersionCode(raw: string | number | null | undefined): number {
  if (typeof raw === "number") return Number.isInteger(raw) && raw > 0 ? raw : 0;
  if (!raw) return 0;
  const value = Number.parseInt(raw, 10);
  return Number.isNaN(value) || value < 0 ? 0 : value;
}

/** Whether a published versionCode is newer than the installed one. Unknown installed (0) never prompts. */
export function isNewerVersionCode(remote: number, installed: number): boolean {
  return installed > 0 && Number.isFinite(remote) && remote > installed;
}

/**
 * Comparator in the shape sp-react-native-in-app-updates expects. Play version
 * codes are plain integers, so the library's default semver coercion is
 * replaced with a numeric compare.
 */
export function compareVersionCodes(a: string, b: string): -1 | 0 | 1 {
  const left = parseVersionCode(a);
  const right = parseVersionCode(b);
  if (left === right) return 0;
  return left > right ? 1 : -1;
}

/** Only an install made by the Play Store app may use Play In-App Updates. */
export function isPlayInstaller(installer: string | null | undefined): boolean {
  return installer === PLAY_STORE_INSTALLER;
}

/** 0-100 for a progress bar; null while the total is not known yet. */
export function downloadPercent(bytesDownloaded: number, totalBytes: number): number | null {
  if (!Number.isFinite(bytesDownloaded) || !Number.isFinite(totalBytes) || totalBytes <= 0) {
    return null;
  }
  return Math.min(100, Math.max(0, Math.round((bytesDownloaded / totalBytes) * 100)));
}
