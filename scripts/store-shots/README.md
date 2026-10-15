# Store screenshots

Dark Play/App Store slides in the style of the JoyoRogo App Store set: wordmark, two-line headline with
one highlighted word, subhead, and a phone frame (notch, 9.41 status bar) around a real app capture.
Output is 1390x2778, 8-bit RGB, no alpha (Play: long side at most 2x the short side).

```sh
bun scripts/store-shots/render.ts scripts/store-shots/specs/joyofit.json
bun scripts/store-shots/render.ts scripts/store-shots/specs/joyorogo-extra.json --only 05
bun scripts/store-shots/render.ts spec.json --width 1284          # App Store width
bun scripts/store-shots/render.ts spec.json --out-dir /tmp/slides # ignore `out` directories
```

Needs `playwright` + `sharp` (root devDependencies) and Chromium (`/usr/bin/chromium`, or `CHROMIUM=<path>`).
Fonts are the repo's Plus Jakarta Sans files in `apps/native/assets/widget/fonts`.

## Spec

`{ "defaults": { ... }, "slides": [ { ... } ] }`, or a bare array of slides. Paths are relative to the spec file.

| field | meaning |
| --- | --- |
| `out` | PNG path |
| `brand` | wordmark; split before the last capital (`JoyoFit` is "Joyo" + "Fit") |
| `brandColor` | colour of the second wordmark part |
| `highlightColor` | colour of the highlighted word |
| `headline` | text, `\n` forces a line break |
| `highlight` | substring of `headline` painted in `highlightColor` |
| `subhead` | one line under the headline |
| `screen` | app capture PNG |
| `crop` | `{ top, bottom, left, right }` source pixels removed before fitting (status bar, system nav, edge artefacts) |
| `leaf` | JoyoRogo leaf over the wordmark |

A slide is one line once `defaults` carries the brand fields. A capture taller than the screen shrinks
to fit (its edge pixel columns fill the margins), so a bottom tab bar is never cut.

## Captures

`capture.sh` opens deep links and runs `screencap` (the phone must be awake and unlocked):

```sh
scripts/store-shots/capture.sh com.joyodigitama.joyofit ../watch-fit/dist/store/captures \
  today=joyofit:// readiness=joyofit://readiness trends=joyofit://trends sleep=joyofit://sleep \
  workouts=joyofit://workouts workout-live=joyofit://workout-live
```

Captures may show personal data (name, photo, email): crop it out or pick another screen. Do not
commit captures or outputs (`dist/` is gitignored).
