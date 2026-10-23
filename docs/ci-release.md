# CI: checks and release builds

Written 2026-10-17. Workflows in `.github/workflows/`: `ci.yml`, the release workflows and `ios-widget.yml` (macOS compile check of the iPhone widget, below). The repo is public, so GitHub-hosted runners (macOS included) cost nothing.

| Workflow | Runs on | Needs secrets | Does |
| --- | --- | --- | --- |
| `ci.yml` | pull requests, pushes to `main`, manual | none (safe for forks, read-only token) | `Typecheck and build` (`tsrs` for `packages/*` and `apps/{server,web,admin,native}`, web and admin `vite build` with a dummy `VITE_SERVER_URL`) and `Tests and i18n check` (`bun test` for api, auth, i18n, server, native; `bun run i18n:check`) |
| `release-android.yml` | **manual only** (`workflow_dispatch`) | yes, environment `release` | ubuntu, JDK 17, Bun, Gradle cache: `scripts/build-release-apk.sh --play` (AAB + manifest permission guard) and/or `scripts/build-release-apk.sh` (site APK + update manifest, signing-key guard); artifacts; optional Play upload and R2 publish |
| `release-ios.yml` | **manual only** | yes, environment `release` | `scripts/ios/mac-build.sh` on `macos-latest`: expo prebuild, pods, `xcodebuild archive` + export, IPA checks, optional TestFlight upload |
| `ios-widget.yml` | pull requests and pushes to `main` that touch the widget (`apps/native/targets`, `app.json`, `package.json`, the i18n `misc.json` files, `scripts/ios`, ...), manual | none | `macos-latest`: Swift model check against the TypeScript vectors, `expo prebuild` + `pod install`, unsigned Release build of the `JoyoRogoWidget` target, checks of the built `.appex` (docs/ios-widget.md) |

The release workflows are ready but never fire by themselves. Tag triggers (`v*`) are commented out at the top of each file; uncomment them to build on tags (the `release` approval below still applies).

## Build numbers

The workflows call the same scripts as the laptop, so the numbers follow the same scheme and CI and local builds never collide:

- Android `versionCode` = minutes since 2024-01-01 UTC (`(now - 1704067200) / 60`).
- iOS `CFBundleVersion` = `YYYYMMDDHHMM` in UTC (`BUILD_NUMBER` overrides).

## Running a release

Actions tab -> workflow -> **Run workflow**, or:

```bash
gh workflow run release-android.yml -R dzulfikar08/joyorogo -f target=both -f play_track=none              # artifacts only
gh workflow run release-android.yml -R dzulfikar08/joyorogo -f target=play-aab -f play_track=alpha -f play_status=draft
gh workflow run release-android.yml -R dzulfikar08/joyorogo -f target=site-apk -f publish_site_apk=true   # needs CLOUDFLARE_API_TOKEN
gh workflow run release-ios.yml -R dzulfikar08/joyorogo -f upload_testflight=false
```

The job waits for the owner's approval (environment `release`): Actions run page -> **Review deployments** -> tick `release` -> Approve. Via API: `gh api -X POST repos/dzulfikar08/joyorogo/actions/runs/<run-id>/pending_deployments -F 'environment_ids[]=<env-id>' -f state=approved -f comment=ok` (`environment_ids` from `GET .../runs/<run-id>/pending_deployments`).

Results are workflow artifacts (30 days): `joyorogo-android-<run>` (AAB, site APK and `joyorogo-latest.json`, checksums in the run summary) and `joyorogo-ios-<run>` (IPA). Nothing is uploaded to a store unless you choose it:

- **Play**: `play_track` = `internal`, `alpha` (the API name of the closed-testing track the app is on today) or `beta`. `play_status` = `draft` (default, finish the rollout in Play Console) or `completed`. Production is deliberately not offered.
- **TestFlight**: tick `upload_testflight`. The IPA goes to App Store Connect (altool); add it to an internal testing group in App Store Connect.
- **Site APK** (what the in-app updater downloads): tick `publish_site_apk`. The job uploads `joyorogo-latest.apk` then `joyorogo-latest.json` to the R2 bucket `joyorogo-downloads` (the two `wrangler r2 object put` calls of `scripts/build-release-apk.sh --publish`). It first checks that the APK is signed with the same key as the installed ones (see below).

## GitHub setup (done)

