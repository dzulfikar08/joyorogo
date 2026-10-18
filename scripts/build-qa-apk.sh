#!/usr/bin/env bash
# QA APK for on-device checks: a release-variant build (JS bundled, no Metro) with the
# Android package suffixed ".qa" (JOYOROGO_QA=1, see apps/native/app.config.ts) and signed with
# the throwaway debug key. It installs NEXT TO the real app and can never update or replace it,
# and it never touches the Play signing keystore.
#
#   scripts/build-qa-apk.sh   -> dist/joyorogo-qa.apk (package com.joyodigitama.joyorogo.qa)
#
# ARCHS overrides the ABI list (default arm64-v8a: every current phone, ~4x less native code).
# Used by the "QA Android" workflow and by hand from a clean worktree.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
NATIVE=apps/native

export JAVA_HOME="${JAVA_HOME:-$HOME/jdk17}"
export PATH="$JAVA_HOME/bin:$PATH"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/android-sdk}"

export NODE_ENV=production
export EXPO_PUBLIC_SERVER_URL="${EXPO_PUBLIC_SERVER_URL:-https://api.joyorogo.com}"
export EXPO_PUBLIC_DEV_LOGIN=0
export EXPO_PUBLIC_FB_APP_ID=1016598258111944
export JOYOROGO_DISTRIBUTION=play
export JOYOROGO_QA=1
export ARCHS="${ARCHS:-arm64-v8a}"
export VERSION_CODE="$(( ($(date -u +%s) - 1704067200) / 60 ))"

cd "$NATIVE"
rm -rf android
bunx expo prebuild -p android --no-install 2>&1 | tail -1

python3 - <<'PY'
import os, re, pathlib
app = pathlib.Path("android/app/build.gradle")
s = app.read_text()
s = re.sub(r"versionCode \d+", "versionCode " + os.environ["VERSION_CODE"], s, 1)
app.write_text(s)
props = pathlib.Path("android/gradle.properties")
p = props.read_text()
p = re.sub(r"reactNativeArchitectures=.*", "reactNativeArchitectures=" + os.environ["ARCHS"], p)
props.write_text(p)
PY

cd android
./gradlew assembleRelease
APK_SRC=app/build/outputs/apk/release/app-release.apk
AAPT2="$(ls "$ANDROID_HOME"/build-tools/*/aapt2 | sort -V | tail -1)"
if ! "$AAPT2" dump packagename "$APK_SRC" | grep -qx "com.joyodigitama.joyorogo.qa"; then
  echo "APK is not the .qa package: refusing to continue" >&2
  exit 1
fi
mkdir -p "$ROOT/dist"
cp "$APK_SRC" "$ROOT/dist/joyorogo-qa.apk"
ls -la "$ROOT/dist/joyorogo-qa.apk"
echo QA-APK-DONE
