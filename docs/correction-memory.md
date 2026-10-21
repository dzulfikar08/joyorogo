# Ingat koreksimu (correction memory)

**Off for users, on for the owner/QA**: behind `CORRECTION_MEMORY_USER_IDS` (comma-separated user ids, `apps/server/wrangler.jsonc`, typed in `apps/server/.env.schema`). Unset or empty = nobody: the scan prompt and the result are exactly as before.

## What it does

- **History, nothing new stored.** Every scan session already keeps the model's answer and what the diary got (`ai_usage.usage_json` `aiItems` / `retryItems` and `savedItems`, `lib/scan-outcome.ts`). `lib/correction-memory.ts` reads the user's last 90 days of saved sessions and pairs them: "the model said X, the user saved Y" (a weight-matched rename, or the one removed + one added item left over; several leftovers are ambiguous and give nothing).
- **Scan prompt.** Pairs seen at least twice become one rule each, phrased about the model's own answer: *if you would say X (or similar), write Y*. A food the user keeps as the model says it and that shares a word with Y (telur rebus next to putih telur) is named as the exception, then the user's most logged foods as far as the ~760 character cap allows, then "for any other food you recognise, write what you see; this note does not apply". Added to `analyzeFood` and the retry; `usage_json.memory = {pairs, used}` on the ledger row.
- **Result screen.** `analyzeFood` / retry answer `memoryChips` (the Y names the user corrected this very label to, at most 3) unless the top answer already is one. A chip needs a real match: the top answer is the X of a past X→Y correction (same name, or a shared distinctive word; putih/goreng/nasi/ayam/telur... alone never match) and Y is the same kind (drink vs dish). One correction is enough for a chip; the prompt block still needs two. Regression: lontong/es krim/susu→putih telur never puts egg white under nasi putih; nasi putih→nasi konjac is offered on the next nasi putih. Konjac rice renames keep the old weight and take the library kcal (nasi konjac 70, nasi shirataki 15 per 100 g, sources in `tkpi.ts`). Web and native show "Maksudnya ini?" with one chip per name; a tap runs the same `ai.correctScan` path as the Koreksi box (`bukan <top answer>, <chip>`), with undo.

## Why the rule is phrased about the model's answer

Real model (Gemma 4 26B), owner's putih telur photos (egg white in a plastic bag), 6 runs per photo and arm. Baseline says es mambo / es lilin / susu plastik, never putih telur.

| prompt block | the 4 egg-white bags | boiled egg (control) |
|---|---|---|
| "foto mirip X ternyata Y (2x)" + frequent foods | 0-3 of 4 runs per photo; repeats X ("es mambo susu") instead | n/a |
| "the plastic looks like es mambo; pick Y if it looks like that" | 24 of 24 | 5 of 6 became putih telur (wrong) |
| "if you would say X, write Y", no exception | 24 of 24 | 6 of 6 became putih telur (wrong) |
| same + "if it clearly is telur rebus, write that" | 24 of 24 | 0 of 6 (stays telur rebus) |

Other owner scans (nasi + ayam + tahu, pepaya, jagung rebus, es kopi susu, lontong sayur, martabak) kept their baseline names; no tahu or nasi turned into putih telur. Side effect seen: any added prompt text made the martabak photo more often list an extra "bakwan jagung" next to the martabak telur.
