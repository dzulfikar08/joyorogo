# Joyo mascot assets

Canonical source PNGs for the JoyoRogo mascot ("Joyo" — green wayang-armoured cat).

## Where the art comes from

All art is the 2026-10-25/26 ChatGPT set (replacing the original low-res concept sheet): the emote sheet
(1536×1024, 15 busts with labels), the app-icon tile (1254×1254), the peek strip (2048×768), the full-body
pose sheet (1750×899: hero, ready), the sitting relax (1254×1254), the alert/head pair (1932×814), and for the
app icons a plain bust (1254×1254) and a flat monochrome glyph (1254×1254). Cut with rembg
(isnet-general-use) plus a key on the flat sheet background, so the sparkles, `!`, `?`, `Zzz` and hearts drawn
next to a pose stay in its cut-out; the peek was keyed off its flat dark-green backdrop and cut at the ledge.
Emote poses are ~300 px crops fitted to 512×512 (Lanczos); bust bottoms keep the sheet's soft fade. Full-body
poses are trimmed (no upscaling; `relax` downscaled to 600 px); `alert` and `head` are ~800 px cuts fitted to
512×512.

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
| `sleepy`                                   | asleep on folded arms, `Zzz`                                   | 512×512   | sheet "Resting"     |
| `love`                                     | hugging a heart                                                | 512×512   | sheet "Love"        |
| `icon`                                     | full rounded app-icon tile (not a cutout), transparent corners | 1024×1024 | icon tile           |
| `peek`                                     | peeking-over head with paws, trimmed                           | 1721×649  | peek strip          |
| `hero`                                     | standing, hands on hips, tail, trimmed                         | 673×857   | pose sheet          |
| `ready`                                    | fighting stance, fist forward, trimmed                         | 551×523   | pose sheet          |
| `relax`                                    | sitting cross-legged, hand behind head, eyes closed, trimmed   | 590×600   | relax image         |
| `alert`                                    | startled bust, eyes wide, `!`                                  | 512×512   | alert/head pair     |
| `head`                                     | head-only cutout, calm smile                                   | 512×512   | alert/head pair     |

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

| File | What |
|---|---|
| `apps/native/assets/images/icon.png` | iOS/Expo icon, 1024 opaque (iOS masks it) |
| `apps/native/assets/images/android-icon-{background,foreground}.png` | adaptive icon, 432 px; the head sits in the 264 px safe circle |
| `apps/native/assets/images/android-icon-monochrome.png` | themed icon and notification small icon: the glyph, ink as alpha |
| `apps/native/assets/images/splash-icon{,-dark}.png` | rounded tile, transparent corners, 1024 (palette PNG) |
| `apps/native/assets/images/favicon.png`, `apps/web/public/favicon.png` | head-only tile, 48 / 32 px |
| `apps/web/public/icons/icon-{192,512}.png` | PWA `any` icons, rounded tile (palette PNG) |
| `apps/web/public/icons/icon-maskable-512.png`, `apple-touch-icon.png` | full-bleed square (palette PNG) |

The public site's logo (landing header and footer, `/my`, `/sg`, blog header) is `apps/web/public/brand/joyo-head.webp`:
`head.png` trimmed, 96 px tall (104×96), shown at 28–32 px. The JR mark (`apps/web/public/brand/logo-mark.svg`) is still the
logo inside the signed-in app, onboarding, invite and AI-connection pages, the admin site and the unsubscribe page.
