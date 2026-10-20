# Piring saya (registered plates and bowls)

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

- `{status: "matched", id, name, kind, diameterCm, widthCm}`: the scan screen says "Piring: Piring makan putih (24 cm), jadi patokan ukuran porsi."
- `{status: "none"}`: "Piring tidak dikenali, porsi diperkirakan biasa."
- absent: nothing was asked (feature off for this user, or no plates registered); the screen says nothing.

"Hitung ulang" (`analyzeFoodRetry`) asks the same question. The ledger row (`ai_usage.usage_json.plate`) keeps `{registered, matched, answer}` for every scan of a user with plates, so recognition can be counted from prod without photos.

## Storage and privacy

- D1 `dishware` (migration `0057_dishware`): name, kind, `diameter_cm`, `width_cm` (lunchbox short side), `diameter_source` (manual | card), `description`, `photo_id`, owned by a user (`ON DELETE CASCADE`).
- The photo is private in the `joyorogo-scans` bucket at `dishware/<userId>/<photoId>.jpg`, served only by `GET /dishware-photo/:id` to the owner's session (the key embeds the owner). It is never used for training or the dataset.
- Name and description end up inside a prompt, so they are cleaned (`promptText`: one line, no quotes or braces, length-capped) both when typed and when written by the model.
- Deleting a plate removes its row and photo; the account wipe (`deleteAllUserData`, `deleteUserMedia`) removes every plate and the `dishware/<userId>/` prefix.
- The registration read ("analyze", also run inside `create` when the client did not send a description) is a Workers AI call but not a scan: it has its own budget of 12 per WIB day (`DISHWARE_ANALYSES_PER_DAY`, counted from `ai_usage` rows of type `dishware`) and never touches the scan quota.

## Measuring it

`scripts/eval-scans.ts --variant plate-ref` (see docs/datasets.md): each case carries the plate it was eaten from (`plate` in an external case's labels, or `--plates <file>` with `{ "<caseId>" | "group:<group>": {name, kind, diameterCm, widthCm?, description?, inPhoto?} }`), the same text block goes into the prompt through the same `dishware` option production uses, and the report adds how often the plate was recognised (in the photo) and wrongly claimed (`inPhoto: false`), next to the usual grams/kcal error tables. When `plate-ref` is in a run, every variant of that run is limited to the cases that have a plate, so baseline vs `plate-ref` is paired on the same photos. With no plate data it prints that and stops (no model calls).

What it needs before it can say anything about grams: real plates with a measured diameter, photographed with food whose weight is known. The external contributor's labels have no plate sizes, so today only the mechanism is exercised (see the accuracy log).
