# Daily accuracy digest

Every morning the server builds an accuracy report for the previous WIB day, re-runs labelled photos through the current scan pipeline, stores it all as JSON in R2 and mails the admins. The admin **Laporan** tab shows the same reports.

## Flow

- **Trigger.** The existing `*/5` cron. From 07:00 WIB each tick calls `runDailyAccuracy` (`apps/server/src/accuracy-job.ts`), which does one R2 read and stops if yesterday's report is done. A crashed run is retried by the next tick (R2 lock `reports/accuracy/<date>.lock`, 20 min TTL, 3 attempts).
- **Report.** `reports/accuracy/<date>.json` in the `joyorogo-scans` bucket (`STICKERS` binding). Built by `packages/api/src/lib/accuracy-report.ts` (pure) from `ai_usage.usage_json` sessions, `scan_feedback` and the failed/correction ledger rows. Outcome rules come from `scan-outcome.ts` (`outcomeSql`, `scanOutcome`, `retryDerivedSql`), the same ones the admin Feedback tab uses. No D1 migration; the only D1 write is the `email_log` claim (kind `accuracy_digest`, ref = date).
- **Regression.** Up to 40 labelled photos a day (`REGRESSION_CAP`) go through `analyzeFoodPhoto` with the `AI` binding: the owner dataset (`dataset/…`, truth = diary save) and consented feedback photos (`feedback/…`, truth = saved items). Half the budget is a fixed anchor so two days share cases; the other half rotates through the rest. Today's run is compared with the latest earlier run on the cases both answered (at least 8): name F1 down 5 points or more, or mean kcal shortfall up 3 points or more, is a regression flag. At most 80 `meta.json` reads, no new photo after 10 minutes.
- **Email.** To `ADMIN_EMAILS`, Indonesian, plain: headline numbers, top 5 problems, regressions, health and latency, up to 3 suggestions, link to `https://admin.joyorogo.com/#laporan?date=<date>`. Days with zero scans send nothing. A failed send frees its `email_log` claim and is retried on later ticks (3 attempts in all).
- **Admin.** `GET /api/admin/accuracy` (paged list with headline numbers) and `GET /api/admin/accuracy/<date>` (the full report); `apps/admin/src/sections/Laporan.tsx`.
- **Shadow test.** On a sample of live first scans (`SHADOW_SAMPLE_RATE`, default 0.2, `0` = off; at most `SHADOW_DAILY_CAP` = 60 per WIB day) `runShadowScan` (`lib/shadow-scan.ts`) re-answers the same photo in `waitUntil`, after the response, with the shadow variant (production prompt + the trimmed dish-identity rule, temperature 0.1). Its items go into the scan's `ai_usage.usage_json` under `shadow` (`{ variant, at, ms, model, items }`, or `{ …, error }`), next to `aiItems`. No ledger row, so the user's quota is untouched and a failure is invisible to them. The report's `shadow` section (`shadowReport`) compares, on the day's scans that were saved, prod's first answer and the shadow answer against the saved items: name F1, mean kcal shortfall, plates over/under the saved kcal by more than 5%, and per scan which side was closer (more saved names matched, else the smaller kcal error; within 2 points = tie), for all saved scans and for the corrected ones. The mail has an "Uji bayangan" block. Retries ("Hitung ulang") never run the shadow; the comparison is first answer vs saved items.
- **Suggestions** (`suggestions` in the report) come from the last 7 days with thresholds (3 or more scans). They are advice only. Nothing changes prompts, calibration or aliases automatically.
- **No personal data.** Reports and mail hold dish names, counts and percentages; regression cases are identified by a hash. Rating notes are free text typed by users and appear in the report (admin only), never in the email.

## Manual run

`POST https://api.joyorogo.com/ai/accuracy/run?date=YYYY-MM-DD[&force=1]` with header `X-Bench-Key: <ACCURACY_RUN_KEY secret>`. Default date is yesterday (WIB). Without `force` an existing report is returned as is. The route answers 404 when the secret is unset.

## Limits

- Shadow numbers are small (about 12-20 sampled scans a day, fewer saved). Read them over a week, not a day. A saved scan labelled "accurate" saw only prod's answer on screen, so it favours prod by construction; the corrected scans are the fair comparison.
- `repaired` (model JSON needed key repair) is recorded in the ledger only from the deploy that added it; earlier days report 0.
- An owner scan saved unedited has the model's own answer as truth, so a re-run of the same model scores well on it by construction; regressions show up through the corrected and feedback cases.
