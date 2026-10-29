# Piring saya (registered plates and bowls) and the card reference

Grams from a photo are the weak point of the scan (docs/ai-accuracy-log.md, 2026-10-20: about 150 g of rice guessed where 100 g was eaten). A photo has no scale. "Piring saya" gives it one: the user registers the plates and bowls they eat from every day, once, with the diameter they measured, and every scan then knows how big the plate is.

**Off for users, on for the owner/QA**: everything below sits behind the `DISHWARE_USER_IDS` allowlist (comma-separated user ids, `apps/server/wrangler.jsonc`, typed in `apps/server/.env.schema`). Unset or empty = nobody: the screen is hidden (`dishware.status().enabled` is false), the router refuses every other procedure with FORBIDDEN, and `analyzeFood` is called exactly as before (no extra prompt text, no `plate` field in the result). Going wide = adding ids, or changing `dishwareEnabled` in `lib/dishware-store.ts`.

## What the user does

Profil > Makan > "Piring saya" (web and native, same copy `settings:dishware.*`):

1. "Tambah piring/mangkuk": a photo of the empty plate or bowl from straight above (camera or gallery, resized to 1024 px like scan photos).
2. A name ("Piring makan putih"), a type (piring datar, mangkuk, piring rotan, kotak makan), and the diameter in cm. For a kotak makan: length and width. The helper under the field: "Ukur pakai penggaris, atau taruh kartu ATM di sampingnya."
3. Optional "Ukur dari kartu ATM": with a bank card lying flat beside the plate in the photo, the model reads how many card-lengths wide the plate is (ISO ID-1 card, 85.6 x 54 mm) and the app fills the diameter with that estimate and says so ("Perkiraan dari kartu: 24 cm. Cek dengan penggaris kalau bisa"). The user can change the number; it is stored as `diameter_source = card` only while they leave the estimate alone. A card that is not visible or not believable (plate under 5 or over 60 cm) gives no estimate, never a guess.

Up to 6 plates per user (`MAX_DISHWARE`): each one costs about 50 prompt tokens on every scan.

## What the scan does

`lib/dishware.ts` builds a text block from the user's plates and `analyzeFoodPhoto` appends it to the prompt (option `dishware`). No thumbnails are sent: at registration the model wrote one short description of how the plate looks (colour, rim, pattern, material), and that text is what a photo is matched against.

```
Piring dan mangkuk milik pengguna ini (ukurannya sudah diukur sendiri olehnya):
P1: "Piring makan putih", piring datar, diameter 24 cm. Ciri: putih polos, tepi bergelombang, keramik
P2: "Mangkuk bakso", mangkuk, diameter 14,5 cm
...
```

The model answers `{"plate":"P1","items":[...]}` (the field comes first, so the size is known before it estimates) or `{"plate":null,"items":[...]}` when none matches (eating out, another plate, no plate): then it estimates as usual and the prompt says not to guess. The server reads the field from the raw text (`extractPlateAnswer`, survives a cut-off answer) and checks it against the registered list (`matchDishware`): an absent field, null, or a label nobody registered all mean no match, and the items are untouched either way. The result carries `plate`:

- `{status: "matched", id, name, kind, diameterCm, widthCm}`: the scan screen says "Piring: Piring makan putih (24 cm) terlihat, dipakai sebagai petunjuk ukuran saja. Gramnya tetap perkiraan."
- `{status: "none"}`: "Piring tidak dikenali, porsi diperkirakan biasa."
- absent: nothing was asked (feature off for this user, or no plates registered); the screen says nothing.

"Hitung ulang" (`analyzeFoodRetry`) asks the same question. The ledger row (`ai_usage.usage_json.plate`) keeps `{registered, matched, answer}` for every scan of a user with plates, so recognition can be counted from prod without photos.

## A card in the scan photo

