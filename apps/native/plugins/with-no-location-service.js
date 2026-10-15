/**
 * JoyoRogo local config plugin: drop expo-location's LocationTaskService.
 *
 * The app only reads one foreground position (src/lib/location.ts), never
 * background location tasks or geofencing. The library still declares that
 * service with foregroundServiceType="location", which makes Google Play ask
 * for a foreground-service declaration and video. Removing the declaration at
 * manifest-merge time keeps the merged manifest free of any foreground
 * service type.
 */
const { withAndroidManifest } = require("expo/config-plugins");

const SERVICE = "expo.modules.location.services.LocationTaskService";

module.exports = function withNoLocationService(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;
    manifest.$["xmlns:tools"] ??= "http://schemas.android.com/tools";
    const app = manifest.application[0];
    app.service = (app.service ?? []).filter((s) => s.$["android:name"] !== SERVICE);
    app.service.push({
      $: { "android:name": SERVICE, "tools:node": "remove" },
    });
    return config;
  });
};
