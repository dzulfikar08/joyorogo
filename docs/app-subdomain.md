# app.joyorogo.com: the app on its own host

`joyorogo.com` is the landing and marketing site. The signed-in app (PWA) lives at `app.joyorogo.com`. One Worker and one
bundle (`apps/web`) serve both hosts; the host decides which half of the routes it answers, and the other half redirects.
JoyoFit Web (`apps/fit`, `app.fit.joyorogo.com`) is a separate Worker and is untouched.

## Who answers what

Rules live in one place, `apps/web/src/lib/hosts.ts` (`areaOf`), used by the Worker (`worker/index.ts`, page loads) and
by the router (`routes/__root.tsx` `beforeLoad`, in-app navigation).

| Path | `joyorogo.com` | `app.joyorogo.com` |
|---|---|---|
| `/` | landing | 302 to `/beranda` (the app sends signed-out users on to `/login`) |
| `/harga`, `/panduan/*`, `/blog/*`, `/privasi`, `/syarat`, `/pengembalian-dana`, `/sitemap.xml`, `/llms.txt` | served | 302 to the same path on `joyorogo.com` |
| `/login`, `/onboarding`, `/beranda`, `/berat`, `/feed`, `/founder`, `/grup/*`, `/inbox`, `/jam/*`, `/koneksi/*` (incl. MCP consent `/koneksi/izin`), `/lainnya`, `/latihan/*`, `/makan/*`, `/olahraga`, `/pro`, `/profil/*`, `/rekap`, `/rencana-makan`, `/tidur`, `/pembayaran` | 302 to the same path on `app.joyorogo.com` | served |
| `/gabung/*`, `/u/*`, `/p/*` (invite, public profile, public post) | served, link-preview tags | served (same tags, canonical stays `joyorogo.com`) |
| `/assets/*`, `/icons/*`, `/manifest.webmanifest`, `/sw.js`, `/og.png`, anything unknown | served | served |

The landing no longer bounces signed-in visitors into the app (it did when the app shared the host): it stays reachable
for everyone, and "Masuk" on it goes to `app.joyorogo.com/login`, which forwards a signed-in browser to Beranda.

Query string and hash survive every redirect untouched (signed MCP/OAuth queries must not be re-encoded). Only GET and
HEAD are redirected. Redirects are **302** on purpose: a 301 is cached by browsers for good and would make the rollback
below unreliable. After a quiet week, change `REDIRECT_STATUS` in `hosts.ts` to 301.

Shared pages stay on `joyorogo.com` because links to them are already in chats and in the apps (`share-links.ts` in web
and native build `https://joyorogo.com/gabung/<code>`). Their "Masuk" button goes to the app host with
`?redirect=/gabung/<code>` and the invite works there too.

Only `https://joyorogo.com` and `https://app.joyorogo.com` split; any other host (workers.dev preview, localhost, a
self-hosted deploy) serves everything, because the split needs `VITE_APP_URL` in the build and `APP_URL` in the Worker
vars. `app.joyorogo.com` also answers `robots.txt` with `Disallow: /` and sends `X-Robots-Tag: noindex` on HTML.

New route? `hosts.test.ts` fails until its first path segment is added to `APP_SEGMENTS`, `SITE_SEGMENTS` or
`SHARED_SEGMENTS`. `run_worker_first` in `apps/web/wrangler.jsonc` sends every request through the Worker except the
static directories (`/fonts`, `/icons`, `/brand`, `/mascot`, `/food`, `/tips-img`); add a new static directory there.

## Everything that mentioned joyorogo.com app paths

