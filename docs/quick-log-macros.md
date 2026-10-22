# Catat cepat keeps P/K/L

A food logged by name and kcal alone used to be stored with `protein`, `carbs` and `fat` NULL. Every aggregate
(`sum(food_log.protein)` in `day.summary`, rings, recaps, `get_daily_totals`, plates, places) treats NULL as 0 g, so the
day total silently lost the macros.

## Where macros were dropped

| Entry point | Sent | Fixed by |
|---|---|---|
| Recent-food chips (Daftar "Catat cepat" card and the add sheet, native and web) | `{ name, kcal }`: `food.recent` did not return macros | `food.recent` returns grams, protein, carbs, fat, fiber of each name's latest row; the four chips send them (`recentAddFields`) |
| Manual form with the macro fields closed | `{ name, kcal }` | `food.add` estimates the macros (below) |
| A chip of a row that never had macros | `{ name, kcal }` | `food.add` estimates the macros (below) |
| Cerita (typed or spoken), photo scan, barcode, favorites, meal plan | macros included | unchanged |
| JoyoFit (`food.add`, `food.importHistory`) | whatever it sends | `food.add` covers a name + kcal call the same way; `importHistory` stores what it is given (imported rows are not typed names) |

## `food.add` without macros

Only for `source = "manual"` or `"copy"` (the recent-food chips and a story copy log as `copy`) with protein, carbs and fat all
absent and `kcal > 0` (`lib/macro-estimate.ts`). Photo and barcode rows keep what they carry; a typed value, even `0`, is never
replaced, and a row that carries any macro keeps exactly that. Fibre comes with the estimate (table row, or the parse when every
item has it) unless the caller sent one.

1. The TKPI 2019 per-100 g row the name names (`libraryMacros` in `lib/tkpi.ts`; quantity and a typed "350 kcal" are stripped
   first), scaled to the kcal that was entered. Combinations ("nasi goreng telur") and condimented dishes are skipped.
2. Otherwise the Cerita text parse (`parseFoodStory`) on the name, its items summed and scaled to the entered kcal. Not used when
   the parse's energy is more than 4x off the typed kcal, when the model is unavailable or slower than 7 s, or after
   `MACRO_AI_PER_DAY` (40) parses that day. Every call that reached the model writes an `ai_usage` row, `scan_type = "macros"`:
   its own ledger, never the daily scan quota.
3. Otherwise the row is saved with NULL macros. The product has no default P/K/L split from kcal, so none is invented.

The logged kcal is never changed by the estimate.

## Rows without macros

A row with protein, carbs and fat all NULL (and kcal > 0) shows "Makro belum diisi · ketuk untuk isi" in the diary. Tapping it
opens the portion sheet, which then has P/K/L fields; what is typed is stored as typed (`food.update`).

## Backfill

`scripts/backfill-quick-log-macros.ts` (dry run by default, `--apply` writes): for manual, copy and ai rows with kcal > 0 and no
macros it uses the person's own latest row of the same name that has macros, else the TKPI table, scaled to the row's kcal. It does not
call the model; rows it cannot resolve stay NULL and show the marker above.

A second pass fills fibre only, for manual/copy rows that carry macros but no fibre (own latest row of the same name, else the table).
See `food-log-writers-audit.md` for the other writers.
