# Porsi kebiasaanmu (portion prior)

After the photo model answers, an item can carry a second portion beside its own number: the user's **usual grams** or, for plain rice, the **typical eaten grams**. The model's own number never leaves the item; one tap swaps the two ("AI: 150 g" / "Biasanya kamu: 100 g", or "AI: 150 g" / "Biasanya: 100 g"). Why: the model answers about 150 g of rice nearly every time (27 of 64 saved AI rice rows, 9 of 10 external runs) where a weighed eater takes about 100 g (`docs/ai-accuracy-log.md`, 2026-10-20 and 2026-10-21). A post-hoc chip, never a prompt change.

## Who gets it

Everyone. No flag (the `PORTION_PRIOR_USER_IDS` allowlist of the prototype is gone): the user's last 60 days of `manual` and `ai` diary rows with grams are read beside the model call (one query, newest 1500 rows; a failed read is "no history", never a failed scan).

| Path | Applies |
|---|---|
| `ai.analyzeFood`, `analyzeFoodStream` (the `done` event; the live rows of the stream are provisional and show the model's own number until it arrives) | yes, chip |
| `ai.analyzeFoodRetry` ("Hitung ulang"; a count in the hint scales the usual grams per piece) | yes, chip |
| Cerita (`ai.describeFood`), items not copied from the log | only when the item starts at the usual grams (no chip to tap: the row shows "porsi kebiasaanmu · AI hitung 50 g", `makan:story.usualPortion`, until the kcal is edited) |
| Barcode, copies, kitchen-scale readings, hidden cups, `ai.correctScan` | no |

## Tiers (`packages/api/src/lib/portion-prior.ts`)

1. **Agreeing weights, starts at the usual grams.** At least `PRIOR_TIGHT_ENTRIES` = 2 of the newest user-set weights (per piece) within `PRIOR_AGREE` = 15% of one value and more than half of the weights considered: the item starts at their median, the model's number is on the chip (`active: "prior"`, `source: "you"`). One odd save among agreeing ones (a 200 g for two pieces, a bad day) does not hide the habit; half and half is no habit. Big-plate guard: when the model answers more than 1.4 times the usual grams (`PRIOR_BIG_PLATE`) its number stays and the usual grams are offered on the chip instead.
2. **Looser history.** No agreeing cluster, but a coefficient of variation (stdev / mean) up to 25% (`PRIOR_MAX_CV`): with at least `PRIOR_MIN_ENTRIES` = 3 entries the item starts at the median; with 2 (`PRIOR_SUGGEST_ENTRIES`) the model's number stays and the median is on the chip (`active: "ai"`, `source: "you"`).
3. **Typical portion, offered, plain rice only.** No history for that food and the model answered at least 1.2 times `TYPICAL_PORTIONS.nasi` = 100 g: the model's number stays, 100 g is on the chip (`active: "ai"`, `source: "typical"`, `n: 0`). Only plain rice has a typical portion: it is the one food the model answers a near-fixed number for, and the one with weighed evidence (a single contributor; hence a chip, never a default).

Model and usual within 3% of each other: no chip. Items without grams, hidden cups and kitchen-scale readings are left alone.

**History** = `food_log` rows of the last 60 days with grams, only grams the user set: `source = manual` rows (meal-planner rows excluded), and `source = ai` rows whose grams differ from the AI answer kept in `items_json` for the same dish. Unedited AI rows, Cerita rows (no `items_json`), copies and barcode rows never count, or the prior would echo the model. Only the newest `PRIOR_RECENT_ENTRIES` = 12 user-set weights of a food count, so an old habit does not outvote a new one for two months.

**Food key** (`priorFood` in `portion-prior.ts`): the name without brackets and cooking-state words (rebus, kukus, polos, plain, segar, boiled, steamed), then `canonicalFood` in `tkpi.ts`: every plain rice (nasi putih, uduk, kuning, liwet, merah, hangat, ...) is `nasi`; an exact library dish or alias is that dish ("putih telur" and "putih telur rebus" are one); anything else its own normalized name. Goreng, dadar and the like stay separate foods.

**Per piece.** A saved weight is divided by the pieces the row held (the AI entry's `pieces.count`, else the number its `portion` text starts with: "2 plastik kecil" is 2; a weight or volume like "200 ml" is no count), and the usual grams are per piece. At scan time they are multiplied by the pieces on the photo: 200 g saved for the model's "2 plastik kecil" and 100 g saved for "1 buah" are one usual of 100 g a piece, and a photo of 3 pieces starts at 300 g. The typical rice portion scales the same way. Known blind spot: a weight saved after stepping the `Jumlah` count is divided by the AI's count, because `items_json` keeps the AI's list, not the stepped one.

**Numbers**: kcal and macros scale by chip grams / model grams, then pass through `calibrateItems` (library or TKPI 2019 band scaled to the grams, density cap). `portion` text is dropped for the usual side and restored for the model side.

### Where the thresholds come from

- Production diary, last 60 days (2026-10-21, counts only): 796 rows with grams from 46 users; 10 users have any user-set weight, none has 5 for one food (one has 4, with identical typed weights), and plain rice has 5 user-set weights from 5 different users. A 5-entry gate would have switched the feature on for nobody.
- The one weighed contributor's rice plates (86, 100, 100, 100, 125, 125, 150 g): the median of any 2 / 3 / 4 / 5 other plates misses a held-out plate by 22.8 / 21.3 / 21.3 / 23.4 g on average, against 37.7 g for the model's flat 150 g. So 3 entries are as good as 5 and 2 already beat the model. First shipped as "3 start at the usual grams, 2 only offer it"; weights that agree within 15% now start from 2 (below), a looser spread keeps that rule. One eater is thin evidence; the tap undoes any of it.
- Harness (`--variant portion-prior-min5` vs `portion-prior`): no difference in either set (no case sits at 3 or 4 entries), so the choice rests on the two bullets above. The harness's history is not time-ordered, so its "newest 12" and the agreeing-cluster tie-break are arbitrary there.
- The 2-entry start for agreeing weights (2026-10-22) rests on the second bullet (2 entries already beat the model) and on the owner's egg whites, below.

### The owner's putih telur (2026-10-22)

The model answered 50 g for a boiled egg white every time, the owner saved 100 g every time (`scan_correction`: ai 50 g, saved 52 kcal), and the next scan said 50 g again. Production diary, his food rows named putih telur, oldest first: 100 g (model 100), 100 (50), 100 (60), 100 (100), 200 (model "2 plastik kecil", 100), then 100 (50) three times. Why the usual portion never applied: `canonicalFood` already joins "Putih Telur" and "putih telur rebus", the rows are `ai` rows whose grams differ from `items_json` (so they count), and the model always gave grams. What failed was the gate: the 200 g saved for two pieces made the history 200, 100, 100, ... with a coefficient of variation of 32-35% against the 25% limit, so there was no prior at all (before that, two agreeing entries only produced a chip, and the model's 100 g matched it). Fixed by the per-piece weight (200 g for 2 is 100 g a piece), the agreeing-cluster gate that starts from 2 entries, and by applying the prior in the retry and Cerita paths. Replayed against his real rows in `lib/portion-prior-owner.test.ts` (fixture `lib/fixtures/owner-putih-telur.json`) and through every path in `routers/portion-prior-paths.test.ts`.

## Response and clients

An item with a chip carries `portionPrior: { active: "prior" | "ai", other: { grams, kcal, protein?, carbs?, fat?, fiber?, portion? }, n, source? }`; the item's own numbers are the `active` side. `portion-chip.ts` (`swapPortionPrior`, `chipGrams`, `modelNumbers`, `withoutPortionPrior`, `priorLabelKey`) is shared by `apps/web` (`components/scan/portion-prior-chips.tsx`) and `apps/native` (same name). `source: "typical"` shows `scan:result.items.priorTypical` ("Biasanya: 100 g"); a missing `source` is the user's own (`priorUsual`). The chip renders only when the server sent `portionPrior`.

What stays true to the model's answer: the `ai_usage` ledger row (`aiItems`) and the owner dataset keep the model's numbers; the miss log (`ai.logCorrections`) sends the model's grams and kcal (`modelNumbers`); `items_json` of the saved rows carries the displayed list without the chip, so a row saved as shown is not read as an edit. Consequence: accepting the usual or typical portion never adds to the history; only typed or edited weights do (rows age out after 60 days).

## Eval

`bun run scripts/eval-scans.ts --only external --only owner --reps 2 --variant baseline --variant portion-prior-v1 --variant portion-prior --variant portion-prior-min5 --variant portion-prior-tap --variant typical-tap`. History per case = the same person's other cases (leave-one-out). `portion-prior-v1` = the prototype's gate (5 entries, no chips for the rest), `portion-prior-tap` = every offered chip tapped, `typical-tap` = nobody has a history and everyone taps the typical chip (the numbers of a global 100 g rice default). The report has a "Portion chips" table (chips shown and tapped per variant). Numbers in the accuracy log (2026-10-21).
