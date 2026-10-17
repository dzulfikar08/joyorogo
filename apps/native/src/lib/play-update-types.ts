/** Result of asking Google Play whether a newer build is waiting for this install. */
export type PlayUpdateCheck =
  | { state: "none" }
  | { state: "available"; versionCode: number; totalBytes: number | null }
  /** A flexible update was already accepted earlier (possibly before the process restarted). */
  | { state: "pending" };

/** What Play reports while the flexible update runs. */
export type PlayUpdateEvent =
  | { type: "downloading"; percent: number | null }
  | { type: "downloaded" }
  | { type: "failed" }
  /** The Play dialog was shown and the user declined it. */
  | { type: "declined" };

/** Android-only seam over Play In-App Updates; platform files provide it or null. */
export type PlayUpdates = {
  /** Installer package name, null when it cannot be read. */
  installer: () => Promise<string | null>;
  check: (installedVersionCode: number) => Promise<PlayUpdateCheck>;
  /** Opens Play's confirm dialog and, once accepted, downloads in the background. */
  startFlexible: () => Promise<void>;
  /** Installs the downloaded update and restarts the app. */
  restart: () => void;
  subscribe: (listener: (event: PlayUpdateEvent) => void) => () => void;
};
