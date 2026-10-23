/**
 * iPhone home-screen widget (WidgetKit extension) of JoyoRogo: Streak Catat, the twin of the Android widget.
 * Built by @bacons/apple-targets during `expo prebuild`; docs/ios-widget.md.
 *
 * - Bundle id com.joyodigitama.joyorogo.widget (the app's id plus ".widget"); it needs its own App ID and the App Group
 *   capability in the Apple Developer portal, like the app.
 * - The app and the widget share group.com.joyodigitama.joyorogo (app.json ios.entitlements): the app writes the streak
 *   snapshot there (src/lib/widgets/ios-streak-store.ts), the widget reads it.
 * - iOS 16.4 like the app; the Swift code guards the iOS 17 / 18 APIs.
 *
 * @type {import('@bacons/apple-targets/app.plugin').ConfigFunction}
 */
module.exports = (config) => ({
  type: "widget",
  name: "JoyoRogoWidget",
  displayName: "JoyoRogo",
  bundleIdentifier: ".widget",
  deploymentTarget: "16.4",
  entitlements: {
    "com.apple.security.application-groups": config.ios.entitlements["com.apple.security.application-groups"],
  },
});
