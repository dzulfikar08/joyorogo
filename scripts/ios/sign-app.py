#!/usr/bin/env python3
"""Sign Payload/<App>.app for App Store / TestFlight with rcodesign.

    sign-app.py <App.app> <identity dir>

The Apple Distribution certificate and the App Store profile come from App
Store Connect through omarchy-apple-dev's asc.py (key generated locally, the
certificate reused on later runs). Entitlements are the app's own
.entitlements file (HealthKit) on top of the identity keys the profile grants;
every requested key must be granted by the profile, or Apple rejects the build.
"""

import os
import plistlib
import subprocess
import sys
from pathlib import Path

app = Path(sys.argv[1])
identity = Path(sys.argv[2])
oad = Path(os.environ.get("OMARCHY_APPLE_DEV", Path.home() / ".local/share/omarchy-apple-dev"))
sys.path.insert(0, str(oad / "tools"))
import asc  # noqa: E402

with open(app / "Info.plist", "rb") as f:
    bundle_id = plistlib.load(f)["CFBundleIdentifier"]
entitlements_src = Path(os.environ["APP_ENTITLEMENTS"])

cert_id, key_path, cert_path = asc.certificate()
profile = asc.profile(bundle_id, cert_id)
(app / "embedded.mobileprovision").write_bytes(profile)
granted = asc.profile_payload(profile)["Entitlements"]
team = granted["com.apple.developer.team-identifier"]

with open(entitlements_src, "rb") as f:
    requested = plistlib.load(f)
entitlements = {k: granted[k] for k in (
    "application-identifier", "com.apple.developer.team-identifier", "beta-reports-active",
    "keychain-access-groups") if k in granted}
entitlements["get-task-allow"] = False
for key, value in requested.items():
    if key not in granted:
        sys.exit(f"profile for {bundle_id} does not grant {key}; enable the capability on the bundle id")
    # Prebuild writes aps-environment "development"; the App Store profile grants "production".
    entitlements[key] = granted[key] if key == "aps-environment" else value

identity.mkdir(parents=True, exist_ok=True)
ent_path = identity / "entitlements.plist"
ent_path.write_bytes(plistlib.dumps(entitlements))

# --team-name everywhere, as omarchy-apple-dev's ship.sh (its App Store uploads are VALID).
# Resource-only .bundle directories are sealed as resources, as Xcode does; signing
# them makes nested "code" with no executable.
sign = ["rcodesign", "sign", "--pem-file", str(key_path), "--certificate-der-file", str(cert_path),
        "--team-name", team, "--exclude", "**/*.bundle"]
for nested in sorted((app / "Frameworks").glob("*")):
    subprocess.run([*sign, str(nested)], check=True, stdout=subprocess.DEVNULL)
subprocess.run([*sign, "--entitlements-xml-file", str(ent_path), str(app)],
               check=True, stdout=subprocess.DEVNULL)
print(f"signed {bundle_id} for team {team} with {sorted(entitlements)}")