- Environment `release`: required reviewer `dzulfikar08` (self-review allowed, this is a one-person repo), deployments only from `main` and `v*` tags. All release secrets are **environment secrets**, so a workflow on any other branch cannot read them.
- Workflows use only `workflow_dispatch` (and optional tag push), never `pull_request_target`; PR runs (`ci.yml`) get no secrets. Every action is pinned to a commit SHA (version in the trailing comment); `GITHUB_TOKEN` is `contents: read`.
- Signing files are written to the runner at build time and deleted in a final `always()` step; secret values are never echoed.

## Secrets (environment `release`)

Set with `gh secret set NAME --env release -R dzulfikar08/joyorogo` (value from stdin or `< file`). Never commit these files.

| Secret | Used by | Source |
| --- | --- | --- |
| `ANDROID_KEYSTORE_BASE64` | Android | base64 of `apps/native/keystore/joyorogo-release.jks` (from `secrets/joyorogo-keystore.tar.gpg`) |
| `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` | Android | `keystore.properties` in the same archive |
| `PLAY_SERVICE_ACCOUNT_JSON` | Android, Play upload | `~/.config/joyorogo/play-billing-sa.json` |
| `CLOUDFLARE_API_TOKEN` | Android, site publish | **not set, owner step**: Cloudflare dashboard -> My Profile -> API Tokens -> Create Token -> template "Edit Cloudflare Workers" is too broad; use a custom token with **Account / Workers R2 Storage / Edit** for account `b7e6f8457bd39fa37a7eea5249799754`. Wrangler on the laptop is logged in with OAuth, which cannot be copied into CI. Then `gh secret set CLOUDFLARE_API_TOKEN --env release -R dzulfikar08/joyorogo` and paste it. |
| `ASC_KEY_BASE64` | iOS | base64 of `AuthKey_BUU2CPKLGM.p8` (App Store Connect API key) |
| `ASC_KEY_ID` | iOS | `BUU2CPKLGM` |
| `ASC_ISSUER_ID` | iOS | `9e34111d-e39f-4122-9000-6eb4628fe9b9` |
| `IOS_DIST_CERT_P12_BASE64`, `IOS_DIST_CERT_PASSWORD` | iOS | `.p12` of the Apple Distribution identity the Linux pipeline signs with (`~/.config/joyorogo-ios/distribution/{cert.der,key.pem}`), made with a random password, see "iOS signing" |

Refresh commands (run on the laptop):

```bash
cd "$(mktemp -d)" && gpg --batch --pinentry-mode loopback --passphrase-file ~/.config/joyorogo/keystore-backup-passphrase \
  --decrypt ~/Documents/JoyoDigitama/joyorogo/secrets/joyorogo-keystore.tar.gpg | tar -xf -
base64 -w0 keystore/joyorogo-release.jks | gh secret set ANDROID_KEYSTORE_BASE64 --env release -R dzulfikar08/joyorogo
# the three passwords/alias: read them from keystore/keystore.properties and pipe each into gh secret set (no echo)
gh secret set PLAY_SERVICE_ACCOUNT_JSON --env release -R dzulfikar08/joyorogo < ~/.config/joyorogo/play-billing-sa.json
base64 -w0 ~/Downloads/AuthKey_BUU2CPKLGM.p8 | gh secret set ASC_KEY_BASE64 --env release -R dzulfikar08/joyorogo
```

## Android notes

- The keystore secrets restore exactly what `gpg --decrypt secrets/joyorogo-keystore.tar.gpg` restores locally; the workflow checks nothing else in your home directory.
- **Sideload APK signing.** The published site APK and the in-app updater use the Expo template's **debug** key (SHA-256 `fac61745...3b9c`, `docs/play-store.md` "Signing warning"), not the release keystore; `prebuild` recreates that key, so CI produces the same signer. The job compares the built APK's signer with `SIDELOAD_CERT_SHA256` (top of `release-android.yml`) and fails before anything is published if they differ. Update that value only when you deliberately change the sideload key (installed copies would have to be reinstalled).
- The Play AAB uses the release keystore as upload key.
- Play upload uses `PLAY_SERVICE_ACCOUNT_JSON` (`joyorogo-play-billing@joyorogo.iam.gserviceaccount.com`). On 2026-10-17 a probe with this account created and deleted an edit on `com.joyodigitama.joyorogo` and `com.joyodigitama.joyofit`, listed their tracks, and a track update reached release validation (404 unknown versionCode, not 403), so it has release-management rights. A real AAB upload has **not** been run from CI: the first one is the proof. If Play answers 403, give the service account "Release to testing tracks" for the app in Play Console -> Users and permissions.

## iOS signing

