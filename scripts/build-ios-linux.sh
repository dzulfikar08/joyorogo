#!/usr/bin/env bash
# iOS App Store build on Linux, no Xcode and no Mac.
#
#   scripts/build-ios-linux.sh            build + sign build/ios/JoyoRogo.ipa (App Store)
#   scripts/build-ios-linux.sh --upload   ...then upload it to App Store Connect (TestFlight)
#   scripts/build-ios-linux.sh --dev      build + development-sign build/ios/JoyoRogo-dev.ipa
#                                         for the team's registered iPhones (USB install)
#
# Pipeline: expo prebuild -> pod install (CocoaPods on Linux, shims in
# scripts/ios/shims/pod) -> ExpoModulesJSI cross-built with SwiftPM ->
# scripts/ios/gen-ninja.rb turns the Pods + app projects into build.ninja ->
# ninja compiles every pod with the Swift toolchain's clang/swiftc against the
# iPhoneOS SDK -> JS bundle + Hermes bytecode -> asset catalog, launch
# storyboard, Info.plist -> Apple Distribution signature (rcodesign) -> .ipa.
#
# One-time host setup (see docs/ios-linux.md):
#   - Swift 6.4 toolchain                    SWIFT_BIN   (~/.local/swift-6.4/usr/bin)
#   - omarchy-apple-dev, with its darwin Swift SDK built from Xcode 27's .xip
#     (`xtool sdk build`), Linux actool built  OMARCHY_APPLE_DEV (~/.local/share/omarchy-apple-dev)
#   - CocoaPods gem, ninja, rcodesign, ld64.lld, llvm-ar, rsync
#   - App Store Connect API key              ASC_KEY_PATH ASC_KEY_ID ASC_ISSUER_ID
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$PWD
NATIVE=$ROOT/apps/native
IOS=$NATIVE/ios
OUT=$ROOT/build/ios
CACHE=${XDG_CACHE_HOME:-$HOME/.cache}/joyorogo-ios
SWIFT_BIN=${SWIFT_BIN:-$HOME/.local/swift-6.4/usr/bin}
OAD=${OMARCHY_APPLE_DEV:-$HOME/.local/share/omarchy-apple-dev}
SWIFTPM_DIR=${XDG_CONFIG_HOME:+$XDG_CONFIG_HOME/swiftpm}
DARWIN=${DARWIN_SDK:-${SWIFTPM_DIR:-$HOME/.swiftpm}/swift-sdks/darwin.artifactbundle}
PY=${ASC_PYTHON:-$HOME/.local/share/joyorogo-ios/venv/bin/python}
mode=${1:-}

export ASC_KEY_ID=${ASC_KEY_ID:-BUU2CPKLGM}
export ASC_ISSUER_ID=${ASC_ISSUER_ID:-9e34111d-e39f-4122-9000-6eb4628fe9b9}
export ASC_KEY_PATH=${ASC_KEY_PATH:-$HOME/Downloads/AuthKey_$ASC_KEY_ID.p8}
export ASC_IDENTITY_DIR=${ASC_IDENTITY_DIR:-$HOME/.config/joyorogo-ios/distribution}
# asc.py stamp writes DTXcode/DTXcodeBuild; a .xip-built SDK does not record them.
# The SDK here comes from Xcode 27.0 (27A266a).
export XCODE_VERSION=${XCODE_VERSION:-27.0} XCODE_BUILD=${XCODE_BUILD:-27A266a}

# Release JS env, as in build-release-apk.sh: beats apps/native/.env (local dev).
export NODE_ENV=production
export EXPO_PUBLIC_SERVER_URL="https://api.joyorogo.com"
export EXPO_PUBLIC_DEV_LOGIN=0

SDK=$(ls -d "$DARWIN"/Developer/Platforms/iPhoneOS.platform/Developer/SDKs/iPhoneOS[0-9]*.sdk | tail -n1)
[ -d "$SDK" ] || { echo "no iPhoneOS SDK under $DARWIN; build it from Xcode.xip (docs/ios-linux.md)" >&2; exit 1; }
export PATH="$SWIFT_BIN:$PATH"
GEM_BIN=$(ruby -e 'print Gem.user_dir')/bin
export PATH="$GEM_BIN:$PATH"
mkdir -p "$OUT" "$CACHE"

step() { printf '\n== %s ==\n' "$*"; }

step "1. Expo prebuild"
(cd "$NATIVE" && rm -rf ios && bunx expo prebuild -p ios --no-install 2>&1 | tail -1)

step "2. pod install (release precompiled Expo modules)"
(cd "$IOS" && PATH="$ROOT/scripts/ios/shims/pod:$ROOT/scripts/ios/shims:$PATH" \
  LANG=en_US.UTF-8 NODE_BINARY="$(command -v node)" TAR_OPTIONS=--warning=no-unknown-keyword \
  EXPO_PRECOMPILED_FLAVOR=release pod install > "$OUT/pod-install.log" 2>&1) ||
  { tail -40 "$OUT/pod-install.log" >&2; exit 1; }

