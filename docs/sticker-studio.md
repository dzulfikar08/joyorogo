# Sticker engine and Sticker Studio

One declarative template format, one resolver, thin painters. Every built-in share
sticker in JoyoRogo is a template in this schema; the future Studio (a watch-face
studio for share stickers) only edits templates, so presets and user stickers share
all the code.

**This file is the shared spec.** JoyoRogo owns it (`docs/sticker-studio.md`);
JoyoFit mirrors it verbatim and adds only its own binding namespaces (section 5).
The `core/` directory of `packages/sticker` is byte-identical in both repos; the
test `core/core-hash.test.ts` pins its hash so drift is a red test, not a surprise.

```
packages/sticker/src/
  core/          portable, app-agnostic, depends on zod only (IDENTICAL in both repos)
    schema.ts      zod schema, types, SCHEMA_VERSION
    migrate.ts     version migrations
    parse.ts       lenient parse: drop bad layers, fall back, report issues
    expr.ts        {path|filter} bindings and filters
    format.ts      locale number/date/duration formatting (no Intl)
    text.ts        sanitize + measuring over a FontMetrics interface + fit
    color.ts       color tokens, rgba mixing
    resolve.ts     template + data -> Scene (layout, stacks, text/stat/image/brand/icon/shape)
    draw.ts        geometry of ring, chart and route layers
    scene.ts       Scene node types
    lint.ts        authoring checks (safe area, min size, unknown filters)
    emit-svg.ts    Scene -> SVG string
    emit-canvas.ts Scene -> Canvas2D calls
    route.ts       polyline projection, privacy trim
    icons.ts       built-in icon paths
    studio.ts      editor ops, undo history, TemplateStore interface
  <app>/         app specific (JoyoRogo: rogo/): font tables (metrics.ts, generated),
                 fonts.ts, brand marks, data builders, templates, fixtures
```

The native painter (react-native-svg) lives in the app because it imports RN.

## 1. Template (schema version 1)

Everything is plain JSON. Lengths are **design px on a canvas that is always
1080 wide**; export resolution is fixed at 1080 x `canvas.height` (optionally x2),
independent of the device screen.

```ts
Template = {
  schemaVersion: 1,
  id: string,                 // /^[a-z0-9][a-z0-9._-]{0,63}$/ ; built-ins "<kind>.<style>[.<canvas>]"
  name: string,               // developer name, English
  titleKey?: string,          // i18n key for the picker label, falls back to name
  kind: string,               // data kind this template draws: "day", "meal", "run", ...
  style: string,              // "minimal"|"bold"|"receipt"|"poster"|"glass"|"map"|"badge"|"ring"|"sticker"
  canvas: { width: 1080, height: 320..2400, aspect: "story"|"square"|"portrait"|"wide"|"free" },
  safe?: { top, right, bottom, left },      // px insets; story default {250,72,340,72}
  background: Background,
  themes: { dark: Theme, light: Theme },    // light/dark aware: ctx.mode picks one
  layers: Layer[],                          // paint order, first = bottom
  constraints?: { minFontSize?: 22, maxTextChars?: 140, maxLayers?: 60 },
  requires?: string[],        // data paths that must exist or the template is not offered
  pro?: boolean,              // reserved for Pro gating of the template itself
  meta?: { tags?: string[], transparent?: boolean, needsPhoto?: boolean, needsRoute?: boolean }
}
```

`aspect` is informational and validated against `height`: story 1920, square 1080,
portrait 1350, wide 608 (+-1); `free` is anything in range (stickers are `free`).

### Theme

```ts
Theme = {
  colors: { bg, bg2, fg, fgSoft, fgMuted, accent, accent2, surface, surfaceStrong,
            line, good, warn, bad,
            data1, data2, data3 },          // data1..3 = categorical hues (macros, zones); all optional, defaulted; hex #rgb #rrggbb #rrggbbaa or rgba()
  fonts?: { display?: FontRef, body?: FontRef, mono?: FontRef }  // usually omitted: host font map decides
}
```

Color strings accepted everywhere a color is: `#hex`, `rgb()/rgba()`, a token
`$accent`, a token with percent alpha `$fg/60` (alpha 0..100), or `transparent`.

Fonts are logical: `"display"|"body"|"mono"`. The host supplies a `FontMap`:
`metrics(role, weight) -> {asc, desc, cap, xh, advance(cp)}` (advance tables generated
from the real font files by `scripts/gen-metrics.ts`; `createTableMetrics` /
`createMonoMetrics` build them) and `paint(role, weight) -> {family, weight?}` for
painters (native encodes weight in the family name, web passes a numeric weight).
Weights are 100..900 in steps of 100; the host maps a requested weight to the
nearest it has. JoyoRogo: Plus Jakarta Sans 500-800 (display and body), IBM Plex Mono
400/500/700 (receipts). Layout never asks the platform text engine, so it is
identical in Node tests, the web and native.

