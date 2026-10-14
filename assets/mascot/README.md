# Joyo mascot assets

Canonical source PNGs for the JoyoRogo mascot ("Joyo" — green wayang-armoured cat).

Cut from the original one-off sheet (`.tmp/mascot.png`, 1254×1254) with rembg
(isnet-general-use; manual flood-fill keying for `mantap` and `head`), then
trimmed, squared, and upscaled with Lanczos. Because the sheet only ships small
figures, most assets are upscaled from ~150 px crops — expect softness.

## Files

| Name | Kind | Size |
|---|---|---|
| `happy`, `determined`, `surprised`, `wink` | expression heads, 512×512 | web/native |
| `ready`, `cheer`, `working`, `relax` | poses, 512×512 | web/native |
| `mantap`, `gas`, `on-it`, `sleepy`, `alert`, `love` | stickers (lettering baked in where present), 512×512 | web/native |
| `hero` | large standing figure incl. tail, 1024×1024 | web/native |
| `peek` | peeking-over head with paws, 1024×1024 | web/native |
| `icon` | full rounded app-icon tile (not a cutout), 512×512 | web/native |
| `head` | head-only cutout, 512×512 | web/native |

Locations:

- `assets/mascot/*.png` — canonical source PNGs (edit/replace these first)
- `apps/web/public/mascot/*.webp` — optimised WebP for the web app
- `apps/native/assets/mascot/*.webp` — WebP for the native app; only poses a screen uses (`apps/native/components/mascot.tsx` `POSES` map, Metro bundles just those)

## Upgrading the art

Drop in better source art by **overwriting the files in `assets/mascot/` with
the same names**, then re-export the web/native copies (WebP q~85 for web,
WebP for native). `peek` and `hero` are trimmed to their bounding box in the web/native copies (881×384, 560×875). No filename changes needed — consumers reference
assets by name.

Known caveats (from the low-res sheet): soft edges from upscaling, slightly
hard alpha edges on `mantap`/`head` (manual keying), and baked-in sticker
lettering on `mantap`/`gas`/`on-it`.
