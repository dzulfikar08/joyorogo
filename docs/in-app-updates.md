# In-app update prompt (Android)

Written 2026-10-17. One banner (`apps/native/components/update-banner.tsx`, mounted in `app/_layout.tsx`, logic in `apps/native/src/lib/use-app-update.ts`) tells Android users a newer build exists. iOS does nothing: TestFlight already notifies, and App Store installs are intentionally skipped.

## Which path an install takes

Decided once at start from the installer package name (`react-native-device-info` `getInstallerPackageName`):

| Install | Installer | Path |
| --- | --- | --- |
| Play Store, any track (internal, closed, open, production, internal app sharing) | `com.android.vending` | Play In-App Updates, **flexible** flow |
| Sideload APK from joyorogo.com (`JOYOROGO_DISTRIBUTION` unset) | anything else | `GET /downloads/latest-apk.json`, compare `versionCode` with `expo-application` `nativeBuildVersion`, banner installs `/downloads/latest-apk` |
| Play-flavoured build (`JOYOROGO_DISTRIBUTION=play`) not installed by Play | anything else | nothing (the published APK is signed with a different key and could not update it) |
| iOS, web | n/a | nothing |

## Behaviour

- Checks on every cold start and when the app returns to the foreground, throttled to once per 6 h (`CHECK_THROTTLE_MS`).
- Banner "Versi baru tersedia" with **Update** / **Nanti** (English strings under `settings:update.banner.*`). "Nanti" hides it for 24 h (`DISMISS_MS`, persisted in SecureStore `app-update-dismissed-at`).
- Play: **Update** opens Play's own confirm dialog, then Play downloads in the background (progress bar in the banner). When the download finishes the banner turns into **Mulai ulang**, which calls `completeUpdate()` and restarts into the new version. Declining Play's dialog counts as "Nanti".
- If the app is killed after accepting, the next start sees Play's `DEVELOPER_TRIGGERED` state and shows **Mulai ulang** straight away; a status event flips it back to the progress bar if bytes are still arriving.
- APK: **Update** downloads the APK in-app (md5 check) and opens the system installer, the same code as the Profil "Pembaruan aplikasi" card (`downloadAndInstallApk`). If that fails, the APK URL is opened in the browser.
- Pure rules (throttle, dismiss window, version compare, installer check) live in `src/lib/update-policy.ts`; `bun test ./src/` in `apps/native` covers them.

## Module choice

`sp-react-native-in-app-updates@2.0.0` (+ `react-native-device-info@15.0.2` for the installer name; the root `overrides` pins one copy because sp depends on 10.3.0 and its Android entry imports device-info).

- 2.0.0 (July 2026) ships a codegen TurboModule spec, so it targets the new architecture, which RN 0.86 (Expo SDK 57) requires. It autolinks without a config plugin (checked with `expo-modules-autolinking react-native-config --platform android`).
- It exposes what the flexible flow needs: download status events with bytes, and a separate `installUpdate()` for the restart.
- `expo-in-app-updates@0.12.0` was rejected: its native module calls `completeUpdate()` the moment the download finishes, so the app restarts without the user pressing "Mulai ulang", and it reports no download progress.
- The modules are loaded lazily (`play-update.android.ts`); a binary built before they were added, or Expo Go, just gets no prompt instead of crashing.

## Testing after the next build

In-App Updates only works for builds **installed by Google Play**, and only when Play has a **higher versionCode on the same track** that the tester is opted into. A local `expo run:android` or `adb install` build is never offered an update (installer is not `com.android.vending`, so the Play path is not even started).

1. Build two Play bundles with `scripts/build-release-apk.sh --play`; versionCode is minutes since 2024-01-01, so the second is always higher (see `docs/play-store.md`).
2. Upload build A and build B to the same track (internal testing is fastest, minutes). Install **A from the Play Store** on a tester device (opt-in link) and open it once.
3. Make B available (release it on the track) and wait until the Play Store shows "Update" for JoyoRogo. In-App Updates sees the update only after the Play Store app itself knows about it, which can lag a few minutes to hours; opening the Play Store page for JoyoRogo or clearing Play Store cache helps.
4. Open A. Expect the banner "Versi baru tersedia". Tap **Update**, accept Play's dialog, watch the progress bar, then tap **Mulai ulang**. The app relaunches as B.
5. Tap **Nanti** instead: the banner must stay away for 24 h, even after killing and reopening the app (clear the app's storage to reset).
6. Fastest loop, internal app sharing (Google's own test procedure, https://developer.android.com/guide/playcore/in-app-updates/test): install build A from an **internal app sharing link**; upload build B (higher versionCode) as a new internal sharing link; open B's link on the device but **do not install** from the Play page that appears; open JoyoRogo from the launcher. The update is then offered. Note: `inAppUpdatePriority` is not supported there (JoyoRogo does not use it).

Sideload path: install an older sideload APK (older than `joyorogo-latest.json` `versionCode`, which is what `scripts/build-release-apk.sh` uploads to R2), open it, expect the banner; **Update** shows download percent and then Android's installer.

Google's troubleshooting list: the Play account on the device must have installed the app from Play at least once, application ID and signing key must match the Play version, and the installed versionCode must be lower than the update's.

Debug helpers: `adb logcat | grep -i "InAppUpdates\|AppUpdate"` shows the Play Core side. The Play Store app caches update info, so after releasing B reopen the Play Store before expecting the banner.

## Limits

- Flexible flow only. Immediate updates and update priority are not used.
- Unknown on a cold start with an accepted-but-unfinished update: the banner shows "Mulai ulang" first (Play exposes no downloaded flag outside the status events). Tapping it while bytes are still downloading does nothing until the download completes.
