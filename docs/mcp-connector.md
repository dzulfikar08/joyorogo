# MCP connector (Claude / ChatGPT with your JoyoRogo data)

A remote MCP server on the JoyoRogo Worker lets a user ask **Claude** or **ChatGPT** about their own food diary, weight, workouts,
sleep and recovery. Read-only, Pro only, revocable at any time. The connector address is

```
https://api.joyorogo.com/mcp
```

User-facing steps live on the web page `/panduan/ai` ("Pakai Claude/ChatGPT dengan data JoyoRogo"); the privacy copy is in `/privasi` and in
JoyoFit's privacy page.

## Design

| Piece | Where | What |
|---|---|---|
| Authorization server | `packages/auth/src/index.ts` `mcpPlugins` | Better Auth 1.7.3 `@better-auth/mcp` (= `oauth-provider`) + `jwt`. OAuth 2.1: authorization code with **PKCE S256 only**, **dynamic client registration** (RFC 7591, no account needed to register; the user's consent is what grants anything), RFC 8707 resource binding, RFC 9207 `iss`, refresh tokens that rotate (30 s reuse window for retried refreshes). Access tokens are **JWTs** (EdDSA / Ed25519, 1 h, `aud` = the MCP URL), refresh tokens 30 days. |
| Discovery | `apps/server/src/mcp.ts` `registerMcpRoutes` | `/.well-known/oauth-protected-resource[/mcp]` (RFC 9728) and `/.well-known/oauth-authorization-server[/api/auth]` (RFC 8414) go to the Better Auth handler; the issuer is `https://api.joyorogo.com/api/auth`. The origin-root authorization-server document is served too, for clients that look there. |
| Login + consent | web `/koneksi/izin` | One page for both. `loginPage` and `consentPage` of the plugin point at it with the signed OAuth query (`exp`, `sig`, valid 10 min). It signs the user in with the normal web methods, shows who asks (name + redirect host), the scopes, and posts `POST /api/auth/oauth2/consent {accept, oauth_query}`. |
| Resource server | `apps/server/src/mcp.ts` | `POST /mcp`, stateless Streamable HTTP (`@modelcontextprotocol/sdk` 1.x `WebStandardStreamableHTTPServerTransport`, JSON responses, no SSE; GET/DELETE answer 405). A fresh `McpServer` per request. 401 with `WWW-Authenticate: Bearer resource_metadata=…` for a missing/bad/revoked token. |
| Data | `packages/api/src/lib/fit-data.ts` | Pure `(db, userId, …)` readers, shared with the in-app coach. Units in key names, WIB days. |
| Connections, audit | `packages/api/src/lib/mcp-connections.ts`, oRPC `mcpConnection.*` | list / revoke / activity / info; the account wipe removes them. |
| Tables | migration `0042_mcp_connector` | `oauth_client`, `oauth_consent`, `oauth_access_token`, `oauth_refresh_token`, `oauth_resource`, `oauth_client_resource`, `oauth_client_assertion`, `jwks` (Better Auth), `mcp_audit` (ours) and 8 nullable daily-metric columns on `fitness_score`. |

### Scopes (what the user agrees to)

`profile:read`, `food:read`, `weight:read`, `workouts:read`, `recovery:read`, plus `offline_access` (stay connected; hidden in the UI).
A request that names scopes always gets `offline_access` added and a request without `resource` gets the MCP URL, because clients read the
scope list from metadata and may omit either (no refresh token = signed out every hour; no resource = an opaque token the endpoint cannot
read). A request without `scope` gets every scope. Each tool checks its scope; a token missing it gets a friendly tool error.

### Tools (all `readOnlyHint`)

| Tool | Scope | Returns |
|---|---|---|
| `get_profile` | profile | today (WIB), mode `lose` / `maintain` / `gain` / `hamil`, age, height, weights, target date, daily targets (eat/burn/BMR/TDEE kcal, protein g, sleep h), maternal state, fasting, budget |
| `get_food_log` | food | items per day (≤ 31 days, default today): meal, kcal, protein/carbs/fat/fiber g, portion g, source |
| `get_daily_totals` | food | per day (≤ 366 days, default 7): eaten kcal + macros, meals, logged exercise kcal, steps, remaining vs the eat target; today's targets; average of logged days. Unlogged day = `logged:false`, null totals |
| `get_weight_history` | weight | weigh-ins (≤ 730 days, default 90), latest, goal + remaining kg, smoothed trend (kg/week, projected date), waist |
| `list_workouts` | workouts | JoyoFit watch workouts + gym sessions, newest first (≤ 366 days, default 30, ≤ 50 items) with an `id` |
| `get_workout` | workouts | `watch:<start>`: analysis summary (stats, HR zones, pace zones, best efforts, effort, load, splits, laps, comparison; no series, no GPS); `strength:<id>`: exercises with sets, total volume |
| `get_recovery_metrics` | recovery | per day (≤ 92 days, default 14): sleep h + source, sleep %, recovery %, strain, readiness, resting HR, HRV + status, VO2max, training status, load ratio, recovery hours left, steps, distance, active kcal, exercise min |

Never exposed: Strava-imported rows (Strava API terms keep that data out of AI, see `docs/strava.md`), GPS routes, photos, other people's data,
emails, ids of other accounts. Nothing writes.

### What is in the cloud

Food, weight, waist, sleep (`sleep_log`: manual / Health Connect / Apple Health), `daily_activity` (steps, distance, active kcal, exercise
min), `fitness_score` (recovery, strain, sleep %, readiness) and the JoyoFit watch workouts (`watch_workout` + R2 documents) were already in
JoyoRogo. JoyoFit's richer daily metrics were not, so `fitness.upsertScores` now also takes `sleepHours`, `restingHr`, `hrvMs`, `hrvStatus`,
`vo2max`, `trainingStatus`, `loadRatio`, `recoveryHours` (all optional, a missing one keeps the stored value). JoyoFit sends them with the
scores it already pushes (JS only, OTA).

### Pro gate

Connecting works for everybody (so the AI app shows the tools and the user sees why nothing opens); every **tool call** of a Free account
answers `isError` with the upsell URL (`${APP_URL}/harga`) in Indonesian and English and is logged as `not_pro`. `premiumUnlocked` rules apply
(Founder, or any account on a server without a paywall).

### Limits, audit, revocation

- Per user: `MCP_LIMITER` (60 calls / minute; wrangler `ratelimits` namespace 1003), then `MCP_DAILY_CAP` calls per rolling 24 h (default 1000).
  A refused call is a polite tool error; per-minute refusals are not written to the audit log (a flood must not become a write flood).
- Per IP: `OAUTH_REGISTER_LIMITER` (30 registrations / minute, namespace 1004) in front of `/api/auth/oauth2/register`; Better Auth's own
  per-endpoint limits are raised (the AI apps call from a few shared addresses).
- `mcp_audit`: user, client, tool, arguments (dates and ids, cut to 500 characters), outcome (`ok`, `error`, `not_pro`, `scope`,
  `rate_limited`), duration. 90 days; the cron (`*/5`) deletes older rows and **dynamic clients nobody consented to** after 2 days.
- Revoking (`mcpConnection.revoke`, Settings > Koneksi AI on web, native and JoyoFit) deletes the consent and every token of that client for the
  user. A JWT cannot be revoked, so `/mcp` looks the consent up on **every** request: the access token dies at once, the refresh token for good.
- The account wipe (`/api/privacy/delete-my-data`) removes connections and audit rows with the rest.

## Operating it

- Migration first: `cd apps/server && CLOUDFLARE_ACCOUNT_ID=3268f27664d77716b648b00c8850469e bunx wrangler d1 migrations apply DB --remote`, then deploy.
- The signing key is created on first use (`jwks` table, private key encrypted with `BETTER_AUTH_SECRET`). Rotating `BETTER_AUTH_SECRET`
  invalidates it: delete the `jwks` rows and every connector refreshes into the new key; refresh tokens stay valid.
- `jwt({ disableSettingJwtHeader: true })`: without it every `/get-session` would sign a JWT.
- Better Auth 1.7.3 has no `clientRegistrationDefaultApplicationType: "infer"`: a hook on `/oauth2/register` marks localhost / custom-scheme
  registrations `native` (Claude Code, Cursor). A newer plugin does this itself.
- Tests: `bun test` in `packages/auth` (OAuth flow on the memory adapter) and `apps/server` (`mcp.test.ts`: the whole flow and every tool on a
  real SQLite database built from the migrations).
- By hand: `npx @modelcontextprotocol/inspector` (UI: Streamable HTTP, URL above, OAuth) or `--cli … --header "Authorization: Bearer …"`.

## Not covered

- Client ID Metadata Documents (the newer MCP way to identify a client): needs an SSRF-safe fetch transport on Workers. Dynamic registration
  is what Claude and ChatGPT use today.
- DPoP-bound tokens are refused. Opaque tokens are never issued (a `resource` is always added).
- Health data in transit to Claude/ChatGPT is governed by that provider's terms once the user asks a question; see the privacy page.
