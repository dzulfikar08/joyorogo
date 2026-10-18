#!/usr/bin/env bash
# Publish an over-the-air JS update (EAS Update, expo-updates) for JoyoRogo. Policy and rollback: docs/ota.md.
#
#   scripts/ota.sh "Fix keyboard overlap in the food sheet"        production, android + ios
#   scripts/ota.sh --platform android "Copy fix"                   one platform only
#   scripts/ota.sh --channel preview "Try the new notice"          preview channel, android QA build only
#
# Steps: typecheck + unit tests + i18n check, then per platform a release-env `expo export` (same env as the store
# builds, bundle sanity checks), then `eas update` with the bundle. Prints the
# update group id of each platform. Nothing is uploaded to a store.
#
# JS and asset changes only. A change that touches native code, native config, permissions, app.json, plugins or a
# native dependency changes the fingerprint runtimeVersion: the update would then target a runtimeVersion that no
# installed binary has, so nobody receives it. Ship a new binary for those (docs/ota.md "When OTA is not enough").
#
# Needs: bun, jq and an EAS login (`bunx eas-cli login`) or EXPO_TOKEN. EAS Update code signing needs a paid EAS plan the account
# does not have, so updates are unsigned.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$PWD
NATIVE=apps/native
EAS=(bunx "eas-cli@${EAS_CLI_VERSION:-25.1.1}")

usage() { sed -n '2,8p' "$0" >&2; exit 2; }

channel=production platform=all message=
while [ $# -gt 0 ]; do
  case $1 in
    --channel) channel=${2:?--channel needs production or preview}; shift ;;
    --platform) platform=${2:?--platform needs android, ios or all}; shift ;;
    -h|--help) usage ;;
    --) shift; message=${message:+$message }$*; break ;;
    -*) echo "unknown option: $1" >&2; usage ;;
    *) message=${message:+$message }$1 ;;
  esac
  shift
done
[ -n "$message" ] || { echo "an update message is required" >&2; usage; }
case $channel in production|preview) ;; *) echo "channel must be production or preview" >&2; exit 2 ;; esac
case $platform in android|ios|all) ;; *) echo "platform must be android, ios or all" >&2; exit 2 ;; esac
# The preview channel is what the QA Android build (JOYOROGO_QA=1) listens to; there is no QA iOS binary.
if [ "$channel" = preview ]; then
  [ "$platform" != ios ] || { echo "the preview channel only has an Android QA build" >&2; exit 2; }
  platform=android
fi
command -v jq > /dev/null || { echo "jq is required" >&2; exit 1; }

step() { printf '\n== %s ==\n' "$*"; }
fail() { echo "ota: $*" >&2; exit 1; }

step "1. checks"
(cd "$NATIVE" && bun run check-types)
(cd "$NATIVE" && bun test ./src/)
bun run i18n:check > /dev/null

# The release JS env of scripts/build-release-apk.sh and scripts/ios/mac-build.sh. An OTA bundle is the app's
# JS: it must carry exactly what a store build bakes in (live API, dev login off).
export NODE_ENV=production
export EXPO_PUBLIC_SERVER_URL="https://api.joyorogo.com"
export EXPO_PUBLIC_DEV_LOGIN=0
export EXPO_PUBLIC_FB_APP_ID=1016598258111944

publish() {
  local p=$1 out=$ROOT/$NATIVE/dist/ota-$1 json
  json=$(mktemp)
  # Android store builds are the Play flavour (JOYOROGO_DISTRIBUTION=play: no APK self-updater, no external
  # checkout); iOS store builds leave it unset. The manifest carries extra.distribution, so each platform
  # is published with the value its binary was built with. The fingerprint depends on it too.
  if [ "$p" = android ]; then export JOYOROGO_DISTRIBUTION=play; else unset JOYOROGO_DISTRIBUTION; fi
  if [ "$channel" = preview ]; then export JOYOROGO_QA=1; else unset JOYOROGO_QA; fi

  step "2. $p: export (release env, distribution=${JOYOROGO_DISTRIBUTION:-default}, qa=${JOYOROGO_QA:-0})"
  rm -rf "$out"
  (cd "$NATIVE" && bunx expo export --platform "$p" --output-dir "$out" > /dev/null)
  local bundle strings
  bundle=$(find "$out/_expo/static/js/$p" -name '*.hbc' -o -name '*.js' | head -n 1)
  [ -f "$bundle" ] || fail "$p: no JS bundle in $out"
  strings=$(LC_ALL=C grep -aoE 'EXPO_PUBLIC_[A-Z_]+|https://api\.joyorogo\.com|AppleHealth|HealthConnect' "$bundle" | sort -u)
  # A leftover EXPO_PUBLIC_* name is a runtime proxy read that throws "varlock ENV not initialized" on launch.
  if grep -qE 'EXPO_PUBLIC_(SERVER_URL|DEV_LOGIN)' <<< "$strings"; then
    fail "$p: bundle reads ENV at runtime (not inlined)"
  fi
  grep -qF "$EXPO_PUBLIC_SERVER_URL" <<< "$strings" || fail "$p: bundle does not contain the API URL"
  echo "   bundle $(basename "$bundle") $(stat -c %s "$bundle") bytes, API URL inlined"

  local runtime
  runtime=$(cd "$NATIVE" && bunx expo-updates runtimeversion:resolve --platform "$p" | tail -n 1 | jq -r .runtimeVersion)
  [ -n "$runtime" ] && [ "$runtime" != null ] || fail "$p: runtimeVersion did not resolve"

  step "3. $p: eas update --channel $channel (runtimeVersion $runtime)"
  (cd "$NATIVE" && "${EAS[@]}" update --channel "$channel" --platform "$p" --message "$message" \
    --skip-bundler --input-dir "$out" --environment "$channel" \
    --non-interactive --json) > "$json"
  local group
  group=$(jq -r '[.[]? | .group] | map(select(. != null)) | .[0] // empty' "$json")
  [ -n "$group" ] || { cat "$json" >&2; fail "$p: eas update printed no update group id"; }
  rm -f "$json"
  RESULTS+=("$p  channel=$channel  runtimeVersion=$runtime  group=$group")
}

RESULTS=()
if [ "$platform" = all ]; then
  publish android
  publish ios
else
  publish "$platform"
fi

step "published"
printf '%s\n' "${RESULTS[@]}"
echo "view:     bunx eas-cli update:view <group>   (dashboard: https://expo.dev/accounts/dzulfikar08/projects/joyorogo/updates)"
echo "rollback: bunx eas-cli update:rollback --channel $channel   (docs/ota.md)"
