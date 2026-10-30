# Joyo mascot assets

Canonical source PNGs for the JoyoRogo mascot ("Joyo" — green wayang-armoured cat).

## Where the art comes from

All poses except `peek` and `icon` (and the `scan` scene) were regenerated on 2026-10-30 in ChatGPT, one pose per image
(1254×1254, real alpha, subject fully inside the frame, busts ending in a clean rounded edge instead of the old sheet
fade), using `wave` as the style reference and the previous cut-out of the same name as the pose reference. Exports
crop to the alpha bounding box (alpha > 8%), then: square poses fitted to 496 px inside 512×512; `hero` 857 px tall;
`ready`/`relax` fitted to 600 px; widget art fitted to 192 px; iOS widget art 300 px tall. `peek` and `icon` are still
the 2026-10-25/26 set (peek keyed off its flat backdrop, icon tile 1254×1254).

## Files

| Name                                       | Kind                                                           | Size      | Art                 |
| ------------------------------------------ | -------------------------------------------------------------- | --------- | ------------------- |
| `happy`, `determined`, `surprised`, `wink` | expression busts                                               | 512×512   | sheet (same names)  |
| `curious`, `thinking`, `proud`             | expression busts                                               | 512×512   | sheet (same names)  |
| `cheer`                                    | both fists up, laughing                                        | 512×512   | sheet "Cheer"       |
| `gas`                                      | fist pump, fired up (no lettering)                             | 512×512   | sheet "Excited"     |
| `mantap`                                   | thumbs up (no lettering)                                       | 512×512   | sheet "Encouraging" |
| `working`                                  | typing on a laptop                                             | 512×512   | sheet "Focused"     |
| `on-it`                                    | writing in a notebook (no lettering)                           | 512×512   | sheet "Working"     |
| `eating`                                   | eating a bowl of food                                          | 512×512   | sheet "Eating"      |
| `scan`                                     | photographing a plate with a phone                             | 512×512   | scan image          |
| `scale`                                    | pointing at a kitchen scale (250 g)                            | 512×512   | scale image         |
| `watch`                                    | running, checking a smartwatch                                 | 512×512   | watch image         |
| `sleepy`                                   | asleep on folded arms, `Zzz`                                   | 512×512   | sheet "Resting"     |
| `love`                                     | hugging a heart                                                | 512×512   | sheet "Love"        |
| `icon`                                     | full rounded app-icon tile (not a cutout), transparent corners | 1024×1024 | icon tile           |
| `peek`                                     | peeking-over head with paws, trimmed                           | 1721×649  | peek strip          |
| `hero`                                     | standing, hands on hips, tail, trimmed                         | 620×857   | ChatGPT 2026-10-30  |
| `ready`                                    | fighting stance, fist forward, trimmed                         | 578×600   | ChatGPT 2026-10-30  |
| `relax`                                    | sitting cross-legged, hand behind head, eyes closed, trimmed   | 585×600   | ChatGPT 2026-10-30  |
| `alert`                                    | startled bust, eyes wide, `!`                                  | 512×512   | alert/head pair     |
| `head`                                     | head-only cutout, calm smile                                   | 512×512   | alert/head pair     |
| `wave`                                     | upper body waving, other paw on hip (login screens)            | 512×512   | ChatGPT 2026-10-30  |

Locations:

- `assets/mascot/*.png` — canonical source PNGs (edit/replace these first)
- `apps/web/public/mascot/*.webp` — optimised WebP for the web app (512 px; `icon` 512, `peek` 960×362;
  `hero`, `ready`, `relax` at their canonical size)
- `apps/native/assets/mascot/*.webp` — byte copies of the web WebPs; only poses a screen uses
  (`apps/native/components/mascot.tsx` `POSES` map, Metro bundles just those)
- `apps/admin/public/mascot/surprised.webp` — copy of the web WebP for the admin error screen
- `apps/native/assets/widget/mascot/*.webp` — Android streak widget: trimmed, longest side 192 px; sizes are
  in `MASCOT_ART` (`apps/native/src/lib/widgets/streak-model.ts`, a test reads the files)
- `apps/native/targets/widget/Assets.xcassets/mascot-*.imageset/*.png` — iOS streak widget: trimmed, 300 px tall

## Upgrading the art

Drop in better source art by **overwriting the files in `assets/mascot/` with
the same names**, then re-export the copies above (WebP q85, alpha q90). A trimmed
asset that changes shape (`peek`, `hero`, `ready`, `relax`) also needs its intrinsic size in
`apps/web/src/components/mascot.tsx` (`INTRINSIC`), `apps/native/components/mascot.tsx` (`dimensions`) and the
landing pages' `hero.webp` `width`/`height`; a widget pose needs `MASCOT_ART`. No filename changes needed —
consumers reference assets by name.

## App icons

Built from the bust cut-out (shoulders extended sideways so a scaled-down bust never shows the frame's cut) on a
deep-green radial gradient (`#2c9452` → `#157040` → `#083a25`), and from the monochrome glyph:

| File                                                                   | What                                                             |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `apps/native/assets/images/icon.png`                                   | iOS/Expo icon, 1024 opaque (iOS masks it)                        |
| `apps/native/assets/images/android-icon-{background,foreground}.png`   | adaptive icon, 432 px; the head sits in the 264 px safe circle   |
| `apps/native/assets/images/android-icon-monochrome.png`                | themed icon and notification small icon: the glyph, ink as alpha |
| `apps/native/assets/images/splash-icon{,-dark}.png`                    | rounded tile, transparent corners, 1024 (palette PNG)            |
| `apps/native/assets/images/favicon.png`, `apps/web/public/favicon.png` | head-only tile, 48 / 32 px                                       |
| `apps/web/public/icons/icon-{192,512}.png`                             | PWA `any` icons, rounded tile (palette PNG)                      |
| `apps/web/public/icons/icon-maskable-512.png`, `apple-touch-icon.png`  | full-bleed square (palette PNG)                                  |

The logo next to the "JoyoRogo" wordmark everywhere on the web (landing header and footer, `/my`, `/sg`, blog header, the
signed-in app's desktop bar, onboarding, invite and AI-connection pages, the admin site, the unsubscribe page) is
`brand/joyo-head.webp` (`head.png` trimmed, 208×192, shown at 28–64 px; a copy lives in `apps/admin/public/brand/`). The admin
tab icon is `apps/admin/public/favicon.png`: the head on a green tile with an amber "A" badge. The JR mark
(`apps/web/public/brand/logo-mark.svg`) remains only as the brand line in the marketing slide templates
(`docs/marketing/content`).