The most direct scale is a thing of known size on the same surface as the food. Any ID-1 card (ISO/IEC 7810, 85.60 x 53.98 mm: ATM, debit, credit, KTP, SIM, e-money; any colour) lying next to the food in the scan photo is a ruler. Same flag as the plates: for a user on `DISHWARE_USER_IDS` the scan prompt always carries the card block (`CARD_INSTRUCTION` in `lib/dishware.ts`), with or without registered plates; for everyone else nothing changes.

The model answers a leading `"card":{"seen":true|false,"confidence":0-1}` (the prompt's example has no literal confidence, only `number`: with `0.9` in it the model copied 0.9-0.95 onto every scan; it still answers 0.95 most of the time, so treat it as "seen", not as a measurement). `seen: true` with a confidence of at least 0.6 (`CARD_MIN_CONFIDENCE`) counts as **used**: the model was told to scale grams by the card's long side (8.56 cm), and the result carries `card: {status: "used"}`, so the scan screen says "Kartu terlihat di foto, dipakai sebagai petunjuk ukuran saja. Gramnya tetap perkiraan." (Copy changed 2026-10-27: nothing in code turns the card or a plate into grams, the model is only told the size and keeps its usual portions, so the line no longer says the card "jadi patokan ukuran porsi".) A card that is not seen, not believable (unsure, covered, something card-shaped like a phone) or an answer without the field adds nothing: no card line, and the scan falls back to the matched registered plate (the plate line as above), then to today's behaviour. When both a card and a plate are reported, the card is the reference ("Kartu terdeteksi"; the plate stays in the result and the ledger).

Every scan of an allowlisted user logs `ai_usage.usage_json.card = {seen, used, confidence}` (the model's own detection and whether it counted), next to `plate` for users with plates, on the first scan and on "Hitung ulang". No migration, no extra model call, no extra image: about 150 prompt tokens. (Since 2026-10-28 the card-measures-the-plate calls below are added for these users.)

The card block also asks that sambal or raw sliced seasoning lying on a side dish (sambal matah: shallot, chilli, lemongrass) is listed as its own item with its own box, which the production prompt alone did not do on the owner's sambal matah bowls (0 of 18 runs listed it; with the block 18 of 18). Only allowlisted users get this block, so nobody else's scans changed.

**Grams from the card, in code: built, measured, switched OFF (owner decision).** The card does NOT change grams: they are the model's, and the model was only told the card's size (it answered the usual 100/150 g whatever it said). A geometry path was built (the model writes the card's box and each item's box plus a shape word; code converts boxes to cm through the 8.56 cm card, then area x fill x mean height x density to grams). On the one weighed photo with a card (boiled egg white, scale 102 g) it computed 103-107 g in 4 of 5 runs against the model's 80-150 g; on three bowl photos it measured an isolated fried egg well but under-measured hidden rice and over-measured beef under sambal and lettuce, and the model's card box was wrong in 2-3 of 10 runs on two of the photos. It also doubled the answer length (about 4-6 s per scan). It was removed until weighed photos with a card exist in number; the full rules, tables, windows and results are in docs/ai-accuracy-log.md (2026-10-20, "the card as a ruler in code"). The weighed photo is kept locally as `.tmp/dataset/owner/egg-white-card` (git-ignored, with `scale.json`) and runs with `bun run scripts/eval-scans.ts --cards .tmp/dataset/cards.json --variant card-ref`.

## The card measures the plate (owner flag, 2026-10-28)

With a card beside the plate the plate's own diameter can be read, so the user registers nothing: a separate small vision call (`lib/card-plate.ts`, same model, temperature 0, never a rule inside the scan prompt) answers whether an ID-1 card lies flat in the photo, its four corners, and the plate or bowl's box (`flat | bowl | none`), all on the 0-1000 grid. Code does the arithmetic: the grid is stretched by the photo's real width and height (read from the file header, `lib/image-size.ts`), the card's long side in pixels is 8.56 cm, and the plate's major axis over it is the diameter.

What code refuses (each is a scan exactly as before, logged): corners that are not a convex quadrilateral (`card_corners`), opposite sides more than 1.35x apart or a long/short ratio outside 1.27-2.06 (`card_shape`, which also catches the bounding box of a card rotated 20 degrees or more), a card spanning under 4% or over 70% of the photo (`card_size`), a plate answered as `none` (a kitchen scale, a bag, a tray are not plates: `no_plate`), no box (`plate_box`), a plate cut off by the photo's border on both axes (`plate_cut_off`; cut on one axis, the other axis is used), a box under 0.6 round (`not_round`), a diameter outside 12-34 cm, or 12-24 cm for a bowl (`implausible_diameter`), a photo whose header size cannot be read (`no_size`, no call made), a call that times out (8 s), errors or answers something unparseable (`timeout`, `error`, `unparseable`), and a scan that finished while the measure was still out (`late`, 1.5 s grace).

**Two calls must agree.** One call is not stable: on one photo, 12 calls at temperature 0 gave a card box that made the bowl 18.5-19.1 cm 8 times and 27.5 cm 4 times (docs/ai-accuracy-log.md, 2026-10-28). So two identical calls run at once; two diameters within 10% (same kind) are averaged, anything else that differs is `no_consensus`, a lost call is `no_consensus` too, two answers of "no card" are `no_card`. About 70 completion tokens each.

**What the scan gets.** The synthetic plate goes through `dishwareInstruction` like a registered one, after the registered ones (`P<n+1>: "piring di foto", piring datar|mangkuk, diameter 19,7 cm. Ciri: ...`), and the answer's `plate` field is read back the usual way. The result carries `plate: {status: "matched", id: "card", name: "piring di foto", diameterCm, source: "card"}` and the scan screen says "Piring ±20 cm, diukur dari kartu di foto, dipakai sebagai petunjuk ukuran saja. Gramnya tetap perkiraan." (`scan:dishware.measured`, id/en/ms), ahead of the plain card line. A model that answers `plate: null` gets the usual "Piring tidak dikenali" and the ledger says so.

**Ordering: the scan starts at once, the measure runs beside it, and a found plate re-runs the scan.** (a) measure first then scan adds the measure's 1.7-2.6 s to every photo; (b) scan once and post-scale has nothing to scale from (the model keeps its usual 150 g of rice whatever diameter it is told, 6 of 6 rice rows in the log, so a correction needs an assumed plate size nobody has). The chosen order costs a photo without a card nothing (the scan alone, held stream events released when the measure says "no card", at most 2.5 s), and a card photo the measure plus a second scan (11-14 s against 8-9 s in the REST measurements) and one wasted first scan. A stream holds its first events until the verdict, and resets what it showed if the verdict comes later. A failed second scan falls back to the first. "Hitung ulang" asks again the same way.

**Ledger**: `ai_usage.usage_json.cardPlate = {seen, card: {box, aspect}, plate: {kind, box, clipped?}, diameterCm, diameters, used, skipped?, ms, usage, retried?, error?, rescanned?, pieces?}` on every scan and retry of an allowlisted user, next to `card` and `plate` (`plate.matched: "card"` when the model took the measured plate). `pieces` is the piece geometry below, logged only.

**Piece geometry (`lib/piece-geometry.ts`) is built and measured but not applied to grams.** With the card's pixels per cm, an isolated separate piece (egg, tempe, tahu, bakwan, ayam goreng piece, the `PIECE_WEIGHTS` names) gets footprint x height x density (egg an ellipsoid, others 0.75 fill x 0.4 x short side within 1-4 cm); a computed weight would replace the model's only within 0.6-2x of it, for one piece whose box other boxes cover by under 20%. On the owner's bowl photos it applied once, to a fried egg, and made it worse (see the log), so production only writes the readings to the ledger (`cardPlate.pieces`); the owner's 2026-10-20 decision (grams stay the model's until weighed photos exist) stands.

What the user is told is the claim "a card was the reference", so a false detection costs trust and a wrong scale; the harness below counts false detections on photos checked to have no card. What is NOT known yet is how well Gemma 4 finds and measures a card in a food photo (perspective, glare, partly hidden, a card on a different plane than the plate).

## Storage and privacy

- D1 `dishware` (migration `0057_dishware`): name, kind, `diameter_cm`, `width_cm` (lunchbox short side), `diameter_source` (manual | card), `description`, `photo_id`, owned by a user (`ON DELETE CASCADE`).
- The photo is private in the `joyorogo-scans` bucket at `dishware/<userId>/<photoId>.jpg`, served only by `GET /dishware-photo/:id` to the owner's session (the key embeds the owner). It is never used for training or the dataset.
- Name and description end up inside a prompt, so they are cleaned (`promptText`: one line, no quotes or braces, length-capped) both when typed and when written by the model.
- Deleting a plate removes its row and photo; the account wipe (`deleteAllUserData`, `deleteUserMedia`) removes every plate and the `dishware/<userId>/` prefix.
- The registration read ("analyze", also run inside `create` when the client did not send a description) is a Workers AI call but not a scan: it has its own budget of 12 per local day (`DISHWARE_ANALYSES_PER_DAY`, counted from `ai_usage` rows of type `dishware`) and never touches the scan quota.

## Measuring it

`scripts/eval-scans.ts --variant plate-ref` (see docs/datasets.md): each case carries the plate it was eaten from (`plate` in an external case's labels, or `--plates <file>` with `{ "<caseId>" | "group:<group>": {name, kind, diameterCm, widthCm?, description?, inPhoto?} }`), the same text block goes into the prompt through the same `dishware` option production uses, and the report adds how often the plate was recognised (in the photo) and wrongly claimed (`inPhoto: false`), next to the usual grams/kcal error tables. When `plate-ref` is in a run, every variant of that run is limited to the cases that have a plate, so baseline vs `plate-ref` is paired on the same photos. With no plate data it prints that and stops (no model calls).

What it needs before it can say anything about grams: real plates with a measured diameter, photographed with food whose weight is known. The external contributor's labels have no plate sizes, so today only the mechanism is exercised (see the accuracy log).

`--variant card-ref` is the same for the card: the shipped card block goes in through the same `dishware` option, with no plates, so its effect is read alone. It runs only on cases whose photo someone checked (external labels `card: true|false`, or `--cards <file>` with `{ "<caseId>" | "group:<group>": true|false }`; true = a card lies beside the food, false = checked and none; unlabelled photos are never assumed to have no card), and every variant of a run with `card-ref` is limited to those cases. The report adds `card seen / used` for the photos with a card and for the ones without (false detections), next to the grams/kcal tables. With no checked photos it says so and stops. A first mechanism check on photos that all have no card is in the accuracy log; grams need photos WITH a card.

What `card-ref` needs before it can say anything about grams: photos of weighed food with a card lying next to it (flat, on the same surface, mostly visible), and the same food photographed without it for the paired comparison.

`--variant card-plate` and `card-plate-geometry` run the measure and the second scan exactly as the router does (same `scanWithMeasuredPlate`, no registered plates) on the same checked-for-a-card cases as `card-ref`, so `card-ref card-plate card-plate-geometry` is one paired run (the first scan of a card-plate run is card-ref's request). The true plate diameter goes in as `plateCm`: `{"<caseId>": {"card": true, "plateCm": 19.5}}` in the `--cards` file, or `plateCm` in an external case's labels (or its `plate.diameterCm`). The report ("Card measures the plate") lists, per photo, the diameter of every rep, median, spread, the error against `plateCm` where it is known, detection and false detections on photos with no card, why a measure was skipped, the time of the measure and of a run with a second scan, and the grams of the second scan against `card-ref` per item. `card-plate-geometry` adds the piece readings (model grams, computed grams, applied).
