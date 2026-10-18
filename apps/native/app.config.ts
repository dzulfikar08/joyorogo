import type { ConfigContext, ExpoConfig } from "expo/config";

/**
 * app.json stays the single source of truth. This wrapper only applies the
 * distribution channel, read from JOYOROGO_DISTRIBUTION at prebuild/bundle time:
 *
 * - unset / "sideload" (default): the APK self-updater build, keeps
 *   REQUEST_INSTALL_PACKAGES.
 * - "play": Google Play build. Play forbids REQUEST_INSTALL_PACKAGES for
 *   self-updating apps, so the permission is dropped and the app reads
 *   extra.distribution === "play" to disable the updater and external checkout.
 *
 * JOYOROGO_QA=1 is for on-device QA builds only (scripts/build-qa-apk.sh, the "QA Android"
 * workflow): the Android package gets a ".qa" suffix and the name changes, so the build
 * installs next to the real app and never replaces it. The scheme stays "joyorogo" on purpose: Better
 * Auth only trusts that origin, so a different scheme makes every email sign-in fail with INVALID_ORIGIN.
 *
 * OTA (expo-updates, docs/ota.md): the build listens to one EAS Update channel, set through the
 * expo-channel-name request header. Default "production"; QA builds default to "preview" so a test
 * update never reaches real users. JOYOROGO_UPDATE_CHANNEL overrides it. Note JOYOROGO_DISTRIBUTION and
 * JOYOROGO_QA change the native config, so each combination gets its own fingerprint runtimeVersion;
 * scripts/ota.sh publishes with the same variables the binary was built with.
 */
const DISTRIBUTIONS = ["sideload", "play"] as const;
type Distribution = (typeof DISTRIBUTIONS)[number];

const UPDATE_CHANNELS = ["production", "preview"] as const;

const PLAY_REMOVED_PERMISSIONS = ["android.permission.REQUEST_INSTALL_PACKAGES"];

function distributionFromEnv(): Distribution {
  const value = process.env.JOYOROGO_DISTRIBUTION ?? "sideload";
  if (!(DISTRIBUTIONS as readonly string[]).includes(value)) {
    throw new Error(
      `JOYOROGO_DISTRIBUTION must be one of ${DISTRIBUTIONS.join(", ")} (got "${value}")`,
    );
  }
  return value as Distribution;
}

function updateChannelFromEnv(qa: boolean): string {
  const value = process.env.JOYOROGO_UPDATE_CHANNEL ?? (qa ? "preview" : "production");
  if (!(UPDATE_CHANNELS as readonly string[]).includes(value)) {
    throw new Error(
      `JOYOROGO_UPDATE_CHANNEL must be one of ${UPDATE_CHANNELS.join(", ")} (got "${value}")`,
    );
  }
  return value;
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const distribution = distributionFromEnv();
  const android = config.android ?? {};
  const qa = process.env.JOYOROGO_QA === "1";
  return {
    ...config,
    name: qa ? "JoyoRogo QA" : (config.name ?? "JoyoRogo"),
    slug: config.slug ?? "joyorogo",
    android: {
      ...android,
      package: qa ? `${android.package}.qa` : android.package,
      permissions:
        distribution === "play"
          ? (android.permissions ?? []).filter((p) => !PLAY_REMOVED_PERMISSIONS.includes(p))
          : android.permissions,
    },
    updates: {
      ...config.updates,
      requestHeaders: { "expo-channel-name": updateChannelFromEnv(qa) },
    },
    extra: { ...config.extra, distribution },
  };
};
