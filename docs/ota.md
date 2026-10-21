# Over-the-air JS updates (EAS Update)

Written 2026-10-18. JS and asset fixes (keyboard layout, notices, copy, logic) reach installed apps in minutes instead of waiting for a store build and review. The native binaries are still built by our own scripts (`scripts/build-release-apk.sh`, `scripts/build-ios-mac.sh`, the `Release *` workflows). Only the update hosting is EAS: **EAS Update works with self-built binaries**, no EAS Build is involved.

| | |
| --- | --- |
| Library | `expo-updates` (`apps/native`) |
| EAS project | `@dzulfikar08/joyorogo`, id `808b0d66-86af-4b95-835d-904c89803103` (`app.json`: `extra.eas.projectId`, `updates.url`, `owner`) |
| runtimeVersion | `{ "policy": "fingerprint" }` |
| Channels | `production` (App Store, TestFlight, Play builds), `preview` (the QA Android build). Each channel points at a branch of the same name |
| Publish | `scripts/ota.sh "<message>"` or the **OTA update** workflow |
| Signing | none: EAS Update code signing needs a paid EAS plan (see Signing) |

## What may ship over the air (store policy)

Only **JS and asset bug fixes and improvements** that leave the app doing what it was submitted to do.

- Apple: interpreted code may be downloaded as long as it does not change the app's primary purpose or add features inconsistent with what was reviewed (guidelines 3.3.1 and 4.7; the same rule sits in the Developer Program License Agreement). The code runs in React Native's own JS engine, not a downloaded native binary.
- Google Play: the Device and Network Abuse policy forbids an app from modifying or replacing itself by any method other than Play's update mechanism, with an exception for code that runs in an interpreter or VM that only reaches Android APIs indirectly. Hermes JS is that case. Native code never ships over the air.

Fine over the air: layout, keyboard handling, spacing, copy and translations, notice logic, calculations, bug fixes, new screens built from what the app already does, image assets.

**Not** over the air, ship a reviewed build:

- a new primary purpose, or a feature the store listing and review notes do not describe;
- anything about payments: product ids, prices shown for digital goods, checkout paths, the Play/Apple billing split (`components/billing.tsx`, `src/distribution.ts`). Store billing rules apply to the build under review, not to a later JS swap;
- new permissions or a new use of an existing one, new data collection or sharing (Play Data safety, App Store privacy labels), new SDKs or trackers;
- anything that opens a store of other code, or bypasses OS signing or sandboxing;
- native code, config plugins, `app.json` native settings, native dependencies (they cannot ship over the air anyway, see below).

Wording above is our reading of the policies; read the current Apple and Google text before a gray-area change.

## How a build and an update find each other: runtimeVersion

`runtimeVersion` policy `fingerprint`: every binary embeds a hash of its native side, and the update server only offers an update published for **that** hash. An update can therefore never land on a binary with incompatible native code. A mismatch is silent and safe: the app keeps running what it has (the server answers 204).

What goes into the hash (checked with `expo-updates runtimeversion:resolve`, whole list in its `fingerprintSources`):

- the whole resolved Expo config: `app.json` + `app.config.ts` output, **including `version`, `extra`, name, scheme, permissions, plugin list and `updates`**;
- the source of local config plugins (`plugins/*.js`), icon and splash images;
- every autolinked native package (directory contents, so a native dependency bump or add);
- `scripts` in `apps/native/package.json`, and `.gitignore`. `apps/native/fingerprint.config.js` hashes `tsrs` as `tsc` in them, so moving the type-check tool did not move the runtime (the tsrs switch once did, until this hook; any other edit to those scripts still does);
- `JOYOROGO_DISTRIBUTION` and `JOYOROGO_QA`, through the config.

Not in the hash: JS and TS source, JS-only dependencies, the generated `android/` and `ios/` folders (gitignored, expo-updates ignores them so a prebuild changes nothing), `versionCode` / build numbers set at build time.

Consequences:

- Bumping `version` in `app.json`, or touching any native-relevant line above, creates a **new runtimeVersion**. Updates published afterwards only reach binaries built from that state. Commits that only change JS leave it alone.
- Android store builds set `JOYOROGO_DISTRIBUTION=play` (the build script exports it); iOS leaves it unset. `scripts/ota.sh` mirrors that per platform, and so must anything else that publishes. Publishing Android without it would also ship `extra.distribution = "sideload"` to Play users (updater and external checkout on), so never run a bare `eas update` by hand.
- QA builds (`JOYOROGO_QA=1`) have their own runtimeVersion and listen to `preview`, so a test update never reaches real users.
- Check what a commit resolves to: `scripts/ota.sh --runtime` (add `--channel preview` for the QA build). The Profil "Pembaruan cepat" card shows the first 8 characters of the runtime a device runs; they must match what `ota.sh` prints for the update to reach it.

## Behaviour in the app

- `updates.checkAutomatically: ON_LOAD`, `fallbackToCacheTimeout: 0`: on cold start the app launches immediately with the newest bundle it already has (embedded or a downloaded update), checks the server in the background and downloads a newer update. It is applied on the **next cold start**.
- `src/lib/use-ota-update.ts` (`expo-updates` `useUpdates`) drives the UI: when an update is downloaded, the existing in-app update banner (`components/update-banner.tsx`) shows "Pembaruan siap dipasang / Mulai ulang"; **Mulai ulang** reloads into it, **Nanti** keeps going until the next cold start. An OTA banner beats the Play and APK prompts.
- The Profil card "Pembaruan cepat" (`components/ota-update-card.tsx`, next to "Pembaruan aplikasi") shows which bundle runs (built into the app, or update `<id>` from `<date>`), channel and runtime, the state (checking, downloading with percent, ready, error) and a manual check.
- On returning to the foreground the app re-checks, at most every 6 hours (`CHECK_THROTTLE_MS`), so a phone that is never cold-started still gets fixes.
- Off in dev clients, Expo Go and on the web (`Updates.isEnabled` false): the card and checks do not exist there.
- **Failure falls back to the embedded bundle.** A failed check or download changes nothing. A downloaded update that crashes on start is dropped by expo-updates' launch error recovery and the app runs the previous or embedded bundle; after a rollback the card says "versi bawaan aplikasi". (Not exercised on a device in this session: do the test below after the first OTA-enabled build.)

