# iPhone widget: Streak Catat

Written 2026-10-23 (JRG-401). The iPhone twin of the Android Streak Catat widget (`docs/marketing/releases/2026-10-23-widget-streak-catat.md`): a
flame with the days in a row and Joyo reacting, one tap to the scan camera. A WidgetKit extension, small and medium sizes, iOS 16.4 and later
(the app's own minimum). It ships inside the app: **a store build** (TestFlight / App Store) is the only way to get it, never an OTA update.

## Pieces

| What | Where |
| --- | --- |
| Config plugin that adds the extension target to the prebuilt Xcode project | `@bacons/apple-targets` 5.0.0, `plugins` in `apps/native/app.json` |
| Target config (bundle id `com.joyodigitama.joyorogo.widget`, iOS 16.4, App Group entitlement) | `apps/native/targets/widget/expo-target.config.js` |
| Swift: pure state model (port of `streak-model.ts` + `packages/api/src/lib/streak.ts`) | `targets/widget/StreakModel.swift` |
| Swift: App Group read, copy lookup | `targets/widget/StreakStore.swift` |
| Swift: TimelineProvider, SwiftUI small + medium views, flame shape, `@main` bundle | `targets/widget/StreakWidget.swift`, `StreakWidgetBundle.swift` |
| Copy in id / en / ms (generated from `packages/i18n/src/locales/*/misc.json`) | `targets/widget/streak-copy.json` |
| Joyo poses (the six Android poses, 300 px tall PNGs, trimmed) | `targets/widget/Assets.xcassets/mascot-*.imageset` |
| Plus Jakarta Sans Bold / ExtraBold (registered through `UIAppFonts`), privacy manifest | `targets/widget/*.ttf`, `Info.plist`, `PrivacyInfo.xcprivacy` |
| JS side: the payload, the App Group writer | `src/lib/widgets/ios-streak.ts` (pure), `ios-streak-store.ts` (native) |
| Cross-check of the Swift model against the TypeScript model | `apps/native/widget-ios-check/` |
| Compile job on a macOS runner | `.github/workflows/ios-widget.yml` |

`apps/native/ios/` stays generated and gitignored: `expo prebuild` links `targets/widget` into it as the `JoyoRogoWidget` target
(`expo:targets/widget` folder in Xcode, edits there are saved in `targets/`).

## How the data gets there

WidgetKit cannot run JavaScript, and iOS reloads a widget on its own budget, so the widget draws from what the app left behind and ages it itself:

1. When the day summary loads (`app/(tabs)/index.tsx` calls `pushDaySnapshot`), `push.ts` also calls `mirrorStreakToIosWidget`. It writes into the
   App Group's `UserDefaults` (`group.com.joyodigitama.joyorogo`, through `ExtensionStorage` of the plugin) the key `streak`: JSON of
   `IosStreakPayload` (signed in, day zone, streak stamp `{days, lastLoggedDate}`, Hamil/Menyusui flag, Naikin BB flag) and `streak.lang` (the app's
   language). Then it calls `WidgetCenter.reloadTimelines(ofKind: "StreakCatat")`.
2. `StreakProvider.getTimeline` builds one entry now and one at each of the next 7 midnights **in the person's day zone** (Asia/Jakarta,
   Asia/Kuala_Lumpur or Asia/Singapore, from the payload). Each entry runs the Swift model on that entry's date, so a lit flame turns "at risk" at midnight and
   "broken" the day after, and the nudge line rotates daily, with no network and no app launch. The timeline ends with `.after(last midnight)`.
3. Sign out, account deletion and an expired session (`pushSignedOutSnapshot`) write a signed-out payload, so the last person's numbers never stay on the home screen.
   Until the app has ever written (just installed), the widget shows the signed-out tile ("Masuk dulu").

Differences from Android: iOS has no headless refresh, so the widget does not fetch. A log made on another device shows after the app is opened once, and
nothing updates while the app has not run since the last log; ageing at midnight works regardless. Copy is the app's language (`streak.lang`), not the phone's.

