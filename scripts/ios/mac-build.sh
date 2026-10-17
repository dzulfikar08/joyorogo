#!/usr/bin/env bash
# JoyoRogo iOS build, run ON macOS with Xcode (the MacBook, or any Mac with the toolchain below).
# Linux laptop: use scripts/build-ios-mac.sh, which runs this on the MacBook over SSH.
#
#   scripts/ios/mac-build.sh            prebuild, pods, archive, export, check build/ios-mac/JoyoRogo.ipa
#   scripts/ios/mac-build.sh --upload   ...then upload it to App Store Connect with altool
#
# Needs on PATH: node, bun, pod (CocoaPods 1.17), Xcode (xcodebuild, xcrun altool).
# Env:
#   BUILD_NUMBER   CFBundleVersion, YYYYMMDDHHMM (UTC) by default, as the Linux pipeline
#   ASC_KEY_ID / ASC_ISSUER_ID / ASC_KEY_PATH   App Store Connect API key; default path is
#                  ~/.appstoreconnect/private_keys/AuthKey_<id>.p8 (mode 600, never in git)
#   MAC_BUILD_OUT  output directory (default <repo>/build/ios-mac)
#   REPO_DIR       checkout to build (default: the repo this script lives in)
#
# Signing: automatic, through the API key (xcodebuild -allowProvisioningUpdates). The archive is
# signed with the Apple Distribution identity in the login keychain; the export gets an App Store
# profile from App Store Connect. Run it in the logged-in GUI session (the Linux driver does), an
# SSH session cannot use the keychain's private keys (errSecInternalComponent).
set -euo pipefail
REPO=${REPO_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}
cd "$REPO"
mode=${1:-}
OUT=${MAC_BUILD_OUT:-$REPO/build/ios-mac}

APP=JoyoRogo
BUNDLE_ID=com.joyodigitama.joyorogo
TEAM_ID=F6Q6UFUK69
JS_DIR=$REPO/apps/native
IOS_DIR=$JS_DIR/ios

export ASC_KEY_ID=${ASC_KEY_ID:-BUU2CPKLGM}
export ASC_ISSUER_ID=${ASC_ISSUER_ID:-9e34111d-e39f-4122-9000-6eb4628fe9b9}
export ASC_KEY_PATH=${ASC_KEY_PATH:-$HOME/.appstoreconnect/private_keys/AuthKey_$ASC_KEY_ID.p8}
BUILD_NUMBER=${BUILD_NUMBER:-$(date -u +%Y%m%d%H%M)}
[ -f "$ASC_KEY_PATH" ] || { echo "no App Store Connect key at $ASC_KEY_PATH" >&2; exit 1; }
for tool in node bun pod xcodebuild xcrun; do
  command -v "$tool" > /dev/null || { echo "$tool is not on PATH" >&2; exit 1; }
done
export LANG=en_US.UTF-8
AUTH=(-allowProvisioningUpdates -authenticationKeyPath "$ASC_KEY_PATH"
      -authenticationKeyID "$ASC_KEY_ID" -authenticationKeyIssuerID "$ASC_ISSUER_ID")

step() { printf '\n== %s ==\n' "$*"; }
START=$SECONDS
lap() { printf '   [%dm%02ds]\n' $(((SECONDS - START) / 60)) $(((SECONDS - START) % 60)); }

# Metro keeps its transform and file-map caches in the temp dir; one left by a build of another checkout
# bundled the router with no routes (a blank app, no error). Own temp dir per build, old caches removed.
rm -rf "$OUT"
mkdir -p "$OUT/tmp"
rm -rf "$(getconf DARWIN_USER_TEMP_DIR)"metro-* "$(getconf DARWIN_USER_TEMP_DIR)"haste-map-* 2> /dev/null || true
export TMPDIR=$OUT/tmp

step "Toolchain"
xcodebuild -version | tr '\n' ' '; echo
echo "node $(node -v), bun $(bun -v), pod $(pod --version 2> /dev/null | tail -n1)"
echo "$APP $(git rev-parse --short HEAD) build $BUILD_NUMBER"

step "1. bun install --frozen-lockfile"
bun install --frozen-lockfile 2>&1 | tail -n 3
lap

# Release JS env, as scripts/build-release-apk.sh and scripts/build-ios-linux.sh: beats apps/native/.env (local dev,
# not in git, so not on the Mac either).
export NODE_ENV=production
export EXPO_PUBLIC_SERVER_URL="https://api.joyorogo.com"
export EXPO_PUBLIC_DEV_LOGIN=0
export EXPO_PUBLIC_FB_APP_ID=1016598258111944

