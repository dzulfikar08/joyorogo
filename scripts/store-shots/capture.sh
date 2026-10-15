#!/usr/bin/env bash
# Capture app screens over adb via deep links.
#
#   scripts/store-shots/capture.sh <package> <out-dir> <name>=<deep-link> [<name>=<deep-link> ...]
#
#   ADB_SERIAL=EUIJP7JRIJFUFMRC scripts/store-shots/capture.sh com.joyodigitama.joyofit \
#     ../watch-fit/dist/store/captures today=joyofit:// readiness=joyofit://readiness
#
# The screen must be awake and unlocked (adb input is blocked on this phone, so the script cannot
# wake it). Captures can show personal data; keep them in a gitignored dist/ folder.
set -euo pipefail

serial="${ADB_SERIAL:-EUIJP7JRIJFUFMRC}"
adb=(adb -s "$serial")
settle="${SETTLE_SECONDS:-4}"

if (($# < 3)); then
  sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'
  exit 2
fi
package="$1"
out="$2"
shift 2

wake="$("${adb[@]}" shell dumpsys power | tr -d '\r' | sed -n 's/.*mWakefulness=\([A-Za-z]*\).*/\1/p' | head -n 1)"
if [[ "$wake" != "Awake" ]]; then
  echo "phone is $wake: unlock it, then run again" >&2
  exit 1
fi
if "${adb[@]}" shell dumpsys window | tr -d '\r' | grep -q 'isKeyguardShowing=true'; then
  echo "phone shows the lock screen: unlock it, then run again" >&2
  exit 1
fi

mkdir -p "$out"
for item in "$@"; do
  name="${item%%=*}"
  link="${item#*=}"
  "${adb[@]}" shell am start -a android.intent.action.VIEW -d "$link" "$package" >/dev/null
  sleep "$settle"
  "${adb[@]}" exec-out screencap -p >"$out/$name.png"
  echo "$out/$name.png"
done