States (same as Android, `streak-model.ts`): logged today (cheer), at risk (surprised, "Jaga apinya"), broken with "N hari tanpa catat" (determined), asleep after 7 days
(sleepy), no streak (title "Nyalakan apinya"), Hamil/Menyusui (scan button only, no streak), no plan yet, signed out. Tap: `joyorogo://makan-ai` (the scan camera, same link as the 1x1
Android widget; a signed-out person is sent to the login and back); signed out and "no plan" only open the app.

## Keeping Swift and TypeScript the same

- `StreakModel.swift` is a port; `widget-ios-check/streak-vectors.json` holds the TypeScript model's answers for 21 scenarios aged over 10 days (210 cases), day
  strings at the midnights of all three zones and timeline dates. `swiftc` + `widget-ios-check/main.swift` fail on any difference:

  ```bash
  swiftc -O apps/native/targets/widget/StreakModel.swift apps/native/targets/widget/StreakStore.swift apps/native/widget-ios-check/main.swift -o /tmp/streak-check
  /tmp/streak-check apps/native/widget-ios-check/streak-vectors.json      # runs on Linux with a Swift toolchain too
  ```

- `bun test` (`ios-streak.test.ts`) fails when `streak-vectors.json` or `streak-copy.json` is stale. After changing `streak-model.ts` or any `misc:widget...` string:
  `UPDATE_WIDGET_FILES=1 bun test src/lib/widgets/ios-streak.test.ts`. A new copy key must also be listed in `IOS_STREAK_COPY_KEYS` (`ios-streak.ts`).
- The same test checks that the App Group, widget kind, storage keys and tap link are spelled the same in Swift, `app.json` and TypeScript.
- The Swift colours repeat `theme.ts` (`Palette` in `StreakWidget.swift`); change both.
- Joyo PNGs come from the 512 px mascot in `apps/web/public/mascot`:
  `magick apps/web/public/mascot/<pose>.webp -trim +repage -resize 'x300>' -strip <pose>.png`.

## Signing and the Apple Developer portal (owner steps)

The widget is a second bundle id, `com.joyodigitama.joyorogo.widget`, and the app and the widget share the App Group `group.com.joyodigitama.joyorogo`. **Both
bundle ids need the App Groups capability with that group, or the widget reads nothing and shows the signed-out tile.** Done on 2026-10-24: the group is registered
("JoyoRogo shared") and both App IDs show "Enabled App Groups (1)". The API can register the bundle id and switch the capability on (the scripts do), but it has no
resource for App Groups, so for a new group the steps are:

1. <https://developer.apple.com/account> -> Certificates, Identifiers & Profiles -> Identifiers -> **+** -> **App Groups** -> Continue. Description `JoyoRogo`, identifier
   `group.com.joyodigitama.joyorogo` -> Register.
2. Identifiers -> App IDs -> `com.joyodigitama.joyorogo` -> check **App Groups** -> **Configure** -> tick `group.com.joyodigitama.joyorogo` -> Continue -> Save (Confirm).
3. The widget App ID: `scripts/build-ios-mac.sh` and `release-ios.yml` register `com.joyodigitama.joyorogo.widget` and enable App Groups themselves. If you prefer the portal:
   Identifiers -> **+** -> App IDs -> App -> Explicit `com.joyodigitama.joyorogo.widget`, description `JoyoRogo widget`, App Groups -> Continue -> Register. Then open it,
   **Configure** App Groups and tick the same group -> Save. Do this once, even if the scripts registered the id: the scripts cannot pick the group.
4. Nothing in App Store Connect: the extension travels inside the app's record. Nothing in EAS (this repo builds with `scripts/ios/mac-build.sh`).

