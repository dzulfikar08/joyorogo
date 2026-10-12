#!/usr/bin/env bash
# Wrangler-based deploy path (alchemy 429-blocked on 2026-09-14).
# Deploys server worker (migrations + vars) and web assets worker to the
# SAME resources alchemy created. Secrets persist per worker; pass
# --secrets to re-sync them from apps/server/.env.
set -euo pipefail
cd "$(dirname "$0")/.."

SERVER_ENV="apps/server/.env"
WEB_DIR="apps/web"
DB_NAME="joyorogo-database-live-dzul-unqpixpckdt72ct3"
export CLOUDFLARE_ACCOUNT_ID="b7e6f8457bd39fa37a7eea5249799754"

env_value() { grep -oP "^$1=\K.*" "$SERVER_ENV" | head -1; }

echo "== 1/4 D1 migrations =="
bunx wrangler d1 migrations apply "$DB_NAME" --remote --config apps/server/wrangler.jsonc

echo "== 2/4 server vars from .env =="
# Keep wrangler.jsonc vars in sync with .env (single source of truth).
python3 - "$SERVER_ENV" apps/server/wrangler.jsonc <<'PY'
import json, re, sys
env, cfg = sys.argv[1], sys.argv[2]
vals = {}
for line in open(env):
    m = re.match(r"^([A-Z0-9_]+)=(.*)$", line.strip())
    if m:
        vals[m.group(1)] = m.group(2)
doc = json.loads(re.sub(r",\s*([}\]])", r"\1", re.sub(r"^\s*//.*$", "", open(cfg).read(), flags=re.MULTILINE)))
v = doc["vars"]
v["CORS_ORIGIN"] = vals["CORS_ORIGIN"]
v["GOOGLE_CLIENT_ID"] = vals.get("GOOGLE_CLIENT_ID", "")
v["DEV_LOGIN"] = vals.get("DEV_LOGIN", "")
json.dump(doc, open(cfg, "w"), indent=2)
print("vars synced:", ", ".join(v.keys()))
PY

if [[ "${1:-}" == "--secrets" ]]; then
  echo "== 2b/4 secrets =="
  # DOKU_SECRET_KEY is deliberately not synced: the local .env holds the
  # sandbox key. Set the production key once with:
  #   bunx wrangler secret put DOKU_SECRET_KEY --config apps/server/wrangler.jsonc
  for NAME in BETTER_AUTH_SECRET GOOGLE_CLIENT_SECRET STRAVA_CLIENT_SECRET; do
    printf "%s" "$(env_value "$NAME")" | bunx wrangler secret put "$NAME" --config apps/server/wrangler.jsonc
  done
fi

echo "== 3/4 deploy server =="
(cd apps/server && bunx wrangler deploy)

echo "== 4/4 build + deploy web =="
(
  cd "$WEB_DIR"
  VITE_SERVER_URL="https://api.joyorogo.com" VITE_REVKLIK_SITE_ID="88069ee9-6eac-4dc9-a23b-f5757a4b948e" \
    bunx vite build
  bunx wrangler deploy
  # Old/www hosts 301 to joyorogo.com; deployed after the web worker so the
  # canonical host is already serving when the redirect goes live.
  bunx wrangler deploy --config redirect/wrangler.jsonc
)

echo "DONE: https://joyorogo.com"