step "3. Expo macros plugin (Linux host build)"
# Bun's isolated install does not hoist expo-modules-core: reach it through expo.
MACROS_SRC=$(node -p "const r = (m, p) => require.resolve(m + '/package.json', {paths: [p]}); require('path').dirname(r('@expo/expo-modules-macros-plugin', r('expo-modules-core', r('expo', '$NATIVE'))))")/apple
MACROS_VERSION=$(node -p "require('$MACROS_SRC/../package.json').version")
MACROS=$CACHE/macros-$MACROS_VERSION
# On Linux SwiftPM names a macro's host tool after the target, no -tool suffix.
MACRO_TOOL=$MACROS/.build/release/ExpoModulesMacros
if [ ! -x "$MACRO_TOOL" ]; then
  rm -rf "$MACROS" && mkdir -p "$MACROS"
  cp -r "$MACROS_SRC/Package.swift" "$MACROS_SRC/Package.resolved" "$MACROS_SRC/Sources" "$MACROS/"
  # SwiftPM only builds a macro's host tool for a dependent target.
  "$PY" - "$MACROS/Package.swift" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read()
s = s.replace("  targets: [\n", '  targets: [\n    .target(name: "UseMacros", dependencies: ["ExpoModulesMacros"]),\n', 1)
open(p, "w").write(s)
PY
  mkdir -p "$MACROS/Sources/UseMacros" && echo "// builds the macro tool" > "$MACROS/Sources/UseMacros/Use.swift"
  (cd "$MACROS" && swift build -c release --target UseMacros 2>&1 | tail -2)
fi
echo "$MACRO_TOOL"

step "4. ExpoModulesJSI.xcframework (SwiftPM cross build)"
bash "$ROOT/scripts/ios/build-jsi.sh" "$IOS/Pods" "$DARWIN"

step "5. build.ninja"
cat > "$OUT/toolchain.json" <<EOF
{"sdk": "$SDK", "clang": "$SWIFT_BIN/clang", "swiftc": "$SWIFT_BIN/swiftc",
 "swift_resource_dir": "$DARWIN/Developer/Toolchains/XcodeDefault.xctoolchain/usr/lib/swift",
 "ar": "$(command -v llvm-ar)", "ld": "$DARWIN/toolset/bin/ld64.lld",
 "macro_plugin": "$MACRO_TOOL", "node": "$(command -v node)"}
EOF
ruby "$ROOT/scripts/ios/gen-ninja.rb" "$IOS" "$OUT" "$OUT/toolchain.json"

step "6. Compile and link"
(cd "$IOS" && bash -l -c "./Pods/Target\ Support\ Files/Pods-JoyoRogo/expo-configure-project.sh" > /dev/null)
ninja -C "$OUT"

step "7. Assemble, sign, package"
"$PY" "$ROOT/scripts/ios/assemble-app.py" "$OUT" "$NATIVE" "$SDK" "$OAD"
APP=$(ls -d "$OUT"/Payload/*.app)
ASC="$OAD/tools/asc.py"

if [ "$mode" = --dev ]; then
  # iOS Development certificate + profile for every registered iPhone, reused on later runs.
  "$PY" "$OAD/tools/provision-dev.py" --bundle-id "$(node -p "require('$OUT/app.json').bundle_id")" | tail -2
  rm -f "$OUT/JoyoRogo-dev.ipa"
  PATH="$(dirname "$PY"):$HOME/.cargo/bin:$PATH" bash "$OAD/tools/sign-dev.sh" "$APP" "$OUT/JoyoRogo-dev.ipa" | tail -1
  "$PY" "$OAD/tools/macho-lint.py" "$OUT/JoyoRogo-dev.ipa" | tail -1
  echo "ipa: $OUT/JoyoRogo-dev.ipa"
  exit 0
fi

DARWIN_SDK="$DARWIN" "$PY" "$ASC" stamp "$APP" "${BUILD_NUMBER:-$(date -u +%Y%m%d%H%M)}"
PATH="$HOME/.cargo/bin:$PATH" OMARCHY_APPLE_DEV="$OAD" \
  APP_ENTITLEMENTS=$(node -p "require('$OUT/app.json').entitlements") \
  "$PY" "$ROOT/scripts/ios/sign-app.py" "$APP" "$OUT/identity"
rm -f "$OUT/JoyoRogo.ipa"
(cd "$OUT" && zip -qry JoyoRogo.ipa Payload)
DARWIN_SDK="$DARWIN" "$PY" "$ASC" validate "$OUT/JoyoRogo.ipa"
echo "ipa: $OUT/JoyoRogo.ipa"

if [ "$mode" = --upload ]; then
  step "8. Upload to App Store Connect"
  "$PY" "$ASC" upload "$OUT/JoyoRogo.ipa"
fi
