#!/usr/bin/env bash
# ExpoModulesJSI.xcframework (ios-arm64 slice) without Xcode.
#
# expo-modules-jsi ships as a SwiftPM package whose pod script phase runs
# xcodebuild. Here SwiftPM cross-compiles it with the darwin Swift SDK and the
# framework is laid out the way its build-xcframework.sh does: dylib with an
# @rpath framework install name, library-evolution swiftinterface, the
# generated -Swift.h plus public C++ headers, and its module map.
#
#   build-jsi.sh <Pods dir> <darwin.artifactbundle>
set -euo pipefail
PODS_ROOT=$(cd "$1" && pwd)
DARWIN=$2
NATIVE=$(cd "$PODS_ROOT/../.." && pwd)
CACHE=${XDG_CACHE_HOME:-$HOME/.cache}/joyorogo-ios
J=$(node -p "const r = (m, p) => require.resolve(m + '/package.json', {paths: [p]}); require('path').dirname(r('expo-modules-jsi', r('expo-modules-core', r('expo', '$NATIVE'))))")/apple
RN_ROOT=$(node -p "require('path').dirname(require.resolve('react-native/package.json', {paths: ['$NATIVE']}))")
NAME=ExpoModulesJSI
SCRATCH=$CACHE/jsi-build
export PODS_ROOT RN_ROOT

PODS_ROOT="$PODS_ROOT" RN_ROOT="$RN_ROOT" bash "$J/scripts/generate-modulemap.sh"

# Swift 6.4 defaults to the swiftbuild system, which has no 'iphoneos' platform
# for an xtool SDK; the native build system cross-compiles with it. The slim SDK
# drops Xcode's usr/include, so <swift/bridging> comes from the host toolchain.
# The open-source 6.4 compiler rejects this package's C++ types in public API
# under library evolution; AssumeResilientCxxTypes lifts that check.
SWIFT_INCLUDE=$(dirname "$(command -v swiftc)")/../include
swift build --package-path "$J" --scratch-path "$SCRATCH" -c release --build-system native \
  --swift-sdk arm64-apple-ios --product "$NAME" -Xcc -I"$SWIFT_INCLUDE" \
  -Xswiftc -enable-experimental-feature -Xswiftc AssumeResilientCxxTypes \
  -Xlinker -install_name -Xlinker "@rpath/$NAME.framework/$NAME" 2>&1 | grep -vE "no version information|^warning:" | tail -5
BIN=$(swift build --package-path "$J" --scratch-path "$SCRATCH" -c release --build-system native --swift-sdk arm64-apple-ios --show-bin-path 2>/dev/null)

slice=$J/Products/$NAME.xcframework/ios-arm64
fw=$slice/$NAME.framework
rm -rf "$J/Products/$NAME.xcframework"
mkdir -p "$fw/Modules/$NAME.swiftmodule" "$fw/Headers"
cp "$BIN/lib$NAME.dylib" "$fw/$NAME"

interface=$(find "$SCRATCH" -name "$NAME.swiftinterface" -path '*arm64-apple-ios*' | head -n1)
[ -n "$interface" ] || { echo "no $NAME.swiftinterface under $SCRATCH" >&2; exit 1; }
# Same cleanup build-xcframework.sh applies to the shipped interface.
sed '/^extension __ObjC\./,/^}/d;/^@usableFromInline$/{N;/_ConstraintThatIsNotPartOfTheAPIOfThisLibrary/d;};/_ConstraintThatIsNotPartOfTheAPIOfThisLibrary/d' \
  "$interface" > "$fw/Modules/$NAME.swiftmodule/arm64-apple-ios.swiftinterface"
cp "$BIN/Modules/$NAME.swiftmodule" "$fw/Modules/$NAME.swiftmodule/arm64-apple-ios.swiftmodule" 2>/dev/null ||
  cp "$BIN/$NAME.swiftmodule" "$fw/Modules/$NAME.swiftmodule/arm64-apple-ios.swiftmodule"

swift_header=$(find "$SCRATCH" -name "$NAME-Swift.h" -path '*arm64-apple-ios*' | head -n1)
[ -n "$swift_header" ] || { echo "no $NAME-Swift.h under $SCRATCH" >&2; exit 1; }
cp "$swift_header" "$fw/Headers/"
public=$J/Sources/$NAME-Cxx/include/Public
headers=()
for h in "$public"/*.h; do
  [ -e "$h" ] || continue
  cp "$h" "$fw/Headers/"
  headers+=("$(basename "$h")")
done
{
  echo "module $NAME {"
  echo "  header \"$NAME-Swift.h\""
  echo "  export *"
  echo ""
  echo "  explicit module Cxx {"
  echo "    requires cplusplus"
  for h in "${headers[@]}"; do echo "    header \"$h\""; done
  echo "    export *"
  echo "  }"
  echo "}"
} > "$fw/Headers/module.modulemap"

python3 - "$fw/Info.plist" "$J/Products/$NAME.xcframework/Info.plist" "$NAME" <<'PY'
import plistlib, sys
fw_plist, xc_plist, name = sys.argv[1:]
plistlib.dump({
    "CFBundleDevelopmentRegion": "en", "CFBundleExecutable": name,
    "CFBundleIdentifier": f"expo.modules.{name}", "CFBundleInfoDictionaryVersion": "6.0",
    "CFBundleName": name, "CFBundlePackageType": "FMWK", "CFBundleShortVersionString": "1.0",
    "CFBundleSupportedPlatforms": ["iPhoneOS"], "CFBundleVersion": "1", "MinimumOSVersion": "16.4",
}, open(fw_plist, "wb"), fmt=plistlib.FMT_BINARY)
plistlib.dump({
    "AvailableLibraries": [{
        "BinaryPath": f"{name}.framework/{name}", "LibraryIdentifier": "ios-arm64",
        "LibraryPath": f"{name}.framework", "SupportedArchitectures": ["arm64"],
        "SupportedPlatform": "ios",
    }],
    "CFBundlePackageType": "XFWK", "XCFrameworkFormatVersion": "1.0",
}, open(xc_plist, "wb"))
PY
echo "$fw"
