# Static social content

HTML sources for Instagram/Threads carousels, single images and stories. One folder per piece, one shared renderer.

```
docs/marketing/content/
  _base.css          shared type scale, brand themes (.rogo, .fit), phone frame, .snap crops, rows, cards
  render.ts          bun renderer
  _shots/            real screenshots of the web app (webp), shared by every piece
  <slug>/slides.html every slide is <section class="slide rogo|fit [deep|soft]">
  <slug>/caption.md  Threads + Instagram caption, 3 to 5 hashtags, link with UTM
```

## Add a piece

1. Copy the closest folder (feature release: `joyorogo-update-2026-10-20`, explainer: `joyorogo-cara-hitung-target`, single image: `infografis-gorengan-vs-nasi`, JoyoFit: `joyofit-tanpa-huawei-health`).
2. Edit `slides.html`. Brand class on each section: `rogo` (JoyoRogo green) or `fit` (JoyoFit teal). `deep` = dark brand background, `soft` = tinted.
3. Asset paths use tokens the renderer expands: `@joyorogo/` (this repo), `@watch-fit/` (sibling `../watch-fit`, override with `WATCH_FIT_DIR`), `@content/` (this folder). Use real screenshots inside `.phone`; never invent UI.
4. Mark anything that is meant to bleed past the slide edge (phones, mascot, cropped screenshots) with `data-bleed`; the renderer warns about everything else that overflows the slide or runs into the footer.
5. Every slide except the cover and the CTA shows a real screenshot (see "Screenshots" below). Crop to the one control the headline is about instead of shrinking a whole phone.
6. Write `caption.md`. UTM per `docs/utm.md`: `utm_source=threads|instagram`, `utm_medium=social` (`bio` for the link in bio), `utm_campaign=<yyyy-mm>-<topic>`.

## Screenshots

`_shots/rogo-*.webp` are 1320 px wide shots (440 css px at 3x) of the JoyoRogo web app with the demo account "Rina" (fictional, never the owner's account or data). Commit them here so a piece never depends on the gitignored `.tmp`. Prefer these over hand-built mock UI; JoyoFit shots come from `@watch-fit/site/public/shots` and `@watch-fit/docs/screenshots`.

Crop with `.snap`, described in source pixels of the shot (see the comment in `_base.css`):

```html
<div class="snap" style="--s:.697;--cx:0;--cy:1010;--cw:1320;--ch:330"><img src="@content/_shots/rogo-scan-after-top.webp" alt=""></div>
```

`--s` is slide px per source px (.697 makes a full-width crop 920 px wide). A callout ring (`<span class="callout" style="--rx:..;--ry:..;--rw:..;--rh:..">` inside the `.snap`) marks the one number that matters; a `.fig` wrapper with `<span class="tag">Sebelum</span>` labels a before/after pair. Do not put more than one ring per crop unless both mean the same thing.

Re-shoot (all in `.tmp/appstore`, gitignored; needs Chromium and a local stack):

```
# once: a clean local D1, API on :3000 and web on :3001
cd apps/server && bunx wrangler d1 migrations apply DB --local --persist-to /tmp/joyo-state
cd apps/server && bunx wrangler dev --port 3000 --local --persist-to /tmp/joyo-state      # DEV_LOGIN=1 comes from .dev.vars
cd apps/web && VITE_SERVER_URL=http://localhost:3000 VITE_DEV_LOGIN=1 bun run dev:bare
# then
cd .tmp/appstore && bun seed-content.mjs            # Rina: profile, weights, meals, a watch run today, 14 days of steps
cd .tmp/appstore && bun shoot-content.mjs [name,...] # writes _shots/rogo-<name>.webp
```

Seed and shoot scripts only talk to localhost. The AI calls on the scan screens (`analyzeFood`, `correctScan`, `barcode.readLabel`, lookup) are mocked inside `shoot-content.mjs` with fixed answers (a nasi + ayam plate, an opaque cup, a made-up label), so a shot shows the real screen and flow, not a real model answer. Say so in the piece's `caption.md` notes and never present the numbers as a measured scan. Rest day and run day in `joyorogo-cara-hitung-target` are the same day shot before and after the run is added.

## Render

```
bun docs/marketing/content/render.ts <slug>
```

PNGs go to `dist/marketing/<slug>/01.png ...` (dist is gitignored). Sizes: carousel and single image 1080x1350; story 1080x1920 (add class `story` to the section). The renderer checks every PNG size and prints `WARN` lines for wrong sizes or clipped content. `.pg` in the footer is filled with `n/N` automatically for multi-slide pieces.

Browser lookup: `CHROMIUM_PATH`, then `PLAYWRIGHT_BROWSERS_PATH` or `~/.cache/ms-playwright` (headless shell), then `/usr/bin/chromium`. Playwright comes from `node_modules/.bun`, the font (Plus Jakarta Sans) from `@fontsource-variable`.

## Rules

Claim rules live in `docs/marketing/marketing-plan.md` (sections 1.1, 1.6, 3.3). Short version:

- Estimates are labelled "perkiraan". No accuracy percentages, no weight-loss or medical promises, no testimonials.
- Availability (owner approved 2026-10-23): "download di Play Store (versi tes, gabung dulu lewat link)", JoyoRogo iPhone: "di App Store" (live, verified 2026-10-28; JoyoFit iPhone is still TestFlight), or web. Never "tersedia di Play Store"; Android is still a closed test.
- JoyoRogo mascot: green, armored, hero pose only. No other brands' logos (Huawei, Honor, WHOOP, Strava).
- JoyoFit pieces: "tidak berafiliasi dengan Huawei", "Diuji di Huawei Watch Fit 4 Pro, jam lain eksperimen", Strava as "kirim latihan ke Strava".
- Last slide: one CTA only.