### Background

```ts
{ kind:"transparent" }
{ kind:"color", color }
{ kind:"gradient", angle: deg, stops:[{at:0..1,color}], glows?:[{x,y,r,color,opacity}] }  // glows = radial
{ kind:"photo", bind?: "photo", fit?: "cover", scrim?: Scrim, tint?: {color,opacity}, fallback: Background }
{ kind:"map",   bind?: "mapImage", fit?: "cover", scrim?: Scrim, fallback: Background }
Scrim = { side:"bottom"|"top"|"both"|"full", color, opacity: 0..1, from?: 0..1 }
```

`photo` and `map` fall back to `fallback` when the bound image is missing, so a
photo card with no photo still renders. `fallback` cannot itself be `photo`/`map`.

### Layers

Common fields on every layer:

```ts
{ id: string (unique in template), type, name?: string,
  box: { x, y, w, h },        // inside the parent; w/h: number | "auto" | "fill" (auto/fill meaningful in stacks)
  rotation?: deg, opacity?: 0..1,
  when?: Condition,           // visibility
  onMissing?: "hide"|"keep",  // default hide: any unresolved binding hides the layer
  role?: "watermark"|"attribution",  // watermark: removed when options.watermark=false; attribution: never removed (Strava marks)
  locked?: boolean }          // Studio hint, ignored by the resolver
```

| type | purpose | extra fields |
|---|---|---|
| `text` | one text run | `value: Expr`, `size`, `weight`, `font`, `color`, `align`, `letterSpacing` (px), `lineHeight` (x size, default 1.15), `case?: "upper"|"none"`, `trim?: "none"|"cap"` (single line: box height = cap height, baseline at its bottom, for tight big numerals), `valign?: "top"|"middle"|"bottom"` (inside a numeric `box.h`), `fit: {mode:"shrink"|"ellipsis"|"wrap", minSize?, maxLines?}`, `shadow?: boolean` (two soft dark copies behind, for text over photos) |
| `stat` | value + unit + label block | `value: Expr`, `unit?: Expr`, `label?: Expr`, `valueSize`, `unitSize?`, `labelSize?`, `valueWeight`, `color`, `labelColor?`, `align`, `labelPos: "above"|"below"|"none"`, `gap`, `trim` (default `"cap"`), `fit` as text; value+unit shrink together to fit `box.w` (unit sits on the value baseline) |
| `ring` | progress ring / gauge | `progress?: NumRef`, `segments?: [{value: NumRef, color}]`, `thickness`, `startAngle` (default -90), `sweep` (default 360, gauge 270), `track?: color`, `color`, `overColor?`, `cap: "round"|"butt"`, `max?: number` (progress denominator, default 1; progress > max draws a second lap in `overColor`, default `$warn`). With `segments` (fractions of the sweep, drawn in order with butt caps) `progress` is ignored; a ring with neither is hidden |
| `chart` | `kind: "bars"|"line"|"area"|"spark"|"stack"` | `series?: {bind}` (a number[]); `labels?: {bind}` (string[]); `colors?: {bind}` (string[] per bar, falls back to `color`); `color`, `color2?` (non-highlighted bars, default `color` at 40%), `highlight?: "max"|"min"|"last"|index`, `horizontal?: boolean` (bars as rows with labels on the left), `baseline?: NumRef`, `strokeWidth`, `barRadius`, `showLabels`, `labelSize`, `min?`, `max?`; `stack` uses `segments: [{value: NumRef, color}]` and draws one proportional bar |
| `route` | GPS polyline | `points: {bind}` (array of `[lat,lng]` or encoded polyline string), `color`, `color2?` (gradient along path), `strokeWidth`, `halo?: boolean` (wider 28% duplicate stroke under the line, no filters), `markers?: boolean`, `padding`, `trim?: "privacy"|number` (meters off BOTH ends, default `"privacy"` = `options.privacy.routeTrimMeters`, 200 unless disabled), `dash?: [on,off]` |
| `image` | photo, asset | `src: {bind} | {asset}`, `fit: "cover"|"contain"`, `radius?`, `mask?: "circle"|"rounded"`, `border?: {color,width}` |
| `brand` | app mark, wordmark, link | `mark: "logo"|"wordmark"|"lockup"|"link"`, `tone: "auto"|"light"|"dark"|"mono"`, `size?` |
| `icon` | built-in icon | `name: IconName`, `color`, (size = box) |
| `shape` | rect/ellipse/line/path | `shape`, `radius?`, `fill?: Paint`, `stroke?: {color,width,dash?}`, `d?` + `viewBox?` for `path`; `Paint = color | {gradient:{angle,stops}}`; `glass?: boolean` (translucent surface fake-glass: fill + 1 px top-lit edge, NOT a backdrop blur) |
| `group` | container and panel | `children: Layer[]`, `layout?: {kind:"stack", dir:"row"|"column", gap, align:"start"|"center"|"end"|"stretch", justify:"start"|"center"|"end"|"between", padding}`, panel look: `fill?`, `stroke?`, `radius?`, `glass?` |

