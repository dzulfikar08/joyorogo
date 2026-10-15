#!/usr/bin/env python3
"""Assemble Payload/<App>.app from the ninja build, the way Xcode lays it out.

    assemble-app.py <build dir> <apps/native dir> <iPhoneOS.sdk> <omarchy-apple-dev dir>

Steps Xcode runs for the app target, replaced here:
  - Info.plist preprocessing ($(VAR) expansion) plus the keys Xcode injects
    (MinimumOSVersion, UIDeviceFamily, CFBundleSupportedPlatforms, PkgInfo).
  - Asset catalog -> Assets.car with the Linux actool (app icon + splash
    color/image).
  - Launch screen: the Linux ibtool cannot compile Expo's SplashScreen
    storyboard, so the app uses the UILaunchScreen Info.plist dictionary with
    the same named color and image. expo-splash-screen skips its overlay when
    no storyboard is present.
  - JS bundle: `expo export:embed` + Linux hermesc, assets next to it.
  - [CP] Copy Pods Resources / Embed Pods Frameworks (Release lists).
  - Swift back-deployment dylibs the executable links against.
"""

import json
import os
import plistlib
import re
import shutil
import subprocess
import sys
from pathlib import Path

OUT, NATIVE, SDK, OAD = (Path(a) for a in sys.argv[1:5])
summary = json.loads((OUT / "app.json").read_text())


def app_env() -> dict:
    script = f"set -a; source {summary['settings_env']!r}; env -0"
    raw = subprocess.run(["bash", "-c", script], check=True, capture_output=True).stdout
    return dict(item.split("=", 1) for item in raw.decode().split("\0") if "=" in item)


env = app_env()
name = summary["product_name"]
app = OUT / "Payload" / f"{name}.app"
shutil.rmtree(OUT / "Payload", ignore_errors=True)
app.mkdir(parents=True)

# Executable
shutil.copy2(summary["executable"], app / name)

# Info.plist
VAR = re.compile(r"\$[({]([A-Za-z0-9_]+)(?::([A-Za-z0-9_]+))?[)}]")


def expand(node):
    if isinstance(node, str):
        def sub(m):
            value = env.get(m.group(1), "")
            if m.group(2) == "rfc1034identifier":
                value = re.sub(r"[^A-Za-z0-9.-]", "-", value)
            return value
        return VAR.sub(sub, node)
    if isinstance(node, list):
        return [expand(v) for v in node]
    if isinstance(node, dict):
        return {k: expand(v) for k, v in node.items()}
    return node


with open(summary["info_plist"], "rb") as f:
    info = expand(plistlib.load(f))
info["MinimumOSVersion"] = summary["deployment_target"]
info["UIDeviceFamily"] = [int(x) for x in env.get("TARGETED_DEVICE_FAMILY", "1").split(",")]
info["CFBundleSupportedPlatforms"] = ["iPhoneOS"]
# $(PRODUCT_BUNDLE_PACKAGE_TYPE) is an Xcode product-type default no xcconfig sets.
info["CFBundlePackageType"] = info.get("CFBundlePackageType") or "APPL"
info["UIRequiredDeviceCapabilities"] = ["arm64"]
# Release strips the dev launcher's Bonjour service and its usage text.
services = [s for s in info.get("NSBonjourServices", []) if "_expo._tcp" not in s]
if services:
    info["NSBonjourServices"] = services
else:
    info.pop("NSBonjourServices", None)
if "Expo Dev Launcher" in info.get("NSLocalNetworkUsageDescription", ""):
    info.pop("NSLocalNetworkUsageDescription")
info.pop("UILaunchStoryboardName", None)
info["UILaunchScreen"] = {"UIColorName": "SplashScreenBackground", "UIImageName": "SplashScreenLogo"}
(app / "PkgInfo").write_bytes(b"APPL????")

# Asset catalog
actool = OAD / "tools/darwin-tools/.build/release/actool"
partial = OUT / "assets-partial.plist"
catalogs = [r for r in summary["resources"] if r.endswith(".xcassets")]
subprocess.run([str(actool), *catalogs, "--compile", str(app), "--platform", "iphoneos",
                "--app-icon", env.get("ASSETCATALOG_COMPILER_APPICON_NAME", "AppIcon"),
                "--minimum-deployment-target", summary["deployment_target"],
                "--output-partial-info-plist", str(partial), "--output-format", "human-readable-text"],
               check=True, stdout=subprocess.DEVNULL)