step "2. expo prebuild --platform ios --clean"
(cd "$JS_DIR" && bunx expo prebuild --platform ios --clean --no-install 2>&1 | tail -n 1)
# Prebuild writes app.json's buildNumber into Info.plist as a literal, so the build setting does not reach it.
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion $BUILD_NUMBER" "$IOS_DIR/$APP/Info.plist"
lap

# EXPO_PRECOMPILED_FLAVOR=release as on Linux. Expo's precompiled modules were not found on the MacBook ("prebuilt config
# not found" in pod-install.log), so the Expo pods compile from source here and end up in the executable.
step "3. pod install"
(cd "$IOS_DIR" && EXPO_PRECOMPILED_FLAVOR=release pod install > "$OUT/pod-install.log" 2>&1) ||
  { tail -n 40 "$OUT/pod-install.log" >&2; exit 1; }
lap

step "4. xcodebuild archive"
# Progress: the log goes to a file, the console gets the target being built, warnings about signing and errors.
progress() {
  awk '
    /^\*\* / || /error:/ || /[Pp]rovisioning [Pp]rofile|Signing Identity/ { print; fflush(); next }
    match($0, /\(in target .[^'"'"']+/) {
      t = substr($0, RSTART + 12, RLENGTH - 12)
      if (!(t in seen)) { seen[t] = 1; print "   " t; fflush() }
    }'
}
xcodebuild archive -workspace "$IOS_DIR/$APP.xcworkspace" -scheme "$APP" -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$OUT/$APP.xcarchive" "${AUTH[@]}" \
  DEVELOPMENT_TEAM="$TEAM_ID" CURRENT_PROJECT_VERSION="$BUILD_NUMBER" \
  > "$OUT/xcodebuild-archive.log" 2>&1 < /dev/null &
build=$!
tail -n +1 -F "$OUT/xcodebuild-archive.log" 2> /dev/null | progress &
follow=$!
if ! wait "$build"; then
  sleep 1; kill "$follow" 2> /dev/null || true
  grep -E 'error:|\*\* ARCHIVE FAILED' "$OUT/xcodebuild-archive.log" | head -n 20 >&2
  echo "archive failed; full log: $OUT/xcodebuild-archive.log" >&2
  exit 1
fi
sleep 1; kill "$follow" 2> /dev/null || true
lap

step "5. xcodebuild -exportArchive (app-store-connect)"
# With EXPORT_PROFILE (the name of an installed App Store profile) the export signs manually with the Apple
# Distribution identity in the keychain. Automatic export needs a cloud-managed distribution certificate, which
# the API key on the MacBook may not create ("Cloud signing permission error").
if [ -n "${EXPORT_PROFILE:-}" ]; then
  SIGNING="<key>signingStyle</key><string>manual</string>
  <key>provisioningProfiles</key><dict><key>$BUNDLE_ID</key><string>$EXPORT_PROFILE</string></dict>"
else
  SIGNING="<key>signingStyle</key><string>automatic</string>"
fi
cat > "$OUT/ExportOptions.plist" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>export</string>
  <key>teamID</key><string>$TEAM_ID</string>
  $SIGNING
  <key>signingCertificate</key><string>Apple Distribution</string>
  <key>manageAppVersionAndBuildNumber</key><false/>
  <key>stripSwiftSymbols</key><true/>
  <key>uploadSymbols</key><false/>
</dict>
</plist>
PLIST
xcodebuild -exportArchive -archivePath "$OUT/$APP.xcarchive" -exportPath "$OUT/export" \
  -exportOptionsPlist "$OUT/ExportOptions.plist" "${AUTH[@]}" > "$OUT/xcodebuild-export.log" 2>&1 ||
  { tail -n 30 "$OUT/xcodebuild-export.log" >&2; exit 1; }
IPA=$OUT/$APP.ipa
cp "$OUT/export/$APP.ipa" "$IPA"
lap

step "6. Check the IPA"
CHECK=$OUT/ipa
rm -rf "$CHECK" && mkdir -p "$CHECK" && unzip -q "$IPA" -d "$CHECK"
APPDIR=$CHECK/Payload/$APP.app
plist() { /usr/libexec/PlistBuddy -c "Print :$2" "$1" 2> /dev/null; }
fail() { echo "CHECK FAILED: $*" >&2; exit 1; }

[ "$(plist "$APPDIR/Info.plist" CFBundleIdentifier)" = "$BUNDLE_ID" ] || fail "bundle id is not $BUNDLE_ID"
[ "$(plist "$APPDIR/Info.plist" CFBundleVersion)" = "$BUILD_NUMBER" ] || fail "CFBundleVersion is not $BUILD_NUMBER"
sdk=$(plist "$APPDIR/Info.plist" DTSDKName)
case $sdk in iphoneos2[6-9]* | iphoneos[3-9]*) ;; *) fail "built with $sdk, App Store Connect wants the iOS 26 SDK or later" ;; esac

