# Barcode database: lookup order and the label-photo flow

Why: Open Food Facts (OFF) has no calories for 41 % of the popular Indonesian (GS1 899) snacks we tested and no entry at all for 14 % ([evaluation](barcode-sources.md)). No other free source covers them, so the biggest lever is our own database, fed by users photographing the "INFORMASI NILAI GIZI" panel.

## Lookup order

`barcode.lookup` (`packages/api/src/lib/barcode-lookup.ts`, `lookupBarcode`):

1. **Our rows.** `barcode_product.source = 'label_photo'` rows are served as is and never expire or get overwritten by a source refresh.
2. **External sources**, in the order of `lib/barcode-sources.ts`: Open Food Facts, then USDA FoodData Central (only when the Worker secret `USDA_FDC_API_KEY` is set; fallback for US-labelled products). The first source with a *complete* product (name + plausible kcal) wins; a name without calories is kept as the fallback while later sources are asked.
3. **Not found / incomplete** -> the clients offer "Foto label gizinya".

Caching, one D1 row per code:

| Row | TTL | Notes |
| --- | --- | --- |
| complete product from a source | 30 d | refetched after; a product no source confirms any more is kept |
| name without usable numbers ("incomplete") | 3 d | retried sooner: someone may add numbers or photograph the label |
| miss (`not_found`) | 3 d | `sources_checked` lists who said no; a source added later is asked alone about fresh misses |
| label_photo | never | replaced only by the consensus of newer submissions |

Outages (network, 429, 5xx) are never cached as misses. A *critical* source (OFF) being down with nobody else answering makes the lookup fail with `SERVICE_UNAVAILABLE` (the client offers retry, label photo and manual entry); a stale cached product is served instead when one exists. An optional source being down is skipped and asked again next time.

OFF's documented read limit is 15 requests/minute per IP and Worker egress IPs are shared, so a burst can get 429s; they surface as outages, not misses. If it ever bites, the planned fix is a nightly mirror of the `code:899*` slice of the OFF dump (see barcode-sources.md section 5).

## Label photo flow

1. Not found / incomplete / lookup failed: primary button "Foto label gizinya". Panel photo is required, pack front optional (name/brand/net content).
2. Clients downscale to 1280 px JPEG and call `barcode.readLabel`. The server sends the photos to the vision model (`AI_VISION_MODEL`, temperature 0, no thinking) with two prompts that copy printed numbers and never estimate; photos exist only inside that request and are never stored, logged or kept. The ledger row (`ai_usage.scan_type = 'label'`) records timing and token usage only. Free of the daily scan quota, capped at 12 reads per user per WIB day (failures count: each costs a model call).
3. The answer becomes an editable draft: serving size, `perServing` and/or `per100` columns (kJ-only energy is converted), name/brand/quantity from the front. The form shows the per-serving numbers when a serving size is known (what the pack prints in bold), otherwise per 100; the user can flip "Angka di label per" without numbers being converted.
4. `barcode.contribute` converts to per 100 g/ml (`value x 100 / servingSize`, one decimal) and refuses numbers that cannot be true: more than 950 kcal or more than 105 g of macros per 100 g (`isImplausible`, shared with lookup data), and an energy that disagrees with 4/4/9 x protein/carbs/fat by more than 40 % + 20 kcal (kJ typed as kcal, per-serving energy beside per-100 macros). The energy check can be overridden by the user once ("Sudah sesuai label, simpan"); implausible numbers never.
5. "Terima kasih, sekarang semua pengguna JoyoRogo bisa scan produk ini." The saved product is written to the lookup cache of the client and shown ready to log.

Known limit: very small servings (below about 10 g, e.g. sachets) amplify label rounding when scaled to 100 g and can trip the plausibility check; the user can switch the form to "per 100" when the panel has that column.

## Trust

`barcode_contribution` keeps each user's newest submission per code (per-100 values, no photo). The product row is the consensus of those (`lib/barcode-trust.ts`):

- Two submissions *agree* when kcal is within 10 % (or 8 kcal) and each known macro within 15 % (or 1.5-2 g); unknown nutrients never disagree.
- The submission with the most agreeing others wins, `contributors` = size of that group; ties go to the newest. So a second user who disagrees overrides a lone first submission, a third settles it, and one outlier cannot override a confirmed product.
- "Cocok" on a community product (`barcode.confirm`) adds the caller's agreeing submission; "Ada yang beda" opens the label flow and submits a competing one. A user resubmitting replaces their own row; they cannot confirm themselves.
- Limits: 30 contributed products per user per WIB day; names are cleaned (no links, markup, control characters; 2-120 chars); a product a source already knows completely cannot be overwritten (`already_known`).
- Account deletion and "hapus semua data" cut the `user_id` link (`ON DELETE SET NULL`, and an explicit update in `deleteAllUserData`): values stay, they stop counting as a person.

## Data model (migration `0035_barcode_community`)

- `barcode_product`: + `source` (default `'off'`), `contributors`, `sources_checked`, `sugar_100`. Existing misses are backfilled to `sources_checked = 'off'`.
- `barcode_contribution` (new): unique `(code, user_id)`, per-100 values, serving size, timestamps.
- `ai_usage.scan_type` gains `'label'` (TypeScript enum only, no SQL change).

Sugar is stored and shown but not logged (the diary has no sugar column).

## Open Food Facts write-back: not built

OFF allows apps to submit through a shared app account, but needs an account the owner must create, an API usage form, per-submission opt-in (contributions become irrevocably public under DbCL / CC-BY-SA) and the label **photo** as proof, which contradicts "the photo is deleted after reading". Skipped until the owner decides; owner steps are in barcode-sources.md section 5-6.

## Tests

`packages/api/src/lib/barcode-label.test.ts` (parsing of model answers incl. quoted numbers, comma decimals, kJ, both columns, refusals; model call with a mocked AI), `barcode-lookup.test.ts` (lookup order, per-source miss caching, outages, stale rows, contributions, consensus, limits), `barcode-trust.test.ts`, `barcode-migration.test.ts`, `routers/barcode.test.ts` (readLabel/contribute/confirm over an in-memory D1).
