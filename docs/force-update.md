# Update gate (force update to the store build)

Written 2026-10-19. Many reports were about bugs we had already fixed; the reporters were on old builds. The native app now checks at launch and blocks builds older than a minimum that **we** set, with no code deploy.

## Behaviour

1. **OTA freshness (cold start).** `refreshOtaAtLaunch()` (`src/lib/use-ota-update.ts`) asks expo-updates for a bundle for this runtime; if there is one it downloads it and reloads before the app shows. A "Memperbarui..." splash covers the wait for at most 8 s (`OTA_LAUNCH_TIMEOUT_MS`), then the app opens (the download carries on and surfaces as the existing "Mulai ulang" banner). Offline or error: the app opens. Dev clients and Expo Go skip it (`OTA_ENABLED`).
2. **Minimum build.** `GET /api/config` (public, works signed out) carries `app`:

   ```json
   { "android": { "minBuild": 0, "latestBuild": 0, "storeUrl": "https://play.google.com/store/apps/details?id=com.joyodigitama.joyorogo" },
     "ios":     { "minBuild": 0, "latestBuild": 0, "storeUrl": "https://apps.apple.com/id/app/id6823222101?ct=joyorogo-evergreen-update" },
     "message": "optional one-liner" }
   ```

   The app compares its `expo-application` `nativeBuildVersion` (Android versionCode, iOS CFBundleVersion) with it, on cold start and on resume (re-fetch at most every 15 min):
   - build < `minBuild`: full-screen blocking "Update dulu, ya" over everything (Android back is swallowed). "Update sekarang" opens `market://details?id=com.joyodigitama.joyorogo` (https fallback); iOS opens the App Store URL as is. "Cek lagi" re-fetches.
   - `minBuild` <= build < `latestBuild`: dismissible "Ada versi baru" banner (24 h snooze), **iOS only**; Android already gets Play's own in-app update banner (`docs/in-app-updates.md`).
   - **Fail open:** no network, bad payload, unknown installed build, web: never blocks. The last good answer is cached in SecureStore for 1 h and used if the fetch fails; an older cache is ignored. A server that does not send `app` counts as "gate off".
3. The gate and the Play/Apple billing paths do not interact; `/api/config` is the same endpoint `useAppConfig()` uses (`appConfigQuery()` in `components/billing.tsx`), so one cache entry serves both.

## Turn it on (Worker vars, no code deploy)

`apps/server/wrangler.jsonc` `vars` (defaults `"0"` = off, so App Review and Play review builds are never blocked until you say so):

| Var | Meaning |
| --- | --- |
| `MIN_BUILD_ANDROID` / `MIN_BUILD_IOS` | builds below this are blocked |
| `LATEST_BUILD_ANDROID` / `LATEST_BUILD_IOS` | iOS banner threshold (raised to at least the min) |
| `ANDROID_STORE_URL` / `IOS_STORE_URL` | optional https overrides of the defaults (Play listing, App Store listing) |
| `UPDATE_MESSAGE` | optional one-line reason (200 chars), shown under the standard text |

Steps: 1) the fixed build must already be live in Play / the App Store (otherwise users are blocked with nothing to install); 2) read its number (Android versionCode = minutes since 2024-01-01 UTC, see `docs/ci-release.md`; iOS `buildNumber`); 3) set the var, `cd apps/server && CLOUDFLARE_ACCOUNT_ID=3268f27664d77716b648b00c8850469e bunx wrangler deploy`. Roll back by setting it to `"0"` and redeploying. Do not set a minimum above a build that App Review has not yet released: reviewers on an older build would see the block.

## Who gets this code

It is JS only (`expo-application` and `expo-secure-store` were already native deps), so it does not change the runtimeVersion fingerprint. It reaches every installed binary whose runtimeVersion already receives OTA updates from the `production` channel (the current Play and TestFlight builds), via `scripts/ota.sh`. Binaries built before expo-updates was added, or whose runtime was never published to, cannot receive it and will not be gated until the user updates by hand.

## Code

- Server: `apps/server/src/app-version.ts` (+ test), `/api/config` in `apps/server/src/billing.ts`, vars in `.env.schema` and `wrangler.jsonc`.
- Native: pure rules `src/lib/force-update.ts` (+ `force-update.test.ts`), hook `src/lib/use-force-update.ts`, UI `components/update-gate.tsx` mounted in `app/_layout.tsx`, copy `settings:update.gate.*` (id + en).
