#!/usr/bin/env bash
# Release APK: signed with the local keystore, arm64-only, R8 + resource shrinking.
#
#   scripts/build-release-apk.sh [--clean] [--publish]   sideload APK (self-updater, R2)
#   scripts/build-release-apk.sh --play [--clean]        Google Play AAB -> dist/joyorogo-play-<versionCode>.aab
#
# --play builds with JOYOROGO_DISTRIBUTION=play (see apps/native/app.config.ts):
# no REQUEST_INSTALL_PACKAGES, no APK self-updater, no external checkout;
# arm64-v8a + armeabi-v7a; signed with the same keystore as the upload key
# (Play App Signing re-signs for users). ARCHS overrides the ABI list.
# Keystore lives OUTSIDE android/ so prebuild never wipes it. Back it up —
# updates must be signed with the same key.
set -euo pipefail
cd "$(dirname "$0")/.."
# Absolute repo root: later steps run from apps/native/android.
ROOT="$(pwd)"
NATIVE=apps/native
KEYSTORE_DIR="$NATIVE/keystore"
KEYSTORE="$KEYSTORE_DIR/joyorogo-release.jks"
PROPS="$KEYSTORE_DIR/keystore.properties"

export JAVA_HOME="${JAVA_HOME:-$HOME/jdk17}"
export PATH="$JAVA_HOME/bin:$PATH"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/android-sdk}"

# ~/.gradle is a symlink to the SSD image (/run/media/dzul/ioswork/gradle-home); without the mount Gradle would fail on a dangling link.
if [ -L "$HOME/.gradle" ] && [ ! -d "$HOME/.gradle/" ]; then
  echo "~/.gradle -> $(readlink "$HOME/.gradle") is not there: the ioswork SSD image is not mounted." >&2
  echo "mount it: udisksctl loop-setup -f /run/media/dzul/Data/dzul-offload/ios-work.ext4" >&2
  exit 1
fi

# Release JS env. Set in the process so it beats apps/native/.env (local dev:
# localhost API + dev login), which Expo's CLI otherwise loads for the bundle.
export NODE_ENV=production
# The app talks to this API, baked in at build time. Self-hosting? Point it at
# your own server (and change the Android package id in apps/native/app.json).
export EXPO_PUBLIC_SERVER_URL="https://api.joyorogo.com"
export EXPO_PUBLIC_DEV_LOGIN=0
# Meta app "JoyoDigitama": direct Instagram Stories share (public id, shared with JoyoFit).
export EXPO_PUBLIC_FB_APP_ID=1016598258111944

# --publish uploads the APK + update manifest to the R2 bucket after a
# successful build. Without it the build only writes them to the repo root.
# --clean forces a fresh prebuild and a cold native build.
PUBLISH=0
CLEAN=0
PLAY=0
for arg in "$@"; do
  case "$arg" in
    --publish) PUBLISH=1 ;;
    --clean) CLEAN=1 ;;
    --play) PLAY=1 ;;
    *) echo "unknown option: $arg" >&2; exit 1 ;;
  esac
done
if [ "$PLAY" = 1 ] && [ "$PUBLISH" = 1 ]; then
  echo "--play and --publish are exclusive: the AAB is uploaded in Play Console, not R2" >&2
  exit 1
fi
if [ "$PLAY" = 1 ]; then
  export JOYOROGO_DISTRIBUTION=play
  export ARCHS="${ARCHS:-arm64-v8a,armeabi-v7a}"
else
  export JOYOROGO_DISTRIBUTION=sideload
fi

# Android versionCode = minutes since 2024-01-01 UTC: strictly increases per
# build and needs no manual bump in app.json. YYMMDDHHmm looked tidy but
# overflows Android's int32 limit (2610130359 > 2147483647, and Play caps at
# 2100000000), which fails Gradle with "Value is null". This stays under
# 2100000000 for millennia. The in-app updater compares this number against
# the installed build.
export VERSION_CODE="$(( ($(date -u +%s) - 1704067200) / 60 ))"

# 1. Keystore — generated once, reused forever. The password lives only in
#    the gitignored keystore.properties next to it; keep both backed up, an
#    APK signed with a different key can't update existing installs.
if [ ! -f "$KEYSTORE" ]; then
  mkdir -p "$KEYSTORE_DIR"
  STORE_PASS="$(openssl rand -hex 24)"
  keytool -genkeypair -v -keystore "$KEYSTORE" -alias joyorogo \
    -keyalg RSA -keysize 2048 -validity 10000 \
    -storepass "$STORE_PASS" -keypass "$STORE_PASS" \
    -dname "CN=JoyoRogo, OU=Personal, O=JoyoRogo, L=Malang, ST=JawaTimur, C=ID"
  cat > "$PROPS" <<EOF
