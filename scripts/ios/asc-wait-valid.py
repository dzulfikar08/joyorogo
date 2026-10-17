#!/usr/bin/env python3
"""App Store Connect checks around an upload.

    asc-wait-valid.py --check <bundle id> <build number>   before the upload: the number must be higher than every build on the app
    asc-wait-valid.py <bundle id> <build number>           after it: wait until the build is VALID, then show its TestFlight state

Uses the App Store Connect API (ASC_KEY_ID / ASC_ISSUER_ID / ASC_KEY_PATH, through omarchy-apple-dev's
asc.py). The wait exits 0 on VALID and 1 on INVALID/FAILED or after 45 minutes. It then prints the build's
beta state and groups: the app's Internal group takes every build automatically; a build in an external group
or in beta review was put there by somebody else (this script never touches either).
"""

import os
import sys
import time
from pathlib import Path

oad = Path(os.environ.get("OMARCHY_APPLE_DEV", Path.home() / ".local/share/omarchy-apple-dev"))
sys.path.insert(0, str(oad / "tools"))
import asc  # noqa: E402

args = sys.argv[1:]
check = bool(args) and args[0] == "--check"
if check:
    args = args[1:]
if len(args) != 2:
    sys.exit(__doc__)
bundle, build = args

app = asc.call("GET", f"/v1/apps?filter[bundleId]={bundle}")["data"][0]["id"]


def builds():
    return asc.call("GET", f"/v1/builds?filter[app]={app}&sort=-uploadedDate&limit=200")["data"]


if check:
    numbers = [int(b["attributes"]["version"]) for b in builds() if b["attributes"]["version"].isdigit()]
    top = max(numbers, default=0)
    if int(build) <= top:
        sys.exit(f"{bundle}: build number {build} is not higher than the newest build on App Store Connect ({top})")
    print(f"{bundle}: build {build} is higher than the newest on App Store Connect ({top})")
    sys.exit(0)

deadline = time.time() + 45 * 60
found = None
while time.time() < deadline:
    found = next((b for b in builds() if b["attributes"]["version"] == build), None)
    if found is None:
        print(f"{bundle} {build}: not listed yet", flush=True)
    else:
        state = found["attributes"]["processingState"]
        print(f"{bundle} {build}: {state}", flush=True)
        if state == "VALID":
            break
        if state in ("INVALID", "FAILED"):
            sys.exit(f"{bundle} {build} is {state}; App Store Connect mails the reason")
    time.sleep(20)
else:
    sys.exit(f"{bundle} {build}: still not VALID after 45 minutes")

detail = asc.call("GET", f"/v1/builds/{found['id']}/buildBetaDetail")["data"]["attributes"]
# A build's betaGroups relationship cannot be read (GET_RELATED is not allowed): ask each group of the app for the build.
names = []
for g in asc.call("GET", f"/v1/apps/{app}/betaGroups")["data"]:
    if asc.call("GET", f"/v1/builds?filter[betaGroups]={g['id']}&filter[app]={app}&filter[version]={build}")["data"]:
        names.append(f"{g['attributes']['name']} ({'internal' if g['attributes']['isInternalGroup'] else 'external'})")
print(f"TestFlight: internal {detail.get('internalBuildState')}, external {detail.get('externalBuildState')}, "
      f"groups: {', '.join(names) or 'none'}")
