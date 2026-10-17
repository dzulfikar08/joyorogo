#!/usr/bin/env python3
"""Enable App Store Connect capabilities (HEALTHKIT, ...) on a bundle id.

    enable-capabilities.py <bundle id> <CAPABILITY_TYPE> [...]

Registers the bundle id when it is missing, then POSTs a bundleIdCapability for
each type the bundle id does not have yet. Provisioning profiles made before a
capability was enabled do not carry it: provision-dev.py recreates the
development profile on every run and sign-app.py drops an invalidated App Store
one, so run this before either. Uses ASC_KEY_ID / ASC_ISSUER_ID / ASC_KEY_PATH
through omarchy-apple-dev's asc.py.
"""

import os
import sys
from pathlib import Path

oad = Path(os.environ.get("OMARCHY_APPLE_DEV", Path.home() / ".local/share/omarchy-apple-dev"))
sys.path.insert(0, str(oad / "tools"))
import asc  # noqa: E402

identifier, *wanted = sys.argv[1:]
if not wanted:
    sys.exit(__doc__)

bundle = asc.bundle_id(identifier)
have = {c["attributes"]["capabilityType"]
        for c in asc.call("GET", f"/v1/bundleIds/{bundle}/bundleIdCapabilities")["data"]}
# Sign in with Apple has no default configuration; the API wants one explicitly.
SETTINGS = {
    "APPLE_ID_AUTH": [{"key": "APPLE_ID_AUTH_APP_CONSENT", "options": [{"key": "PRIMARY_APP_CONSENT"}]}],
}
for capability in wanted:
    if capability in have:
        print(f"{identifier}: {capability} already enabled")
        continue
    asc.call("POST", "/v1/bundleIdCapabilities", {"data": {
        "type": "bundleIdCapabilities",
        "attributes": {"capabilityType": capability,
                       **({"settings": SETTINGS[capability]} if capability in SETTINGS else {})},
        "relationships": {"bundleId": asc.rel("bundleIds", bundle)},
    }})
    print(f"{identifier}: enabled {capability}")
