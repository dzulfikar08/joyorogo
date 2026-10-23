# Plate stickers (whole-plate cutout) and barcode product stickers

A scanned meal carries two kinds of cutout, stored side by side:

| | What | Stored as | Row column |
|---|---|---|---|
| Component sticker | One food, cut out of the photo with the vision model's box | `scans/<id>.png` | `food_log.scan_id` (one per row) |
| Plate sticker | The whole plate or bowl with all its food, cut out of the background | `scans/<id>.png` | `food_log.plate_scan_id` (the same id on every row of the scan) |

Both are served by `GET /sticker/<id>` (public, unguessable id, immutable cache).

## The cutout pipeline (server)

On the server, in the Worker, through the Cloudflare Images binding (`IMAGES`): `segment: "foreground"` (BiRefNet saliency
segmentation), PNG out. Nothing runs on the phone. Code: `packages/api/src/lib/sticker.ts`.

1. `ai.analyzeFood` / `analyzeFoodStream` start `makeWholeCutout` the moment the photo arrives (one segmentation of the whole
   photo, at the photo's width up to 1024), in parallel with the vision call.
2. Each detected box then gets a quick sticker (a crop of that whole cutout) and a refined one (the box segmented on its own);
   the scan response never waits for either (`runScanStickers`, `ai.scanSticker`). They live under `scan-src/stk/<id>.png`
   (bucket lifecycle expires them) until the meal is saved.
3. `food.addScan` promotes the pending stickers to `scans/<id>.png`, or cuts the missing ones from the photo it receives
   (`storeStickers`). Unsaved scans leave nothing behind.

### What the plate sticker adds

- The same whole-photo cutout, which used to be thrown away after cropping, is trimmed to what the segmentation kept
  (`trimPlateCutout`: alpha bounds read from the PNG by `lib/png-bounds.ts`, 3% room, then one `trim` through the Images binding;
  an unreadable PNG or a plate that already fills the frame is kept whole) and parked at `scan-src/stk/<plateScanId>.png`.
  `analyzeFood` returns the id as `plateScanId` and the sticker is viewable at `/sticker/<id>` a few seconds later. No extra
  segmentation, one R2 put and one crop per scan.
- `food.addScan` takes `plateScanId`, promotes it to `scans/<id>.png` (only if the pending object belongs to the caller) and
  writes it to `food_log.plate_scan_id` on every row of the scan. If it is not ready (still cutting, failed, expired) the server
  cuts the plate from the saved photo in the background under a **new** id (`storePlateStickerFromPhoto`); the client's id is never
  reused for a fresh cut.
- Builds that do not send `plateScanId` (older apps) get no plate sticker. Meals scanned before this have none. Both keep today's
  behaviour: the component sticker is the hero.
- Deleting the last row that carries a plate sticker deletes the object; account deletion lists it with the other stickers
  (`purgeUnreferencedMedia`, `userStickerKeys`). Favorites do not carry it: a re-logged favorite uses its component stickers.

## Which sticker a card shows

`mealStickerTarget` (`packages/api/src/lib/meal-sticker.ts`) decides, for the viewer and every share card:

- The scan has a plate sticker: the plate is the hero, with the **plate's** name (the name the user gave it, else "first +N") and
  kcal/macros summed over every row of the scan. Component stickers are not drawn next to it, because they would show the same food
  twice. A component thumbnail in the diary still shows its own cutout; tapping it opens the plate.
- No plate sticker (older meal): the row's own cutout, name and numbers, exactly as before.
- The plate sticker can 404 for a few seconds, or if its cut failed. The viewer then shows `fallbackScanId` (the first component
  cutout), and the share sheet is only given a plate sticker URL once it has loaded (a share sheet whose image fails is disabled).
  The scan-result share card gains `cutoutUri` only after the plate sticker loads.

Engine: `MealStory.cutoutUri` (`packages/sticker/src/rogo/data.ts`) fills the `cutout` slot of `meal.cutout.story` and
`meal.cutout.sticker` while `photoUri` stays the photo behind the photo cards, so a meal with both offers both. It wins over a
`photoCutout` photoUri. Web: `MealStory.scanId` (cutout) and `photoSrc`/`photoId` (photo) were already separate.

The Foto grid opens a row's own cutout when a kind filter is on (the plate's total would include rows the filter hides).