storeFile=$KEYSTORE
storePassword=$STORE_PASS
keyAlias=joyorogo
keyPassword=$STORE_PASS
EOF
  chmod 600 "$PROPS"
  echo "keystore created: $KEYSTORE"
fi

# 2. Prebuild, only when native inputs changed. Wiping android/ also wipes
#    app/build and the .cxx CMake caches, so every release recompiled all
#    native code from scratch. Inputs: app config, deps, local native modules
#    and the assets prebuild copies (icons, splash).
cd "$NATIVE"
STAMP=android/.prebuild-hash
PREBUILD_HASH="$(
  { sha256sum app.json app.config.ts package.json "$ROOT/bun.lock"
    echo "distribution=$JOYOROGO_DISTRIBUTION"
    find plugins -type f -print0 | sort -z | xargs -0 sha256sum
    find modules assets -type f -print0 | sort -z | xargs -0 sha256sum
  } | sha256sum | cut -d' ' -f1
)"
if [ "$CLEAN" = 1 ] || [ ! -f "$STAMP" ] || [ "$(cat "$STAMP")" != "$PREBUILD_HASH" ]; then
  rm -rf android
  bunx expo prebuild -p android --no-install 2>&1 | tail -1
  echo "$PREBUILD_HASH" > "$STAMP"
else
  echo "native inputs unchanged; reusing android/"
fi

# 3. Release signing + shrinking patches.
python3 - <<'PY'
import os, re, pathlib
app = pathlib.Path("android/app/build.gradle")
s = app.read_text()
if "keystore.properties" not in s:
    s = s.replace(
        "android {",
        """def keystoreProperties = new Properties()
def keystorePropertiesFile = rootProject.file("../keystore/keystore.properties")
if (keystorePropertiesFile.exists()) {
    keystoreProperties.load(new FileInputStream(keystorePropertiesFile))
}

android {""",
        1,
    )
    s = s.replace(
        """    signingConfigs {
        debug {""",
        """    signingConfigs {
        release {
            if (keystorePropertiesFile.exists()) {
                storeFile new File(keystorePropertiesFile.parentFile, new File(keystoreProperties['storeFile']).name)
                storePassword keystoreProperties['storePassword']
                keyAlias keystoreProperties['keyAlias']
                keyPassword keystoreProperties['keyPassword']
            }
        }
        debug {""",
        1,
    )
    app.write_text(s)
    print("build.gradle patched")

# The keystore sits next to keystore.properties, and the file written above
# stores a repo-relative storeFile that Gradle would resolve against app/.
# Resolve by file name beside the properties file instead; also upgrades an
# android/ that was patched by an older version of this script.
s = app.read_text()
s = s.replace(
    "storeFile file(keystoreProperties['storeFile'])",
    "storeFile new File(keystorePropertiesFile.parentFile, new File(keystoreProperties['storeFile']).name)",
)
app.write_text(s)

# Release buildType signing, set on every build (android/ is reused across
# sideload and --play builds). Play builds use the keystore as the Play upload
# key. Sideload builds stay on the template's debug key: that is what the
# installed APKs and the published latest-apk are signed with, and Android
# refuses an in-place update across keys (install would need an uninstall).
# The SDK 57 template puts comment lines between `release {` and
# `signingConfig`, so match across them and fail loudly instead of silently
# shipping the wrong key.
s = app.read_text()
use = "release" if os.environ["JOYOROGO_DISTRIBUTION"] == "play" else "debug"
s, n = re.subn(
    r"(buildTypes \{.*?\n        release \{.*?signingConfig signingConfigs\.)(?:debug|release)",
    lambda m: m.group(1) + use,
    s, count=1, flags=re.S,
)
if n != 1:
    raise SystemExit("could not set the release signingConfig in android/app/build.gradle")
app.write_text(s)

# versionCode from UTC time (see VERSION_CODE above); runs every build since
# android/ is now reused across builds.
s = app.read_text()
s = re.sub(r"versionCode \d+", "versionCode " + os.environ["VERSION_CODE"], s, 1)
app.write_text(s)