| Where | Now |
|---|---|
| `apps/web/wrangler.jsonc` | adds custom domain `app.joyorogo.com`, var `APP_URL`, `run_worker_first` for all paths |
| `scripts/deploy.sh` | builds web with `VITE_APP_URL=https://app.joyorogo.com`; refuses to deploy the server if `apps/server/.env` `CORS_ORIGIN` lacks the app host |
| `apps/server/wrangler.jsonc` | `CORS_ORIGIN` + `https://app.joyorogo.com`; `APP_URL=https://app.joyorogo.com`; new `SITE_URL=https://joyorogo.com` |
| better-auth (`packages/auth`) | `trustedOrigins` is built from `CORS_ORIGIN`, so Google sign-in `callbackURL`/`errorCallbackURL` (built from `window.location.origin` in `routes/login.tsx`) are accepted on the app host. The Google redirect URI is `api.joyorogo.com/api/auth/callback/google`: unchanged |
| Payment return URLs (`apps/server/src/billing.ts`): QRIS/VA `…/pembayaran?order=`, Polar `…/pro?polar=success`, `…/pro`, portal `…/profil` | built from `APP_URL`, so now the app host |
| MCP consent page (`mcpPlugins`, `loginPage`/`consentPage`) | `APP_URL/koneksi/izin`, so now the app host; the connector copy in `fitWebConnect.json` names it |
| MCP upgrade text and `websiteUrl`, `/privasi` redirect on the API host | `SITE_URL` (falls back to `APP_URL`) |
| Emails (`apps/server/src/email.ts` `HOME_URL`, `RENEW_URL`) | `https://app.joyorogo.com/beranda`, `…/pro?from=profile&next=/profil` |
| `/u/:code` HTML page on the API host (button "Coba JoyoRogo") | `APP_URL/login` |
| Landing/blog buttons "Masuk", "Mulai gratis", "Daftar dengan Google", "Pilih Pro" (goes to `/pro`), the scan demo's sign-up links, footer "Masuk", iOS install sheet | `AppLink` (`components/app-link.tsx`): absolute `app.joyorogo.com` link on the site host, router link elsewhere. Static blog pages: `VITE_APP_URL` in `blog/render.ts` |
| iOS install sheet | copy-link and text name `app.joyorogo.com` |
| `/login` SEO | `noindex`, so it leaves the sitemap |
| Strava web callback `…/profil/strava/callback` | built from `window.location.origin`; Strava's "Authorization Callback Domain" is `joyorogo.com`, which Strava accepts for subdomains (`docs/strava.md`). Native `joyorogo://joyorogo.com/strava` is a custom scheme: unchanged |
| Native apps (`apps/native`) | no universal links or Android app links exist (`app.json` has no associated domains / intent filters, web serves no `.well-known`). Share links keep `joyorogo.com` (shared pages). Nothing to change |
| `apps/fit` | links go to `joyorogo.com/harga` and `/panduan/ai`, both marketing: unchanged |
| `apps/web/redirect` (`www.joyorogo.com`) | still 301 to `joyorogo.com`; `www.joyorogo.com/beranda` takes two hops (`joyorogo.com`, then the app) |
| `packages/infra/alchemy.run.ts` | legacy deploy path (blocked, see `scripts/deploy.sh`); not updated |

## Sessions, push, PWA

**Sessions: no forced re-login.** The better-auth cookie is host-only on `api.joyorogo.com` (`SameSite=None; Secure`),
not on the web origin. `app.joyorogo.com` and `api.joyorogo.com` are the same site, so the browser sends it from the new
host exactly as it did from `joyorogo.com`. What does start empty is per-origin storage: theme and language, the
persisted query cache, dismissed banners. The first visit on the app host refetches the session and the account's prefs
(`restoreAccountPrefs`), so a person sees one slower load, not a login. Browsers that already refuse the API cookie are
unaffected by the move: for them nothing changes.

**Web push is per origin.** Both the notification permission and the push subscription belong to `joyorogo.com`, so
nobody has a subscription on `app.joyorogo.com` yet. `components/push-move-banner.tsx` (shown in the app shell) asks once:
on the app host, in a browser with push support that is not subscribed here, for an account that has a browser registered
(`push.prefs.devices.web > 0`). Pressing "Aktifkan di sini" runs `enableWebPush`; closing it is remembered. Until then,
old subscriptions keep delivering through the service worker still installed on `joyorogo.com`; tapping such a
notification opens `joyorogo.com/<path>`, which redirects to the app. Side effect: a browser that has both subscriptions
shows each notification twice. Once most people have moved (suggest 30 days), ship a `joyorogo.com`-only `/sw.js` that
calls `registration.pushManager.getSubscription()?.unsubscribe()` on `activate`; the server prunes the dead endpoints on
the next 404/410 (`docs/push.md`). Not done now, because it silences people who never come back to the new host.

**Installed PWAs.** The manifest uses relative URLs (`id` and `start_url` `/beranda`, `scope` `/`), so on the app host
it is already an app-host manifest; installing from there is a new, correct install. An app installed from
`joyorogo.com` keeps its old identity and opens `joyorogo.com/beranda`, which redirects to the app host. Because
that is outside the installed app's scope, Android Chrome is expected to show it with a browser bar inside the window
(not verified on a device); re-installing from `app.joyorogo.com` removes the bar. iOS Home Screen apps are the unknown
case: check one. The manifest on `joyorogo.com` stays (an installed app must keep a valid one).

## Cut-over runbook

Needs: Cloudflare account `b7e6f8457bd39fa37a7eea5249799754` (web and zone) and `3268f27664d77716b648b00c8850469e`
(server) logged in with wrangler, `apps/server/.env` present.

0. **Before anything**
   - Cloudflare dashboard, zone `joyorogo.com` -> DNS: there must be **no** existing record named `app` (a custom domain
     cannot take over a name that already has one; delete or rename it first).
   - Edit `apps/server/.env`, `CORS_ORIGIN` line. It is the whole list, `scripts/deploy.sh` copies it over the one in
     `wrangler.jsonc`:
     ```
     CORS_ORIGIN=http://localhost:3001,http://localhost:3002,http://localhost:3003,https://joyorogo-web-live-dzul-fqqmlyfh7l3bif2g.dzulfikar-at.workers.dev,https://joyorogo.com,https://app.joyorogo.com,https://admin.joyorogo.com,https://app.fit.joyorogo.com
     ```
     The script now aborts when `https://app.joyorogo.com` is missing.
