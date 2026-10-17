#!/usr/bin/env python3
"""Get the App Store provisioning profile for the Apple Distribution identity that sits in the Mac's keychain.

    asc-mac-profile.py <bundle id> <certificate serial, hex> <out .mobileprovision>

xcodebuild -exportArchive with automatic signing wants a cloud-managed distribution certificate, which this API
key may not create ("Cloud signing permission error"), so the export signs manually: this script finds the
certificate on App Store Connect by serial number, reuses the ACTIVE IOS_APP_STORE profile "joyo-mac <bundle id>
<cert id>" or makes it (dropping an INVALID one first: enabling a capability invalidates profiles), and writes the
profile. Prints "<uuid>", a tab, "<profile name>". Uses ASC_KEY_ID / ASC_ISSUER_ID / ASC_KEY_PATH through omarchy-apple-dev's asc.py.
"""

import base64
import os
import sys
import urllib.parse
from pathlib import Path

oad = Path(os.environ.get("OMARCHY_APPLE_DEV", Path.home() / ".local/share/omarchy-apple-dev"))
sys.path.insert(0, str(oad / "tools"))
import asc  # noqa: E402

if len(sys.argv) != 4:
    sys.exit(__doc__)
bundle, serial, out = sys.argv[1], sys.argv[2].upper().lstrip("0"), Path(sys.argv[3])

certs = asc.call("GET", "/v1/certificates?filter[certificateType]=DISTRIBUTION&limit=200")["data"]
found = [c for c in certs if c["attributes"].get("serialNumber", "").upper().lstrip("0") == serial]
if not found:
    sys.exit(f"no Apple Distribution certificate with serial {serial} on App Store Connect (revoked?)")
cert_id = found[0]["id"]

name = f"joyo-mac {bundle} {cert_id}"
listed = asc.call("GET", f"/v1/profiles?filter[name]={urllib.parse.quote(name)}&filter[profileType]=IOS_APP_STORE")["data"]
active = [p for p in listed if p["attributes"]["profileState"] == "ACTIVE"]
for stale in listed:
    if stale["attributes"]["profileState"] != "ACTIVE":
        asc.call("DELETE", f"/v1/profiles/{stale['id']}")
if active:
    profile = active[0]
else:
    profile = asc.call("POST", "/v1/profiles", {"data": {
        "type": "profiles",
        "attributes": {"name": name, "profileType": "IOS_APP_STORE"},
        "relationships": {
            "bundleId": asc.rel("bundleIds", asc.bundle_id(bundle)),
            "certificates": {"data": [{"type": "certificates", "id": cert_id}]},
        },
    }})["data"]
    print(f"created App Store profile '{name}'", file=sys.stderr)
out.write_bytes(base64.b64decode(profile["attributes"]["profileContent"]))
print(profile["attributes"]["uuid"], name, sep="\t")
