# Pelan-pelan: fast-loss note and protein per kg

Two small safety touches for people who are cutting. Neither is medical advice: the note says "slow down a bit, eat
enough protein, ask a doctor or dietitian if unsure", and the protein line is a guide, not a prescription. Every
threshold below is the app's product choice, named in `packages/api/src/lib/safety.ts` (pure, shared by the server and
both clients, tests in `safety.test.ts` and `routers/day-fastloss.test.ts`).

## The note ("Pelan-pelan dulu")

`day.summary` returns `fastLoss` (`FastLossNote | null`). It is computed from data the query already loads: the 60 days
of weigh-ins `planQueries` fetches, and the per-day kcal plus distinct-meal count of the streak window (the existing
`foodDates` query gained `count(distinct meal)`; imported history is excluded there). No extra query. It is `null` for a
browsed past day: the note belongs to today.

Two reasons, one card (the copy names whichever apply):

| Reason | Trips when | Why |
| --- | --- | --- |
| `weight` | a **sustained** fall of 1% of body weight a week or more: the least-squares slope of the raw weigh-ins of the last 28 days, using only weigh-ins at least 14 days after the person's first weigh-in, from at least 4 of them that span at least 14 days | 0.5-1% a week is the usual steady pace; past 1% a larger share is water and muscle. The first two weeks of a new habit or plan drop water and glycogen (the owner's first week was 107.7, 107.5, 106.6, 105.5 kg in 4 days, about 2% a week, and must not trip it), so they never count; a single noisy reading cannot trip a slope over 4+ points and two weeks. The history the server passes is ~60 days, so for someone who weighed in earlier than that the "first weigh-in" is the oldest one it sees, which only makes the rule more cautious. The percent shown is the slope over the mean weight of those points. Tests: `safety.test.ts` (the owner's series no trigger, 1.5% a week for three weeks triggers). |
| `intake` | at least 3 of the last 5 days before today were fully logged and under `max(0.8 x BMR, 1000 kcal)` | 0.8 x BMR is a larger gap than any deficit the plan itself asks for; the 1000 kcal floor covers small bodies where 0.8 x BMR is too low to mean anything. A day counts as fully logged with at least 3 distinct meal slots and at least 300 kcal, so a partly logged day or three logged coffees reads as a skipped day, not a fast. Today never counts (it is still being logged). BMR is the plan's (`targets.bmr`, Mifflin-St Jeor). |

Never shown: Hamil / Menyusui (`plan.maternal`), Naikin BB plans (`targets.gain`: they keep their own, stricter 0.5%
`RAPID_LOSS` flag in `gain.ts`, unchanged), no weigh-ins and no complete days. Goals `lose` and `maintain` both get it.

Where it shows: Makan > Daftar right under the day summary (today only), and Beranda in the notices slot (today only,
not for maternal). Native: `components/makan/fast-loss-note.tsx`; web: `components/makan/fast-loss-note.tsx`.

### Dismissal

"Tutup" hides the note for `FAST_LOSS_DISMISS_DAYS` (3) days. The stamp is a `YYYY-MM-DD` of the day it was closed, kept
on the device only (native SecureStore `joyorogo.fastLoss.closedOn.<userId>`, web localStorage
`jrg-fast-loss-closed-<userId>`), per user id, and shared by Makan and Beranda on that device. It is not a synced pref:
`rogo-prefs` dismissals are permanent booleans, and a few-day snooze would need a new dated pref spec plus sync plumbing
on both clients. The cost: closing on the phone does not close it on the web. `isFastLossDismissed` is the one rule
(a malformed or future stamp hides nothing).

## Protein per kg in the day summary

Under the protein bar of the Makan day summary: `Protein 0,8 g/kg · panduan 1,2-1,6 g/kg` (`daySummary.proteinPerKg`).
The grams stay in the bar; the line only adds the ratio.

- Ratio = the day's eaten protein over the latest weigh-in (`day.summary.latestWeightKg`, on or before the viewed day),
  one decimal.
- Guide range: 1.2-1.6 g/kg (`PROTEIN_GUIDE_G_PER_KG`), for adults eating in a deficit and generally active adults:
  above the 0.8 g/kg minimum, below the 1.6-2.2 range of a deliberate gain. Naikin BB plans show the gain range
  (`PROTEIN_G_PER_KG` in `gain.ts`, unchanged). Hamil / Menyusui show nothing here and keep the AKG protein target.
- Honesty: unknown protein is not zero. Only the day's rows with a protein figure count as "known" (`items.some(protein
  != null)`); with none, or without a weigh-in, the line is absent. `proteinPerKg` is pure and takes `proteinKnown`.
- The protein target of the bar (`proteinGoalG`, 1.5 g/kg capped at the top of the healthy range) is unchanged.