1. **Server first** (CORS and trusted origins must be live before the app host can call the API). Either `scripts/deploy.sh`
   (it does 1 then 2 below in one go), or by hand: `cd apps/server && bunx wrangler deploy`. This also flips `APP_URL`
   to the app host and adds `SITE_URL`. Between this and step 2 (about a minute) a payment return or e-mail link minted
   in that window points at a host that is not live yet; it works as soon as step 2 finishes.
2. **Web, both hosts**:
   ```
   cd apps/web
   VITE_SERVER_URL="https://api.joyorogo.com" VITE_APP_URL="https://app.joyorogo.com" \
     VITE_REVKLIK_SITE_ID="88069ee9-6eac-4dc9-a23b-f5757a4b948e" bunx vite build --configLoader runner
   CLOUDFLARE_ACCOUNT_ID=b7e6f8457bd39fa37a7eea5249799754 bunx wrangler deploy
   ```
   Wrangler creates the `app.joyorogo.com` DNS record and certificate; the first request can take a minute to get a
   certificate. `scripts/deploy.sh` runs the same build and deploy.
3. **Verify** (status and `Location`; curl does not follow):
   ```
   curl -sI https://joyorogo.com/beranda            # 302 -> https://app.joyorogo.com/beranda
   curl -sI "https://joyorogo.com/login?redirect=%2Fgabung%2FABCD2345"   # 302, query identical
   curl -sI "https://joyorogo.com/koneksi/izin?x=a%2Bb"                  # 302, query identical
   curl -sI https://joyorogo.com/harga              # 200
   curl -sI https://joyorogo.com/panduan/ai         # 200
   curl -sI https://joyorogo.com/blog/              # 200
   curl -sI https://joyorogo.com/privasi            # 200
   curl -sI https://joyorogo.com/gabung/ABCD2345    # 200, og tags still per invite
   curl -sI https://app.joyorogo.com/               # 302 -> /beranda
   curl -sI https://app.joyorogo.com/harga          # 302 -> https://joyorogo.com/harga
   curl -s  https://app.joyorogo.com/robots.txt     # Disallow: /
   curl -sI https://app.joyorogo.com/sw.js          # 200
   curl -s  https://app.joyorogo.com/manifest.webmanifest | head -c 200   # start_url /beranda
   curl -sI -H "Origin: https://app.joyorogo.com" https://api.joyorogo.com/api/auth/get-session   # access-control-allow-origin: https://app.joyorogo.com
   ```
   By hand, in a browser that was signed in on `joyorogo.com`: (a) `https://app.joyorogo.com` opens Beranda with no login;
   (b) in a private window, "Masuk" on `joyorogo.com` -> Google sign-in -> back on `app.joyorogo.com/beranda`;
   (c) an invite link `joyorogo.com/gabung/<code>` signed out -> "Masuk" -> after sign-in the group opens;
   (d) from the app, Profil -> Privasi opens `joyorogo.com/privasi`; (e) make a small QRIS/VA payment: DOKU and Pakasir
   return to `app.joyorogo.com/pembayaran` (if DOKU or Polar refuse the new return domain, this is where it shows; fix in
   their dashboard, then retest); (f) Profil -> Strava connects from the app host; (g) Koneksi AI: start a Claude/ChatGPT
   connection, consent page opens on `app.joyorogo.com/koneksi/izin`; (h) Profil -> Notifikasi: "Aktifkan di browser ini"
   works on the app host and the push banner shows once for an account with a registered browser; (i) an Android
   phone with the old installed PWA opens and lands in the app; (j) Revklik still receives pageviews for `/`, `/harga`,
   `/blog/*` and shows `/login` and `/pembayaran` under the app host.
4. **Rollback** (pick the smallest that fixes it)
   - Web misbehaves: `cd apps/web && bunx wrangler rollback` (previous version of the web Worker). The old bundle has no
     host logic, so both hosts serve the whole app; nothing is lost, `app.joyorogo.com` just works like `joyorogo.com`.
     The 302s are not cached, so browsers follow the rollback at once.
   - Links should point at the old host again: set `APP_URL` back to `https://joyorogo.com` in
     `apps/server/wrangler.jsonc`, `cd apps/server && bunx wrangler deploy`. Keep `CORS_ORIGIN` as it is.
   - Full revert: revert the commit, redeploy server and web with `scripts/deploy.sh`, then remove the `app` custom
     domain (dashboard -> Workers -> `joyorogo-web-live-dzul-fqqmlyfh7l3bif2g` -> Settings -> Domains & Routes).
5. **After a week**: switch `REDIRECT_STATUS` to 301; schedule the old-host service worker retirement (push section).