Without `layout` a group places children absolutely at `box.x/y` relative to the
group. In a stack, `x/y` are ignored, `w`/`h` of `"auto"` take the measured content,
`"fill"` shares the remaining main-axis space, and hidden/missing children are removed
so the stack reflows (that is how "no HR" collapses cleanly).

Unknown layer `type`, a layer failing validation, an unknown icon, or a bad box is
**dropped** with an issue, never thrown (section 8).

### Condition

```ts
{ bind, exists?: boolean, eq?, ne?, gt?, gte?, lt?, lte?, in?: [] }
| { all: Condition[] } | { any: Condition[] } | { not: Condition }
```

### Constraints

`minFontSize` (default 22): the resolver never emits text smaller than this (an
authoring `size` below it is raised, a `fit.minSize` below it is raised).
`maxTextChars` (default 140): longer text is cut with an ellipsis before measuring.
`safe`: the lint (`lintTemplate`) reports layers whose box leaves the safe area;
`resolve` does not move them, so transparent stickers can ignore `safe`.

## 2. Expressions (`Expr`)

```ts
Expr = string | { t: "ns:key", args?: Record<string, string> }
```

- A **string** is a template: literal text with `{path}` / `{path|filter|filter:arg,arg}`
  interpolation. `{{` and `}}` are literal braces. `{path?}` marks an optional path
  (renders empty instead of hiding the layer).
- `{ t, args }` calls the host's `t(key, resolvedArgs)`; each arg is itself a template
  string resolved first. An arg named `count` selects plurals in i18next. Missing arg
  = missing binding.
