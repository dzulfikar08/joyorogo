# Native Google Sign-In (Android)

Why: the browser flow (Chrome Custom Tab, `expo-authorization-proxy`, the hand-off page in
`apps/server/src/app-handoff.ts`) never returns on some devices (POCO M6 Pro / HyperOS: Chrome crashes in Google's
account chooser). On Android both apps now sign in with Google's account picker from Play services and send the ID token
to better-auth. iOS keeps the browser flow (Google) and Sign in with Apple; web is unchanged.

## Flow

1. `GoogleSignin.configure({ webClientId })` with the **web** client id (`GOOGLE_WEB_CLIENT_ID`, equal to the server's
   `GOOGLE_CLIENT_ID`), so the ID token's audience is the web client. better-auth's Google provider verifies the token
   against `options.clientId` (signature, issuer, audience, age).
2. `GoogleSignin.signIn()` shows the picker. The Android OAuth client only has to exist for package + signing SHA-1;
   its id is never put in the app.
3. `authClient.signIn.social({ provider: "google", idToken: { token } })`. The server runs the same
   `handleOAuthUserInfo` as the web callback (account id = Google `sub`), so an existing Google account is found and a
   new one is created like on the web (`overrideUserInfoOnSignIn` still refreshes name and photo). No server change was
   needed. The response sets the session cookie; `expoClient` stores it in SecureStore exactly as for the browser flow
   and Apple sign-in.
4. Then the usual post-login routing (JoyoRogo: `restoreAccountPrefs` then the destination; JoyoFit: `useSession`).

Code: `apps/native/src/lib/google-native.ts` (pure selection / fallback logic, tested in `google-native.test.ts`),
`google-native-device.ts` (React Native adapter), `app/login.tsx`. JoyoFit has the same files in `src/cloud/`
(`googleNative*.ts`) used by `CloudProvider.signIn`.

## Selection and fallback

| Situation | Result |
| --- | --- |
| Android binary with the module | native picker |
| Android binary without the module (an OTA on an older store build) | browser flow (`TurboModuleRegistry.get("RNGoogleSignin")` is checked before the library is imported; it throws on import when missing) |
| iOS, web | browser flow / Apple, unchanged |
| User closes the picker | nothing happens, no fallback |
| Developer error `10` (package + SHA-1 not registered) or no Play services | browser flow, with `[google] native sign-in unavailable, using the browser flow: ...` in the log |
| Any other native error, or the server rejects the token | error shown, no fallback |

## Google Cloud (project `joyorogo`, number 915036968874)

Web client `915036968874-0ne1edkq0laljg6cdlnksor1hqpj9gfr.apps.googleusercontent.com` is the audience.

Android OAuth clients (type Android, package + SHA-1):

| App | Key | SHA-1 |
| --- | --- | --- |
| `com.joyodigitama.joyorogo` | Play app signing | `83:13:8D:EF:77:D7:E2:64:65:E6:AE:EE:01:F4:10:5C:D2:F7:B6:FC` |
| | upload | `9B:5D:38:51:24:8E:60:3F:3B:15:30:EC:F3:E2:F9:29:9D:C0:B4:EA` |
| | previous | `D0:EC:05:7F:...`, `36:D0:F5:B5:...` |
| `com.joyodigitama.joyofit` | Play app signing | `F1:A1:EA:C2:...` |
| | upload / sideload | `32:92:14:D5:...` |
| | previous | `E1:F8:DD:90:...`, `FE:CF:31:EC:...` |

**Whenever a signing key changes** (new keystore, new Play app signing key, a CI keystore, a debug build you want to
sign in with), add its SHA-1 as an Android OAuth client for that package. Until then that build gets developer error
`10` and silently uses the browser flow. Get the SHA-1 with `keytool -list -v -keystore <file>` or Play Console > App
integrity.

## Build notes

- Dependency: `@react-native-google-signin/google-signin` 16.1.5 (original Google Sign-In API, `play-services-auth`).
  It is native code: **a new store build is required**; an OTA alone keeps the browser flow.
- No Expo config plugin entry: its Android work (Firebase classpath / `google-services.json`) is already done by
  `android.googleServicesFile`, and the iOS part (`iosUrlScheme`) is not used because iOS is not native here. The
  library autolinks.
- `google-services.json` does not change.
- Testing a sideload build: it must be signed with a registered key (JoyoFit sideload = upload key `32:92:14:D5`). Tap
  the Google option; the picker appears with no browser. A key that is not registered shows the browser flow and the
  `developer error: 10` log line (`adb logcat -s ReactNativeJS`).