The whole-day share ("Makan sehari", [story-sharing.md](story-sharing.md)) uses the same rule per meal: a scan's plate cutout
stands alone, its component cutouts only when it has none or the plate cutout fails a load check before the sheet opens.

## Barcode meals show the product

A meal logged by barcode (`food.add`, `source: "barcode"`) gets the product's front photo as its sticker, so the diary row, the
portion sheet, the viewer and the share cards show it with no client change (`lib/barcode-image.ts`):

- The image URL is read from our own `barcode_product.image_url` for the barcode in the row's `itemsJson` (never from the client),
  and only `https://*.openfoodfacts.org` is fetched (2 MB, 6 s). OFF now supplies the 400 px front photo (`image_front_url`, the
  small one as fallback). Rows from label photos (`label_photo`) and USDA have no image: a pack photo that someone took is not ours
  to keep or show, unless that person opts in (next section).
- The photo is cut out like a dish (`segment: foreground`, 480 px; if that fails, the plain resized photo). The cutout is made once
  per product (`barcode-img/<code>.png`, shared, not personal data) and **copied** to `scans/<id>.png` for each logged row, because
  a row's sticker is deleted with the row.
- A cutout the client already has (`scanId`, the kept pack photo below) always wins over the product photo.
- Only new logs get one: barcode meals logged before this have no stickers. Open Food Facts images are CC BY-SA; the barcode
  screen keeps linking the source.

## A kept pack photo (opt-in)

In the label flow, once the person has taken the front-of-pack photo, a switch "Pakai foto depan jadi stiker makanan" can keep that
photo as the sticker of the meal they log next. It is **off by default and every time** (not remembered), so "photos are read, then
deleted" stays true for everyone who does not turn it on. The label screen and the privacy pages (id, en, ms) describe both cases.

1. `barcode.readLabel({ ..., front, keepFront: true })` starts `storeKeptFrontSticker` (`lib/barcode-image.ts`) next to the model
   call: the same whole-photo segmentation and trim as a plate (`makeWholeCutout` + `storePendingPlateSticker`), parked at
   `scan-src/stk/<id>.png` with the owner in its metadata, and the id returned as `stickerScanId`. Only the cutout is kept; the
   original front photo and the nutrition-panel photo are never written. A failed read deletes the cutout; a failed cut returns null.
2. The barcode screen (native and web) holds the id until the code is reset and sends it as `scanId` with `food.add`
   (`source: "barcode"`). For a barcode meal the server only accepts a `scanId` that is still a pending cutout of that user
   (`promotePending`, copied to `scans/<id>.png`); an expired or foreign id is dropped and the row falls back to the product photo,
   so a sticker that 404s is never stored. Logging the same product again within the pending window reuses the id (rows share the
   object; deleting one keeps it until the last is gone).
3. Unlogged cutouts expire with the `scan-src/` lifecycle (about 2 days); logged ones live and die with the row like any dish
   sticker (row delete, account delete, "hapus semua data").

Needs no D1 migration (it reuses `food_log.scan_id`) and no native module, plugin or `app.json` change: JS only, so the OTA keeps the
runtimeVersion. The server must be deployed first (old servers ignore `keepFront` and answer no `stickerScanId`, so a new client
would log with no sticker).

## Rollout order

1. `scripts/deploy.sh` runs the D1 migration first (`0061_food_log_plate_scan`, adds the nullable `food_log.plate_scan_id`), then
   deploys the server and the web assets. The migration must precede the new server code: every food query selects the column.
   Old apps keep working (they send no `plateScanId`, so they get none).
2. Native over the air with `scripts/ota.sh "..."`: JS only, no native module, plugin or `app.json` change, so the runtimeVersion
   does not change and no store build is needed.

## Tests

`bun test` in `packages/api` (`png-bounds`, `plate-sticker`, `meal-sticker`, `routers/plate-sticker`) and in `packages/sticker`
(the `meal-plate` fixture). The cutout itself needs the real Images binding; `wrangler dev` with `"remote": true` on the `images`
binding runs it from a scratch worker without deploying anything.