The app embeds a WidgetKit extension (`com.joyodigitama.joyorogo.widget`, docs/ios-widget.md), so the archive and the export sign two bundle ids. Both need the App Groups capability with `group.com.joyodigitama.joyorogo`: the group itself is a one-time portal step (docs/ios-widget.md, "Signing and the Apple Developer portal"). The job fetches an App Store profile for each bundle id (`EXPORT_PROFILE`, `EXPORT_WIDGET_PROFILE`).

Same split as `scripts/build-ios-mac.sh` (`docs/ios-mac.md`), because a fresh runner has no keychain identity and the API key cannot create a cloud-managed distribution certificate (`Cloud signing permission error`; the team also already holds the maximum of three Apple Distribution certificates):

1. The archive is signed automatically with the API key (`xcodebuild -allowProvisioningUpdates`, Apple Development profile).
2. The export is signed manually. The job imports `IOS_DIST_CERT_P12_BASE64` into a temporary keychain, `scripts/ios/asc-ci-profile.py` finds that certificate on App Store Connect by serial and reuses or creates the App Store profile `joyo-ci <bundle id> <cert id>` for the app and for the widget (separate from the `joyo-mac` and Linux profiles, so no flow invalidates another's), and `mac-build.sh` exports with `EXPORT_PROFILE` and `EXPORT_WIDGET_PROFILE`. The script then checks the IPA (Apple Distribution authority, no device list, `get-task-allow` false, entitlements, bundle contents).

No owner step is needed: the `.p12` was made from the certificate and key the Linux pipeline already uses. To rebuild it (new certificate, new password):

```bash
cd ~/.config/joyorogo-ios/distribution
pw=$(openssl rand -hex 16)
openssl x509 -inform der -in cert.der -out /tmp/cert.pem
openssl pkcs12 -export -inkey key.pem -in /tmp/cert.pem -out /tmp/dist.p12 -name "Apple Distribution" \
  -certpbe PBE-SHA1-3DES -keypbe PBE-SHA1-3DES -macalg sha1 -password pass:$pw   # old algorithms: macOS `security import` needs them
base64 -w0 /tmp/dist.p12 | gh secret set IOS_DIST_CERT_P12_BASE64 --env release -R dzulfikar08/joyorogo
printf %s "$pw" | gh secret set IOS_DIST_CERT_PASSWORD --env release -R dzulfikar08/joyorogo
shred -u /tmp/dist.p12 /tmp/cert.pem
```

The certificate expires 2027-10-15; the profile `joyo-ci ...` is recreated by the script when it goes INVALID (for example after enabling a capability in the portal). The runner's Xcode is `latest-stable` (26.6 on the dry run); pick another with the `xcode_version` input. Apple requires Xcode 26 or later for App Store uploads.

## Measured on GitHub-hosted runners (2026-10-17)

| Run | Result | Time |
| --- | --- | --- |
| `release-android.yml`, `both` | green; AAB + permission guard, site APK + signing-key guard, no uploads | about 29 min (AAB 19 min, APK 7 min) |
| `release-ios.yml`, upload off | green; IPA signed `Apple Distribution: Dzulfikar Ats Tsauri (F6Q6UFUK69)`, all `mac-build.sh` checks passed | about 22 min |
| `ci.yml` | green | about 2 min |

The first Android attempt ran out of memory in R8 (`minifyReleaseWithR8`, 2 GB template heap); the workflow now writes the laptop's machine-wide `~/.gradle/gradle.properties` (6 GB heap) before building.

## Switching to CI from the laptop / MacBook builds

1. Check the secrets table above is fully set (`gh secret list --env release -R dzulfikar08/joyorogo`).
2. Run `release-android.yml` with `play_track = none` once and compare the AAB with a local one.
3. Run `release-ios.yml` with `upload_testflight` off once and compare with a Mac or Linux IPA.
4. From then on, choose the track / tick the TestFlight upload in the run form instead of running the scripts locally. The scripts stay as the fallback; do not run a local and a CI build in the same minute.

## Branch protection

`main` requires the two `ci.yml` checks to pass (`Typecheck and build, Tests and i18n check`), on top of the existing pull-request rule, but admins are not enforced, so the owner's direct pushes still go through (GitHub prints "Bypassed rule violations"). To make the checks binding for everyone, including the owner: Settings -> Branches -> `main` -> tick "Do not allow bypassing the above settings", or `gh api -X PATCH repos/dzulfikar08/joyorogo/branches/main/protection/enforce_admins` (POST) after which every change needs a pull request with green checks.