# Entitlements and profile: an App Store profile has no device list and no get-task-allow.
security cms -D -i "$APPDIR/embedded.mobileprovision" > "$OUT/profile.plist"
[ -z "$(plist "$OUT/profile.plist" ProvisionedDevices)" ] || fail "embedded profile lists devices (not an App Store profile)"
codesign -d --entitlements :- "$APPDIR" > "$OUT/entitlements.plist" 2> /dev/null
[ "$(plist "$OUT/entitlements.plist" get-task-allow)" = false ] || fail "get-task-allow is not false"
for key in com.apple.developer.healthkit com.apple.developer.applesignin aps-environment; do
  plist "$OUT/entitlements.plist" "$key" > /dev/null || echo "   note: entitlement $key is not signed in (the Linux IPA has what the app asks for)"
done
codesign --verify --deep --strict "$APPDIR" || fail "code signature does not verify"
authority=$(codesign -dvv "$APPDIR" 2>&1 | sed -n 's/^Authority=\(Apple Distribution.*\)/\1/p')
[ -n "$authority" ] || fail "not signed with an Apple Distribution identity"
echo "   $BUNDLE_ID $(plist "$APPDIR/Info.plist" CFBundleShortVersionString) ($BUILD_NUMBER), $sdk, $authority"

# app.config freshness: Constants.expoConfig reads the embedded app.config at run time (cloud URLs in `extra`).
(cd "$JS_DIR" && bunx expo config --type public --json) > "$OUT/expo-config.json"
node -e '
  const fs = require("fs");
  const want = JSON.parse(fs.readFileSync(process.argv[1], "utf8")).extra ?? {};
  const have = JSON.parse(fs.readFileSync(process.argv[2], "utf8")).extra ?? {};
  const stale = Object.keys(want).filter((k) => JSON.stringify(have[k]) !== JSON.stringify(want[k]));
  if (stale.length) { console.error("EXConstants app.config is out of date with app.json (extra: " + stale.join(", ") + ")"); process.exit(1); }
' "$OUT/expo-config.json" "$APPDIR/EXConstants.bundle/app.config" || fail "stale app.config"

# Bundle sanity. Metro with a bad cache bundled the router with no routes (about 1000 modules instead of 1600, no error);
# the Apple Health module's name is in app code only (requireOptionalNativeModule): a bundle without it has no app in it.
# Every ENV.X read must be inlined at build time: a leftover EXPO_PUBLIC_* name is a runtime proxy read, which throws
# "varlock ENV not initialized" on launch. The inlined server URL must be the live API.
[ -f "$APPDIR/main.jsbundle" ] || fail "no main.jsbundle in the app"
STRINGS=$(LC_ALL=C strings -a "$APPDIR/main.jsbundle")
grep -q AppleHealth <<< "$STRINGS" || fail "main.jsbundle holds no app code (Metro bundled without the routes)"
if grep -qE 'EXPO_PUBLIC_(SERVER_URL|DEV_LOGIN)' <<< "$STRINGS"; then
  fail "release bundle reads ENV at runtime (not inlined): $(grep -oE 'EXPO_PUBLIC_(SERVER_URL|DEV_LOGIN)' <<< "$STRINGS" | sort -u | tr '\n' ' ')"
fi
grep -qF "$EXPO_PUBLIC_SERVER_URL" <<< "$STRINGS" || fail "release bundle does not contain the API URL $EXPO_PUBLIC_SERVER_URL"
echo "   main.jsbundle $(stat -f %z "$APPDIR/main.jsbundle") bytes, app code present, API URL inlined"
ls -l "$IPA" | awk '{print "   ipa " $5 " bytes"}'
lap

echo "ipa: $IPA"

if [ "$mode" = --upload ]; then
  step "7. Upload to App Store Connect (altool)"
  # altool reads AuthKey_<id>.p8 from ~/.appstoreconnect/private_keys; ASC_KEY_PATH has to be there.
  [ "$(cd "$(dirname "$ASC_KEY_PATH")" && pwd)" = "$HOME/.appstoreconnect/private_keys" ] ||
    { echo "altool needs the key in ~/.appstoreconnect/private_keys" >&2; exit 1; }
  xcrun altool --upload-app --type ios --file "$IPA" --apiKey "$ASC_KEY_ID" --apiIssuer "$ASC_ISSUER_ID" 2>&1
  echo "uploaded: $APP $BUILD_NUMBER"
  lap
fi