- A text-ish layer resolves to missing when **any** non-optional placeholder
  resolves to `undefined`, `null`, `NaN` or `""`; then `onMissing` decides (hide by
  default, or "keep" which uses the layer's `fallback?: string`, default `"-"`).
- Paths read `StickerData.data`, with `opt.*` (options), `app.*` and `date` injected.
  Dots index objects and arrays: `week.days.0.kcal`.

`NumRef = number | { bind: string, div?: string|number, mul?: number, add?: number, clamp?: [min,max] }`
evaluated as `clamp(bind / div * mul + add)` (`div` is a path or constant; division by
zero = missing; `{bind:"x", mul:-1, add:1}` is `1 - x`).

### Filters

| filter | input -> output |
|---|---|
| `int` | 1234.5 -> `1.235` (id) / `1,235` (en); rounds half away from zero |
| `num:d` | fixed d decimals, locale separators |
| `signed` / `signed:d` | prefixes `+`/`-` (true minus U+2212 is NOT used, ASCII `-`) |
| `pct` / `pct:d` | 0.734 -> `73%` |
| `compact` | 12500 -> `12,5 rb` (id) / `12.5K` |
| `unit:x` | appends ` x` after a space |
| `dur` | seconds -> `m:ss` / `h:mm:ss` |
| `durhm` | seconds -> `1j 05m` (id) / `1h 05m` |
| `pace` | sec/km -> `5:42` |
| `km` / `km:d` | meters -> km, default 2 decimals |
| `m` | meters -> integer meters |
| `date:style` | ISO date or ms -> `short` `12 Okt`, `medium` `12 Okt 2026`, `weekday` `Senin`, `weekdayShort` `Sen`, `day`, `month` |
| `upper` `lower` `title` | case |
| `ellipsis:n` | cut to n chars + `...` |
| `first` | first word (first names) |
| `plural:one,other` | pick by number, for ad-hoc plurals (en) |
| `default:text` | substitute for a missing value (does not hide the layer) |

Unknown filter = missing binding for that placeholder (and an issue in lint).

## 3. Data (`StickerData`)

```ts
StickerData = {
  data: Record<string, JSON | ImageRef>,   // flat or nested; namespaces below
  assets?: Record<string, ImageRef>,       // "photo", "mapImage", brand art by id
  options: { watermark: boolean, hideNumbers: boolean, showName: boolean,
             privacy: { routeTrimMeters: number } },   // defaults true,false,false,{200}
}
ImageRef = { uri: string, width?: number, height?: number }
```

`ctx` = `{ locale: "id"|"en", mode: "dark"|"light", t(key,args), fonts: FontMap, brand: BrandMarks }`.
`BrandMarks = { name, link, logo(tone: "light"|"dark"|"mono") -> { viewBox:[x,y,w,h], items: [{d, fill?, stroke?, transform?}] } }`
is the host's vector logo and app name/link (read back as `app.name`, `app.link`).

## 4. Scene (the one thing painters see)

`resolve(template, StickerData, ctx) -> Scene`:

```ts
Scene = { width: 1080, height, background nodes first, nodes: Node[], issues: Issue[],
          transparent: boolean, needsImages: string[] }
Node = rect | ellipse | path | text | image | group(clip, opacity)
  rect    {x,y,w,h,rx?, fill?: Paint, stroke?, opacity?}
  ellipse {cx,cy,rx,ry, fill?, stroke?, opacity?}
  path    {d, fill?, stroke?, fillRule?, transform?: {x,y,scale,rotate?}, opacity?}
          // d is SVG path syntax; with `transform` it is translate(x y) rotate(r) scale(s) and
          // stroke.width is in the path's local units (so it scales too), otherwise absolute
  text    {x, y(baseline), text, size, weight, font, fill, anchor:"start"|"middle"|"end", letterSpacing?, shadow?}
  image   {x,y,w,h, uri, fit, rx?, opacity?}
  group   {children, clip?: {x,y,w,h,rx}, opacity?}
Paint = color(rgba string) | {linear:{x1,y1,x2,y2,stops}} | {radial:{cx,cy,r,stops}}
```

Painters (`emit-svg`, `emit-canvas`, native react-native-svg) are 1:1 maps and do no
layout. `text` is always a single line already measured and fitted (wrap mode is
broken into one text node per line by the resolver). Transparency is preserved:
`transparent` is true when the template background resolves to `transparent`.

## 5. Binding namespaces

Shared by both apps:

| path | value |
|---|---|
| `photo`, `mapImage` | image refs live in `assets`, not `data`; `image` layers and photo/map backgrounds bind them with `{bind:"photo"}` (assets are looked up first, then `data`) |
| `app.name` / `app.link` | `JoyoRogo` / `joyorogo.com` (JoyoFit: `JoyoFit` / `fit.joyorogo.com`) |
| `date` | ISO date or ms of the sticker's subject |
| `user.name` | only present when `options.showName`; first name only unless the host passes a full one |
| `opt.hideNumbers`, `opt.showName`, `opt.watermark` | booleans from options |

JoyoRogo namespaces (data builders in `rogo/data.ts`): `day.*`, `meal.*`, `streak.*`,
`weight.*`, `week.*`, `challenge.*`, `workout.*` (strength logged in JoyoRogo),
`milestone.*`. JoyoFit adds `run.*`/`activity.*`, `strength.*`, `sleep.*`, `ready.*`,
`load.*`, `plan.*`, `watch.*` in its own data builders (not part of core).

## 6. Layout, fit, text

- Text is **measured** with `metrics.ts` advance tables (generated from the real font
  files, kerning ignored, 1.5% safety margin), never with the platform text engine.
- `fit.mode`:
  - `shrink` (default): reduce `size` in 1 px steps down to `minSize` (>= minFontSize), then
    ellipsize.
  - `ellipsis`: keep size, cut with `...`.
  - `wrap`: word-wrap up to `maxLines` (default 2), shrinking is NOT applied, last line
    ellipsized.
- `sanitizeText`: NFC; strips control chars, zero-width joiners, variation selectors
  and every emoji / pictograph / unsupported symbol (the host fonts have no color
  emoji, so they are removed rather than drawn as tofu); collapses whitespace;
  trims. Supported ranges: Basic Latin, Latin-1, Latin Extended-A/B, general punctuation,
  currency, arrows and `kg`-style letterlike symbols.
- Numbers use `format.ts` (id: `1.234,5`, en: `1,234.5`); it never relies on `Intl`
  (Hermes) so Node, web and native print the same string.

## 7. Privacy defaults

- Weight: `weight.*` templates read `opt.hideNumbers`; **default true** for any template
  that would show a weight in kg. Hidden numbers show percent of goal or direction only.
- Route: first and last 200 m are trimmed (`options.privacy.routeTrimMeters`, 0 disables;
  the Studio toggle sets it). A route shorter than 2x the trim collapses to "missing"
  (no route drawn) rather than drawing a stub.
- Name: absent unless `options.showName`.
- Watermark: `role:"watermark"` layers hide when `options.watermark === false`
  (allowed only for Pro; the host enforces, the resolver just obeys).
- `role:"attribution"` (Strava marks, "Powered by Strava") is never removed.

## 8. Validation, degradation, migrations

- `parseTemplate(raw) -> { template, issues, degraded }`: runs `migrate`, validates the
  header strictly (id, canvas, themes, background, schemaVersion), validates each layer
  independently, **drops** invalid or unknown layers (recursively inside groups) and
  records an issue per drop. If the header is invalid, or no layer survives, the result
  is `FALLBACK_TEMPLATE` (a plain brand card) with `degraded: true`. It never throws.
- `schemaVersion` greater than the engine's: `degraded` fallback (`issues[0].code ===
  "too-new"`), the host can prompt for an app update. Lower: `migrate` runs
  `MIGRATIONS[v] (v -> v+1)` until current. A migration throwing is a degraded fallback.
- Background `photo`/`map` with a missing image uses `fallback`.
- `image` layer with a missing/unloadable image is hidden; `ring` without a progress
  value is hidden; `chart` with < 2 points (line/area/spark) or 0 (bars) is hidden;
  `route` without >= 2 usable points after trim is hidden.
- The resolver is total: any `(Template, StickerData)` yields a Scene; errors become
  `issues`, not exceptions.

## 9. Export and share

- The share sheet mounts one painter at `1080 x canvas.height`, waits for fonts
  (`Font.loadAsync` on native, `document.fonts.load` on web) and for every
  `scene.needsImages` URI, then captures. Native uses `react-native-view-shot`
  (`captureRef`, `{format:"png", width:1080, height, result}`) on a view laid out at
  `1080 / PixelRatio` dp so the file is exactly 1080 wide on every device; web draws the
  Scene on a 1080-wide `<canvas>`.
- Photos are downscaled before render (longest side 2048 px, JPEG 0.9) and the
  original is never held in memory twice.
- Targets: Instagram Stories (sticker layer for `transparent`, background for full
  cards; fallback to the system sheet when the app is missing), system share, copy,
  save to gallery (pre-permission "Lanjut", then the system dialog).

## 10. Sticker Studio data model (later; nothing here has UI yet)

```ts
UserTemplate = {
  id: string,                 // "u-" + random
  schemaVersion: 1,
  name: string,
  baseId?: string,            // preset it was forked from
  kind: string,
  template: Template,         // full copy, edited freely
  createdAt: number, updatedAt: number,
  sync: "local" | "cloud-pending" | "cloud"   // "cloud" is Pro, later
}
TemplateStore = { list(): UserTemplate[], get(id), put(t), remove(id) }   // local KV first
```

Editor ops are pure `(Template, Op) -> Template`, with an undo/redo history
(`createHistory`, `push`, `undo`, `redo`, capped at 100):

| op | effect |
|---|---|
| `addLayer {layer, parentId?, index?}` | inserts (id made unique) |
| `removeLayer {id}` | |
| `moveLayer {id, x, y}` | sets `box.x/y` |
| `resizeLayer {id, w, h}` | sets `box.w/h` |
| `reorderLayer {id, index}` | z-order within parent |
| `rebind {id, field, expr}` | changes the Expr/NumRef/bind of `value`/`progress`/`series`/... |
| `restyle {id, patch}` | shallow merge of style fields (color/size/weight/...) validated against the layer schema |
| `setBackground {background}` | |
| `setTheme {mode, colors}` | token edits |
| `setCanvas {height, aspect}` | |

Every op result is re-validated with the layer schema; an invalid result is rejected
and the old template kept. Cloud sync (Pro) stores `UserTemplate` JSON; the server
only validates `schemaVersion` and size, it never renders.

## 11. Testing

- Unit: schema validation, drop/fallback, migrations, expressions, filters, locale
  numbers, text sanitize/fit, route trim, resolve edge cases (no HR, no route, no
  photo, long names, emoji), studio ops.
- Golden: every built-in template x fixture renders through `emit-svg` in headless
  Chromium to PNG, compared to `__goldens__/`, plus an `emit-canvas` agreement check;
  a contact sheet PNG of all templates is produced by `bun run stickers:sheet`.

## 12. JoyoRogo catalog

See the end of this file (filled when templates land).