with open(partial, "rb") as f:
    info.update(plistlib.load(f))

with open(app / "Info.plist", "wb") as f:
    plistlib.dump(info, f, fmt=plistlib.FMT_BINARY)

# Plain resources
for res in summary["resources"]:
    if res.endswith((".xcassets", ".storyboard")):
        continue
    shutil.copy2(res, app / Path(res).name)

# Pod resource bundles
for bundle in summary["bundles"]:
    shutil.copytree(bundle, app / Path(bundle).name, dirs_exist_ok=True)

# Pod frameworks: the Release install_framework list, without headers or
# module maps (CocoaPods' rsync excludes), plus ExpoModulesJSI, which
# ExpoModulesCore links, when the pods' list leaves it to its own build phase.
frameworks_dir = app / "Frameworks"
frameworks_dir.mkdir()
script = Path(summary["frameworks_script"]).read_text()
release = script.split('if [[ "$CONFIGURATION" == "Release" ]]; then', 1)[1].split("fi", 1)[0]
paths = re.findall(r'install_framework "([^"]+)"', release)
if not any(p.endswith("/ExpoModulesJSI.framework") for p in paths):
    paths.append("${PODS_XCFRAMEWORKS_BUILD_DIR}/ExpoModulesJSI/ExpoModulesJSI.framework")
for raw in paths:
    src = Path(expand(raw))
    dst = frameworks_dir / src.name
    shutil.copytree(src, dst, symlinks=True,
                    ignore=shutil.ignore_patterns("Headers", "PrivateHeaders", "Modules", "*.swiftmodule",
                                                  "_CodeSignature", "*.dSYM", "._*"))

# Expo's precompiled xcframework tarballs carry macOS AppleDouble files (._ExpoCamera, ...);
# App Store processing rejects a signature over them (error 90034), so none may ship.
for junk in app.rglob("._*"):
    junk.unlink()

# Swift back-deployment libraries the executable (or a framework) loads by rpath.
swift_libs = Path(SDK).parents[4] / "usr/lib/swift/iphoneos"
needed = set()
for binary in [app / name, *frameworks_dir.glob("*.framework/*")]:
    if not binary.is_file():
        continue
    dylibs = subprocess.run(["llvm-objdump", "--macho", "--dylibs-used", str(binary)],
                            capture_output=True, text=True).stdout
    needed.update(re.findall(r"@rpath/(libswift[^ ]+\.dylib)", dylibs))
for lib in sorted(needed):
    candidates = list(swift_libs.glob(lib)) + list(Path(SDK).parents[4].rglob(f"iphoneos/{lib}"))
    if not candidates:
        sys.exit(f"missing Swift back-deployment library {lib}")
    shutil.copy2(candidates[0], frameworks_dir / lib)

# JS bundle + Hermes bytecode
entry = subprocess.run(["node", "-e", "require('expo/scripts/resolveAppEntry')", str(NATIVE), "ios", "absolute"],
                       cwd=NATIVE, check=True, capture_output=True, text=True).stdout.strip().splitlines()[-1]
plain = OUT / "main.jsbundle"
subprocess.run(["bunx", "expo", "export:embed", "--platform", "ios", "--dev", "false", "--reset-cache",
                "--entry-file", entry, "--bundle-output", str(plain), "--assets-dest", str(app)],
               cwd=NATIVE, check=True)
hermesc = subprocess.run(["node", "-p", "require('path').dirname(require.resolve('hermes-compiler/package.json',"
                          " {paths: [require.resolve('react-native/package.json')]}))"],
                         cwd=NATIVE, check=True, capture_output=True, text=True).stdout.strip()
subprocess.run([f"{hermesc}/hermesc/linux64-bin/hermesc", "-emit-binary", "-max-diagnostic-width=80", "-O",
                "-out", str(app / "main.jsbundle"), str(plain)], check=True)
print(app)