## Publish

```
scripts/ota.sh "Fix keyboard overlap in the food sheet"          # production, android + ios
scripts/ota.sh --platform android "Copy fix"                     # one platform
scripts/ota.sh --channel preview "Try it on the QA build"        # preview, android QA build
scripts/ota.sh --runtime                                         # runtimeVersion only
```

It runs `bun run check-types`, `bun test ./src/` and `bun run i18n:check` in `apps/native`, then per platform a release-env `expo export` (the store builds' `NODE_ENV=production`, API URL, dev login off; it fails when `EXPO_PUBLIC_*` is not inlined or the API URL is missing from the bundle), then `eas update --channel <channel> --skip-bundler` with that bundle, and prints one line per platform:

```
android  channel=production  runtimeVersion=<hash>  group=<update group id>
```

Android and iOS are two update groups on purpose (different distribution env, different runtimeVersion). Nothing goes to a store.

The same from GitHub: Actions, **OTA update**, Run workflow (`message`, `channel`, `platform`). The job is bound to the `release` environment (owner approval, default branch only) and uses its `EXPO_TOKEN` secret. The group ids land in the job summary.

## Roll back

Instant, no store involved. Devices pick it up at their next check (next cold start or foreground re-check).

```
bunx eas-cli update:rollback <group id> --non-interactive
```

The group must be the **latest** one of its branch and runtimeVersion (the id `ota.sh` just printed). It republishes the update group published before it, or a "roll back to embedded" directive when there is none. Other options:

```
bunx eas-cli update:roll-back-to-embedded --channel production --runtime-version <hash> --platform android
bunx eas-cli update:republish --group <older group id>        # re-publish a specific earlier update
bunx eas-cli update:list --branch production                  # find group ids
```

Or just publish a corrected fix with `scripts/ota.sh`. Roll Android and iOS back separately (two groups).

## When OTA is not enough

Anything that changes the runtimeVersion, or is on the "not over the air" list above, needs a new binary: bump nothing by hand, build through `scripts/build-release-apk.sh` / `scripts/build-ios-mac.sh` / the `Release *` workflows, and from that commit on updates target the new runtime. Older binaries keep receiving updates published for their own runtimeVersion only if you still publish from a commit with that fingerprint (check out the build's commit).

Binaries built before expo-updates was added (anything older than the commit that introduced it) have no OTA and never will.

`scripts/build-ios-linux.sh` refuses to run: the Xcode-free pipeline does not embed the expo-updates resources (`app.manifest`, runtime in `Expo.plist`) [inference: a binary without them would start with updates on and nothing embedded]. Build iOS on the Mac or in the `Release iOS` workflow. `JOYO_ALLOW_IOS_LINUX_WITHOUT_UPDATES=1` overrides.

## Signing

EAS Update code signing (`codeSigningCertificate`, `eas update --private-key-path`) is **not enabled**: publishing with a key fails with "EAS Update code signing requires a subscription to the EAS Production or Enterprise plan" on the free account `dzulfikar08` (seen on 2026-10-18). A binary that embeds a certificate rejects unsigned updates, so config and plan must change together. Without it, trust rests on TLS to `u.expo.dev` plus control of the Expo account and the `EXPO_TOKEN` secret: keep 2FA on the Expo account.

To turn it on after upgrading the plan: `bunx expo-updates codesigning:generate --key-output-directory ~/.config/joyorogo/ota --certificate-output-directory code-signing --certificate-validity-duration-years 10 --certificate-common-name joyorogo`, add `updates.codeSigningCertificate` and `codeSigningMetadata` (`keyid: main`, `alg: rsa-v1_5-sha256`) to `app.json`, commit the certificate (`!/code-signing/certificate.pem` in `.gitignore`, `*.pem` is ignored), pass `--private-key-path` in `scripts/ota.sh`, put the private key in an `OTA_PRIVATE_KEY` secret of the `release` environment and write it to a temp file in `ota.yml`. Then **every** binary built after that expects signed updates.

## Accounts and secrets

- Expo account `dzulfikar08`; project created with `bunx eas-cli init`; channels with `eas channel:create production|preview`.
- `EXPO_TOKEN`: personal access token "github-actions-ota" (expo.dev, Account settings, Access tokens), stored as the `release` environment secret of `dzulfikar08/joyorogo` and in `~/.config/joyorogo/expo-token` (mode 600). Revoke it on that page if it leaks; local runs use the `eas login` session instead.

## Testing after the first OTA-enabled build

1. Install the build (QA APK for the preview channel; TestFlight or Play internal for production). Profil, "Pembaruan cepat": "Berjalan: versi bawaan aplikasi", channel and the 8-character runtime. `scripts/ota.sh --runtime` (with `--channel preview` for QA) must print the same prefix.
2. Publish a visible JS change: `scripts/ota.sh --channel preview "test"`. Cold start the app twice: the first start downloads (banner "Pembaruan siap dipasang" appears when it finishes), the second runs it; the card shows "Berjalan: pembaruan <id> (<date>)".
3. `bunx eas-cli update:rollback <group> --non-interactive`, cold start twice: the card is back to the embedded bundle.
4. Airplane mode, cold start: the app starts normally and the card does not complain beyond "Gagal memeriksa".
