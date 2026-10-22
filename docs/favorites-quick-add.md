# Favorit and Catat cepat

Favorit (`saved_food`) is a frozen copy of one diary row or one plate, re-logged in one tap. The table had **0 rows in production** (2026-10-22) although the feature worked end to end (`saved-food.test.ts`). The cause was discoverability, not a bug: the only way to create one was the star button at the bottom of an already-open edit sheet (`SheetActions`), and the Favorit chips, the manage sheet and every hint hid while the list was empty, so nobody saw that favorites existed.

## Where users meet it now

1. **Offer after the third log.** `savedFood.offer` finds the food or combo logged 3 or more times in the last 14 days that is not already a favorite and was not offered before; Daftar shows it inside the Catat cepat card: "Sering kamu catat: {name} sudah 3 kali dalam 14 hari. Simpan sebagai favorit | Nanti". Simpan stars it (`savedFood.save`), Nanti (`savedFood.dismissOffer`) stores a mark; neither shows that habit again. One habit at a time, the most frequent first.
   - A *food* = the same normalised name (`habitKey`); a *combo* = the rows of one plate (same `plate_id`, 2 or more rows) with the same set of names, sorted. A plate with one row is that food. Kcal does not matter (putih telur 50/52/104 is one habit); the favorite is saved from the newest log, so its numbers are the ones the user last accepted.
   - Skipped: habits already a favorite (any favorite whose foods have the same names), zero-kcal habits (water), `huawei` imports. Rule in `lib/favorite-offer.ts`, window 14 days (`OFFER_WINDOW_DAYS`), threshold 3 (`OFFER_MIN_LOGS`).
   - The clients re-ask when the day's row count changes.
2. **Atur button in the Catat cepat header**, always visible (native and web), plus an empty-state line under the three actions while there are no favorites.
3. The star in the edit sheet of a row or plate stays.

## Atur Catat cepat (the editable quick choices)

The chips of Catat cepat are the favorites (first, in the user's own order) and "Terakhir dicatat" (automatic). The Atur sheet edits both:

| Action | Where | Server |
|---|---|---|
| Reorder (up / down) | favorites | `savedFood.reorder({ ids })` writes `saved_food.sort_order`; `savedFood.list` sorts by it (nulls last, then newest used) |
| Edit name and kcal | favorites | `savedFood.update({ id, name?, kcal? })`: a new total kcal scales every component's kcal and macros by the same ratio (weights stay, `macrosForTypedKcal`); the star key follows the new kcal; a clash with another favorite is a `CONFLICT` |
| Remove (undo for a few seconds) | favorites | `savedFood.remove` |
| Add by hand (name, kcal) | favorites | `savedFood.create`: macros from the name like any typed log (TKPI row, else the Cerita text parse; unknown stays null), appended at the end of the user's order, at most 100 favorites |
| Save a recent food as a favorite | recent | `savedFood.save({ foodId })` (keeps the sticker and macros) |
| Hide a recent food / show hidden again | recent | `food.hideRecent({ name })` / `food.restoreRecent()`; `food.recent` leaves hidden names and foods that are already a one-food favorite out, and returns `hiddenCount` |

`food.recent` also returns the row `id` now (needed to save a recent as a favorite).

## Storage

Migration `0062_saved_food_quick_choices`: `saved_food.sort_order integer` (null = never reordered) and table `food_quick_mark (user_id, kind, key, created_at)`, primary key `(user_id, kind, key)`, `kind` = `recent_hidden` (key = normalised name) or `favorite_offered` (key = habit key). Deleted with the account (`lib/privacy.ts`; also `ON DELETE CASCADE`).

## Clients

`useFavorites()` (`apps/native/components/favorit.tsx`, `apps/web/src/components/favorit.tsx`) exposes the list, `recent`, `hiddenCount`, `offer` and the actions above on the shared optimistic helpers. `FavoritOffer` renders the offer, `FavoritManageSheet` the Atur sheet, `QuickAdd` / `QuickAddCard` the header button. Both old and new builds keep working: the new fields are additive and `savedFood.rename` stays for older builds.