props = pathlib.Path("android/gradle.properties")
p = props.read_text()
# ARCHS=x86_64 builds an emulator-testable APK; ship arm64-v8a only.
p = re.sub(r"reactNativeArchitectures=.*", "reactNativeArchitectures=" + os.environ.get("ARCHS", "arm64-v8a"), p)
# app/build.gradle reads android.enableMinifyInReleaseBuilds and
# android.enableShrinkResourcesInReleaseBuilds; the template has neither line,
# so set them explicitly (a sub on a missing key silently leaves R8 off).
for key in ("android.enableMinifyInReleaseBuilds", "android.enableShrinkResourcesInReleaseBuilds"):
    p = re.sub(rf"^{re.escape(key)}=.*\n?", "", p, flags=re.M)
    p = p.rstrip("\n") + f"\n{key}=true\n"
props.write_text(p)
print("gradle.properties patched")
PY

# 4. Build.
cd android
if [ "$PLAY" = 1 ]; then
  ./gradlew bundleRelease
  APK=app/build/outputs/bundle/release/app-release.aab
else
  ./gradlew assembleRelease
  APK=app/build/outputs/apk/release/app-release.apk
fi

# 5. Bundle sanity. Every ENV.X read must be inlined at build time: a leftover
# EXPO_PUBLIC_* name means a runtime proxy read, which throws "varlock ENV not
# initialized" on launch. The inlined server URL must be the live API.
if [ "$PLAY" = 1 ]; then BUNDLE_ENTRY=base/assets/index.android.bundle; else BUNDLE_ENTRY=assets/index.android.bundle; fi
BUNDLE_STRINGS=$(unzip -p "$APK" "$BUNDLE_ENTRY" | strings)
if grep -qE 'EXPO_PUBLIC_(SERVER_URL|DEV_LOGIN)' <<<"$BUNDLE_STRINGS"; then
  echo "release bundle reads ENV at runtime (not inlined): $(grep -oE 'EXPO_PUBLIC_(SERVER_URL|DEV_LOGIN)' <<<"$BUNDLE_STRINGS" | sort -u | tr '\n' ' ')" >&2
  exit 1
fi
if ! grep -qF "$EXPO_PUBLIC_SERVER_URL" <<<"$BUNDLE_STRINGS"; then
  echo "release bundle does not contain the API URL $EXPO_PUBLIC_SERVER_URL" >&2
  exit 1
fi

if [ "$PLAY" = 1 ]; then
  mkdir -p "$ROOT/dist"
  AAB="$ROOT/dist/joyorogo-play-$VERSION_CODE.aab"
  cp "$APK" "$AAB"
  ls -la "$AAB"
  echo "versionCode=$VERSION_CODE"
  echo RELEASE-AAB-DONE
  exit 0
fi

cp "$APK" "$ROOT/joyorogo-release.apk"

# 6. Update manifest: what the in-app updater fetches as latest-apk.json.
VERSION_NAME="$(grep -o '"version": "[^"]*"' "$ROOT/$NATIVE/app.json" | head -1 | cut -d'"' -f4)"
SIZE="$(stat -c %s "$ROOT/joyorogo-release.apk")"
SHA="$(sha256sum "$ROOT/joyorogo-release.apk" | cut -d' ' -f1)"
MD5="$(md5sum "$ROOT/joyorogo-release.apk" | cut -d' ' -f1)"
cat > "$ROOT/joyorogo-latest.json" <<EOF
{ "versionCode": $VERSION_CODE, "versionName": "$VERSION_NAME", "size": $SIZE, "sha256": "$SHA", "md5": "$MD5", "publishedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)" }
EOF
ls -la "$ROOT/joyorogo-release.apk" "$ROOT/joyorogo-latest.json"

# 7. Optional publish. APK first, manifest last: the manifest must never point
#    at a missing APK. Run from apps/server so wrangler reads its config.
if [ "$PUBLISH" = 1 ]; then
  cd "$ROOT/apps/server"
  bunx wrangler r2 object put "joyorogo-downloads/joyorogo-latest.apk" \
    --file "$ROOT/joyorogo-release.apk" \
    --content-type "application/vnd.android.package-archive" --remote
  bunx wrangler r2 object put "joyorogo-downloads/joyorogo-latest.json" \
    --file "$ROOT/joyorogo-latest.json" \
    --content-type "application/json" --remote
fi
echo RELEASE-APK-DONE
