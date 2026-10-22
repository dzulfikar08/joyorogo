# Seperti biasanya (usual kcal per gram)

The model answers a different number for the same dish on different days (putih telur 50, 52, 104 kcal; ayam goreng 2.3 to 2.6 kcal per gram). A user who logged that food before already has a number for it. After the model answers, an item whose name matches one of the user's own logged rows takes that row's **kcal per gram** at the item's own grams. Post-hoc only, never a prompt change; the user can edit the row as always.

Sits beside "Porsi kebiasaanmu" (`portion-prior.md`, which is about grams); this one is about kcal per gram. Both can apply to one item: the density first (on the model's grams), then the portion prior scales the numbers to the usual grams.

## Who gets it

Everyone, no flag. Read once beside the model call: the user's last 120 days of `food_log` rows (any source except `huawei`, newest 1500, `lib/usual-density-store.ts`). A failed read is "no history", never a failed scan.

| Path | Applies |
|---|---|
| `ai.analyzeFood`, `analyzeFoodStream` (`done` event), `analyzeFoodRetry` | yes |
| Cerita (`ai.describeFood`) items that are not copied from the log | yes |
| Recent-food chips and favorites | already repeat the last row exactly (same grams, same kcal) |
| Barcode, kitchen-scale readings, hidden cups, `ai.correctScan` | no |

## Rule (`packages/api/src/lib/usual-density.ts`)

- **Match**: the same normalised name (`normalizeFoodName`: lower case, no diacritics or punctuation). "nasi goreng" never borrows from "nasi putih"; "White rice" does not match "nasi putih".
- **Which row**: the newest row of that name with grams above 0 and kcal above 0. "Last", not an average: the number the user last accepted is the one they see again. Ties between rows written in the same millisecond go to the later insert (rowid).
- **Number**: `round(kcal per gram of that row x item grams)`. Protein, carbs and fat follow that row's own per-gram values when it has all three; otherwise the model's macros scale by the kcal ratio. Fibre follows the row's when known, else the ratio. Nothing is invented: a macro neither side has stays absent.
- **Guards**: no change within 2% of the model's number; none when the usual density is more than 2x or less than 0.5x the model's (another dish with the same name); none without grams, with a hidden cup, or for kitchen-scale readings.

## What the user sees

The item carries `usualDensity: { modelKcal, n }` (`n` = rows of that food in the window). Clients show one muted line under the item: "Seperti biasanya, dari catatanmu · AI hitung 231 kkal" (`scan:result.items.usual`; Cerita: `makan:story.usual`). The line goes away when the user edits the kcal, halves the portion or swaps the portion chip (the model's number would no longer match the row). The kcal field is the normal editable one.

## What stays true to the model

- The owner dataset (`recordScan`, `recordRetry`) keeps the model's own numbers.
- The `ai_usage` session ledger (`aiItems`, `retryItems`) keeps **what the user was shown**, like the kitchen-scale readout: a row saved as shown is "accurate", not a kcal "correction" (otherwise every repeat food would count as the user fixing the AI and pollute `scan_correction` and the correction memory). `usualDensity.modelKcal` on the response is the only place the model's number for that item lives after the scan.
- `items_json` of saved rows carries the displayed list without the note (`withoutPortionPrior` strips `usualDensity` too); `swapPortionPrior` drops it.

## Tests

`lib/usual-density.test.ts` (rule), `routers/usual-density.test.ts` (scan end to end, ledger keeps the shown number), `routers/portion-prior.test.ts` (history rows use a consistent density so nothing changes there).
