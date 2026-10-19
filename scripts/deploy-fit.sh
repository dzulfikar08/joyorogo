#!/usr/bin/env bash
# Builds and deploys the JoyoFit web app (apps/fit, docs/fit-web.md) as its own static-assets Worker.
# Independent of scripts/deploy.sh: the API is not touched. The CORS origin of the app must already be on the
# server (apps/server/wrangler.jsonc CORS_ORIGIN and, because scripts/deploy.sh rewrites it from apps/server/.env,
# the CORS_ORIGIN line of that .env too).
set -euo pipefail
cd "$(dirname "$0")/.."

export CLOUDFLARE_ACCOUNT_ID="3268f27664d77716b648b00c8850469e"

cd apps/fit
VITE_SERVER_URL="https://api.joyorogo.com" bunx vite build
bunx wrangler deploy

echo "DONE: https://app.fit.joyorogo.com"