Profiles follow by themselves. Changing an App ID invalidates its profiles; `asc-ci-profile.py` / `asc-mac-profile.py` delete INVALID `joyo-ci ...` / `joyo-mac ...` profiles and make
new ones, and `xcodebuild -allowProvisioningUpdates` refreshes the automatic development profiles of the archive (the target sets `REGISTER_APP_GROUPS = YES`, so Xcode
may register the group itself when the API key's role allows it; [INFERENCE], not tried). If a build fails with a profile that "doesn't include the com.apple.security.application-groups
entitlement", step 2 or 3 is missing; fix the portal and run the build again.

What changed in the build path:

- `mac-build.sh` (MacBook and `release-ios.yml`): the export options list a profile per bundle id (`EXPORT_PROFILE` for the app, new `EXPORT_WIDGET_PROFILE` for the widget; setting
  one without the other stops with a message), and step 6 checks the IPA: `PlugIns/JoyoRogoWidget.appex` exists, its bundle id, `CFBundleVersion` = `BUILD_NUMBER`, same version
  as the app, WidgetKit extension point, copy and images inside, App Store profile without devices, `get-task-allow` false, Apple Distribution signature, and the App Group in the
  entitlements of both the app and the extension.
- `release-ios.yml` fetches two profiles (`asc-ci-profile.py` now registers a missing bundle id and enables the capabilities given as extra arguments, here `APP_GROUPS`).
- `scripts/build-ios-mac.sh` enables APP_GROUPS on both ids and installs both profiles on the Mac.
- `scripts/build-ios-linux.sh` already refuses to run (it cannot embed the expo-updates resources) and cannot build a SwiftUI extension either: iOS builds go through the Mac scripts or `release-ios.yml`.
- The build number: `CURRENT_PROJECT_VERSION=$BUILD_NUMBER` on the `xcodebuild archive` command line reaches the widget target too, so app and extension carry the same `CFBundleVersion`.

## Runtime version

The config plugin and the extension change the Expo fingerprint of **both** platforms (the plugin's files and the `plugins` list are hashed into `runtimeVersion`).
Binaries built before this commit keep their old runtime: an OTA update published from this commit or later does not reach them (`docs/ota.md`). Build Android and iOS from this
commit or later before publishing OTA updates.

## Checking it

- CI: `.github/workflows/ios-widget.yml` (macOS runner, no secrets) runs the Swift model check, `expo prebuild`, `pod install`, an unsigned Release build of the `JoyoRogoWidget` target and checks the
  built `.appex`. It runs when the widget, `app.json`, `package.json`, plugins, the i18n `misc.json` files or `scripts/ios` change, and by hand.
- Locally on Linux, with the Swift toolchain and iOS SDK of the Linux pipeline, the Swift sources type-check against the real SDK (this is how the code was checked here):

  ```bash
  B=~/.config/swiftpm/swift-sdks/darwin.artifactbundle
  ~/.local/swift-6.4/usr/bin/swiftc -typecheck -sdk $B/Developer/Platforms/iPhoneOS.platform/Developer/SDKs/iPhoneOS27.0.sdk \
    -resource-dir $B/Developer/Toolchains/XcodeDefault.xctoolchain/usr/lib/swift -target arm64-apple-ios16.4 -module-name widget \
    -parse-as-library apps/native/targets/widget/*.swift
  ```

- On a Mac with Xcode, `cd apps/native && bunx expo prebuild --platform ios --clean && xed ios`, scheme `JoyoRogo`, then the `expo:targets/widget` folder holds the Swift files; run the
  `JoyoRogo` scheme on a simulator or iPhone and add the widget from the home screen gallery.

## Not verified yet (owner, on a Mac or iPhone)

Nothing below could be run from the Linux laptop (the MacBook was offline on 2026-10-23). The CI job covers compiling, not behaviour.

- The first signed build after the portal steps: `Release iOS` run or `scripts/build-ios-mac.sh`, step 6 passes (embedded extension, both profiles, App Group on both).
- On an iPhone from TestFlight: add Streak Catat (small and medium), sign in, open Beranda: the widget shows the flame and number; log a meal in the app: it flips to the lit state;
  the layout (number, Joyo, caption) looks right on small iPhones (SE) and large ones, in light and dark mode, and with the iOS 18 tinted home screen (Joyo should keep his colours).
- Plus Jakarta Sans really loads in the extension (otherwise SwiftUI silently draws the system font).
- Midnight: leave the phone overnight without opening the app; in the morning the widget reads "at risk" (and, a day later, "N hari tanpa catat").
- Tap opens the scan camera; signed out, tap opens the app. Sign out in the app: the widget goes to "Masuk dulu". Switch the app language: the widget follows.
- App Store processing accepts the build (ITMS warnings about the extension's privacy manifest, if any).
