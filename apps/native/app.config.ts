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
 * workflow): the Android package gets a ".qa" suffix and the scheme and name change, so the
 * build installs next to the real app and never replaces it.
 */
const DISTRIBUTIONS = ["sideload", "play"] as const;
type Distribution = (typeof DISTRIBUTIONS)[number];

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

export default ({ config }: ConfigContext): ExpoConfig => {
  const distribution = distributionFromEnv();
  const android = config.android ?? {};
  const qa = process.env.JOYOROGO_QA === "1";
  return {
    ...config,
    name: qa ? "JoyoRogo QA" : (config.name ?? "JoyoRogo"),
    slug: config.slug ?? "joyorogo",
    scheme: qa ? "joyorogo-qa" : config.scheme,
    android: {
      ...android,
      package: qa ? `${android.package}.qa` : android.package,
      permissions:
        distribution === "play"
          ? (android.permissions ?? []).filter((p) => !PLAY_REMOVED_PERMISSIONS.includes(p))
          : android.permissions,
    },
    extra: { ...config.extra, distribution },
  };
};
