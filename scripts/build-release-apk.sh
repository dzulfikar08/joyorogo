#!/usr/bin/env bash
# Release APK: signed with the local keystore, arm64-only, R8 + resource shrinking.
# Keystore lives OUTSIDE android/ so prebuild never wipes it. Back it up —
# updates must be signed with the same key.
set -euo pipefail
cd "$(dirname "$0")/.."
NATIVE=apps/native
KEYSTORE_DIR="$NATIVE/keystore"
KEYSTORE="$KEYSTORE_DIR/joyorogo-release.jks"
PROPS="$KEYSTORE_DIR/keystore.properties"

export JAVA_HOME="${JAVA_HOME:-$HOME/jdk17}"
export PATH="$JAVA_HOME/bin:$PATH"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/android-sdk}"

# Release JS env. Set in the process so it beats apps/native/.env (local dev:
# localhost API + dev login), which Expo's CLI otherwise loads for the bundle.
export NODE_ENV=production
# The app talks to this API, baked in at build time. Self-hosting? Point it at
# your own server (and change the Android package id in apps/native/app.json).
export EXPO_PUBLIC_SERVER_URL="https://api.joyorogo.dzulfikar.com"
export EXPO_PUBLIC_DEV_LOGIN=0

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

# 2. Fresh prebuild.
cd "$NATIVE"
rm -rf android
bunx expo prebuild -p android --no-install 2>&1 | tail -1

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
                storeFile file(keystoreProperties['storeFile'])
                storePassword keystoreProperties['storePassword']
                keyAlias keystoreProperties['keyAlias']
                keyPassword keystoreProperties['keyPassword']
            }
        }
        debug {""",
        1,
    )
    # Only the release buildType switches to the release config.
    s = s.replace(
        """        release {
            signingConfig signingConfigs.debug""",
        """        release {
            signingConfig signingConfigs.release""",
        1,
    )
    app.write_text(s)
    print("build.gradle patched")

props = pathlib.Path("android/gradle.properties")
p = props.read_text()
# ARCHS=x86_64 builds an emulator-testable APK; ship arm64-v8a only.
p = re.sub(r"reactNativeArchitectures=.*", "reactNativeArchitectures=" + os.environ.get("ARCHS", "arm64-v8a"), p)
p = re.sub(r"enableProGuardInReleaseBuilds=.*", "enableProGuardInReleaseBuilds=true", p)
p = re.sub(r"enableShrinkResourcesInReleaseBuilds=.*", "enableShrinkResourcesInReleaseBuilds=true", p)
props.write_text(p)
print("gradle.properties patched")
PY

# 4. Build.
cd android
./gradlew assembleRelease --no-daemon
APK=app/build/outputs/apk/release/app-release.apk

# 5. Bundle sanity. Every ENV.X read must be inlined at build time: a leftover
# EXPO_PUBLIC_* name means a runtime proxy read, which throws "varlock ENV not
# initialized" on launch. The inlined server URL must be the live API.
BUNDLE_STRINGS=$(unzip -p "$APK" assets/index.android.bundle | strings)
if grep -qE 'EXPO_PUBLIC_(SERVER_URL|DEV_LOGIN)' <<<"$BUNDLE_STRINGS"; then
  echo "release bundle reads ENV at runtime (not inlined): $(grep -oE 'EXPO_PUBLIC_(SERVER_URL|DEV_LOGIN)' <<<"$BUNDLE_STRINGS" | sort -u | tr '\n' ' ')" >&2
  exit 1
fi
if ! grep -qF "$EXPO_PUBLIC_SERVER_URL" <<<"$BUNDLE_STRINGS"; then
  echo "release bundle does not contain the API URL $EXPO_PUBLIC_SERVER_URL" >&2
  exit 1
fi

cp "$APK" "$OLDPWD/../../.."/joyorogo-release.apk
ls -la "$OLDPWD/../../.."/joyorogo-release.apk
echo RELEASE-APK-DONE
