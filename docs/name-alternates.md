# "Mungkin juga": nama hidangan lain di hasil scan (name alternates)

Why: of 232 saved photo scans (10-17..10-27) 51% were corrected and 80% of the kcal that moved came from the *dish*
(renamed 54, removed 45, added 36 items), 16% from grams (the portion-accuracy analysis of 2026-10-27). The
scan now also says which other dishes an item could be. Under the row: **"Mungkin juga:" [Nasi uduk] [Nasi liwet]**.
One tap renames the row; grams, kcal and macros come from the rename path of the Koreksi box, no new estimation.

## How it works

1. **Prompt** (`visionPrompt`, `lib/vision.ts`): `ALT_SHAPE` = `,"alt":["nama lain","nama lain"]` as the *last* key of the
   item (after `box`), and `ALT_RULE` (up to 2 other dishes, only when unsure; Indonesian like `name`). Last on purpose:
   a cut-off or garbled tail costs only the chips, and the scale readout once broke the item's keys when it was added to
   the scan answer (`docs/scale-readout.md`). `alt-first` (right after `name`) was tried and was not better.
2. **Parsing** (`lib/name-alternates.ts`, `lib/vision.ts`, `lib/item-stream.ts`): `alt` is `z.unknown()` in the item
   schema, so a bad `alt` never rejects an item. `normalizeAlternates` trims, cuts at 80 characters, drops the item's own
   name (any spelling), a broader name for the same item ("nasi" for "nasi putih"), repeats and non-text, keeps at most 2;
   a lone string `a | b` is two names. `lenientItem` (the salvage path for garbled or cut-off items) reads a *complete*
   `alt` array and nothing else of it; `alt` is a known key for the garbled-key repair (`ANY_KEY`).
   `withMaterialAlternates` takes the chips off rows under 15% of the plate's kcal (a cracker, a spoon of sambal): the
   model put alternates on 83-95% of all items, the useful ones were on rows with 24% or more of the plate.
   A hidden cup (`cup`) has none (its own drink/size chips). No `alt` key at all when there is nothing to offer.
3. **Tap** (web `components/scan/alternate-chips.tsx`, native `components/scan/alternate-chips.tsx`): `ai.correctScan`
   with `text: "bukan <name>, <alternate>"` (the same call `MemoryChips` makes) plus `altTap: {from, to}`. The screen
   applies the patch with undo, like any correction. `carryAlternates` puts `alt` back on the rows the correction left
   alone (the server echoes none), and gives the renamed row the name it replaced plus the other alternate, so a second tap
   goes back. A tap uses a correction like the Koreksi box (10 per scan, 60 per day, no scan quota).

## Ledger (count it from prod)

- Scan row (`ai_usage.usage_json`): `aiItems[].a` = the alternates shown for that item. Chip share =
  scans where `json_extract(usage_json, '$.aiItems') like '%"a":[%'`.
- Scan row: `altTaps` = `[{f: name it replaced, t: alternate}]`, one entry per tap that succeeded (`corrections` counts
  them too, so a scan with only chip taps still saves as "corrected").
- Correction row (`scan_type = 'correction'`): `altTap: {from, to}`, `outcome` (`ok` or the failure), so failed taps are
  visible too.
- Hit: a scan whose `savedItems[].n` contains an `altTaps[].t`. Taps per chips shown = `json_array_length(altTaps)` over
  scans with `aiItems[].a`. [Not yet measured in prod.]

## Eval (2026-10-27, `bun run scripts/eval-scans.ts --wrongfood --variant no-alt --variant baseline --variant alt-first --variant alt-strict --reps 4`)

`no-alt` = the prompt before this change (checked identical to the old `visionPrompt()`), `baseline` = shipped. Cases:
owner 46, feedback 6, external 8, wrong-food 12 (private photos, `.tmp/dataset`), 4 reps each, Workers AI REST, model
`@cf/google/gemma-4-26b-a4b-it`. 1,152 runs and about 1,150 model calls, about $0.30 at about 24 neurons per call and
$0.011 per 1,000 neurons (the re-scoring after the 15% rule and the name filter replayed the raw answers: 0 calls).

| 48 runs per variant on the wrong-food set | no-alt | baseline (shipped) | alt-first | alt-strict |
|---|---|---|---|---|
| true dish named by `name` (of 60 checks) | 25 (42%) | 24 (40%) | 23 (38%) | 19 (32%) |
| true dish in `name` or `alt` | - | **32 (53%)** | 29 (48%) | 30 (50%) |
| items with chips / chips per item | - | 52% / 0.83 | 51% / 0.80 | 61% / 0.91 |

| All 288 runs (4 sets) | no-alt | baseline |
|---|---|---|
| failed (not_food 18+4, unclear 1) | 23 | 18 |
| needed a second attempt | 0 | 0 |
| JSON needed key repair or item salvage | 36 (12.5%) | 50 (17.4%) |

Read it as: the parse-failure rate did not rise (hard failures are the same photos that are "not food" with or without
the chips; no run needed a second attempt; 6 of the 1,105 items written next to an `alt` were lost, in 2 answers). The share of answers that needed repair rose 4.9 points; the repair is
the existing garbled-key repair (`"portion","grams"` and similar, present without `alt` in 12.5%), not `alt` itself,
but longer items garble a bit more often. Thin evidence on the hit rate: 8 of the 8 hits that only the alternates gave
come from one photo (nasi liwet, ayam bakar), i.e. 1 of 12 photos at 4 reps; the first-answer name rate did not move
(42% -> 40%, noise). `alt-strict` (a prompt asking for alternates on doubtful items only) did not make the model more
selective (61% of items still had chips) and lowered the name hit rate, so it was not shipped.

## Not done

- No threshold on `confidence`: it is 0.9 or 1.0 on 94% of items and carries no information.
- Chips are Indonesian names (like `name`); an English reader sees `Nasi uduk` as the dish name, as on the row itself
  when it has no `localName`.

## Screenshot

`docs/img/mungkin-juga-chips.png`: web on a local stack (dev login, remote Workers AI), the public photo "Nasi Kuning Daun
Pisang.jpg" (Supardisahabu, Wikimedia Commons, CC BY-SA 4.0). Left: the scan's row with its two chips (the small rows,
sambal, shallots and floss, have none). Right: after tapping "Nasi uduk": the row is renamed (330 -> 285 kcal), badged
"Diganti"/"Renamed", and offers "Nasi Kuning" (the name it replaced) and "Nasi liwet".
