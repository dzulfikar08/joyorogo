# Timbangan: baca angka dari layar (scale readout)

When a food photo shows a kitchen scale's display, a second, tiny vision call reads the digits and those grams replace the model's guess on the item that was weighed. The scan shows **"Terbaca dari timbangan: 100 g"** under the row, with the photo estimate one tap away ("Perkiraan foto: 150 g"). Why: grams-from-photo is the weak point of the scan (`docs/ai-accuracy-log.md`, 2026-10-20: rice guessed at ~150 g where 100 g was eaten); a display is the one place the photo carries the exact number.

## Flag

`SCALE_READOUT_USER_IDS`: comma-separated user ids (a Worker var in `apps/server/wrangler.jsonc`, like `PORTION_PRIOR_USER_IDS`; owner only today). Unset, empty or any other user: no second call is made and `ai.analyzeFood` / `analyzeFoodStream` / `analyzeFoodRetry` return exactly what they returned before (no `scaleRead` key on any item). To switch on for QA add the user id to the var and deploy; to switch off remove it.

## How it works (`packages/api/src/lib/scale-reading.ts`)

1. **A separate call, beside the scan** (`readScaleDisplay`): same model, same photo, `SCALE_PROMPT`, temperature 0, answers `{"scale":null}` (about 6 tokens) or `{"scale":{"reading","unit","confidence","appliesTo"}}`. It starts together with the scan and is awaited after it, so latency is the scan's; a failure or a 12 s timeout is a scan with no reading, never a failed scan. One retry on an unparseable answer.
2. **The model only transcribes.** `reading` is the digits as shown ("100", "3.5", "1,25"); `unit` is g, kg, oz, lb, ml or fl oz; code does the rest: either decimal mark, units to grams (oz 28.3495, lb 453.592, kg 1000, ml read 1:1 like the drink rule), a grams display with three decimals ("1.250", thousands or decimal?) rejected as ambiguous.
3. **Gates** (`applyScaleReading`), a reading is set aside, never half-used, when: confidence < 0.75 (`SCALE_MIN_CONFIDENCE`); the display is 0 / 0.0 (tare, empty); digits do not parse; grams fall outside 1-5000; it names no item (several items) or only items without a weight; the total is more than 10 times away from the model's own total (`SCALE_MAX_RATIO`: a missed decimal point, not a weight).
4. **Where the grams land.** `appliesTo` = an item name (or several, `|`-separated): that item gets the grams (several: shared in the model's proportions, adding up exactly). `plate` (or no name): every food item shares the total in the model's proportions; drinks only when nothing else is there. A name that matches nothing covers the photo's only item, never one of several. Hidden cups are never covered.
5. **Numbers follow** through `item-grams.ts` (shared with "Porsi kebiasaanmu"): kcal and macros scale with grams, then calibration (library or TKPI band scaled to the grams, density cap). A scale-read item skips the portion prior.

## Response and clients

An item with a reading carries `scaleRead: { active: "scale" | "ai", other: {grams, kcal, ...}, text, unit, grams, count }`; the item's own numbers are the `active` side (`grams` = the whole reading in grams, `count` = rows it was shared over). `scale-chip.ts` (`swapScaleRead`, `scaleValue`, `scaleGrams`, `withoutScaleRead`) is shared by `apps/web` (`components/scan/scale-read-chips.tsx`) and `apps/native` (same name): one chip "Terbaca dari timbangan: 100 g" (or "3.5 oz (99 g)", or "..., dibagi ke 3 item") and one "Perkiraan foto: 150 g"; tapping the other puts its numbers on the row. Any other grams fix goes through the correction box as before. "Setengah porsi" drops the chip.

The ledger row (`ai_usage.usage_json`) keeps `aiItems` as the user saw them and gains `scale`: the reading, what became of it (`applied` item indexes, `before` = the model's own grams for them, or `skipped` + reason) and the call's cost (`ms`, `usage`, `error`). `items_json` of a saved row carries the displayed list without the chip.

## Why not a rule inside the scan prompt

Tried first (the scale rule appended to the scan prompt, `scaleReading` after `items`). It read the digits right, but on the egg-on-a-scale photo the model dropped the keys of its item list in 8 of 15 runs (`"name":"telur ayam","makanan","satu butir","61",...`: unparseable, 0 of 15 for the baseline prompt on the same photo; the harness replays the identical retry request from its cache, production would re-sample). A second call leaves the scan's own request and answer untouched. It costs about 507 prompt tokens and 6 completion tokens when there is no display (about 4.5 neurons against 13 for the scan, measured on 101 calls), so before this goes beyond the allowlist decide whether a 35% higher scan cost is acceptable or gate the call.

## Eval

`bun run scripts/eval-scans.ts --scale-photos --variant baseline --variant scale-readout --reps 2`. The `scale-readout` variant runs the baseline scan request (its answer is replayed, so the comparison is paired exactly) plus the scale call, then `applyScaleReading`. The report's "Scale readout" section counts false reads (a reading on a photo with no display), digits exact and the grams error before and after on photos with a display. A photo shows a display when `scale.json` sits beside it (`{"reading":"100","unit":"g","appliesTo":"plate"}` or `"appliesTo":["nasi putih"]`, written by hand after looking at the photo; under `.tmp/dataset/...`, never committed); a photo without the file is taken to show none. `--scale-photos` adds three public Wikimedia Commons photos of a scale display (flour bag on a Scaleman, egg on a glass scale, tomato on a B05 scale; the display is the only truth) because no dataset photo has a display; they are downloaded to `.tmp/eval/scale` and run only for the read-accuracy and gram checks. Numbers in `docs/ai-accuracy-log.md`.
