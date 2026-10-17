# Hamil and Menyusui modes

For pregnant and breastfeeding users the normal plan (BMR/TDEE minus a deficit toward a target weight and
date) is wrong and can be harmful, so the profile has a `maternalMode` (`none` | `pregnant` | `breastfeeding`).
All the math is one pure module, `packages/api/src/lib/maternal.ts` (tests: `maternal.test.ts`), shared by
the server and both clients. Nothing here is medical advice; the UI always carries the disclaimer
(`maternal:disclaimer.*`: not a medical device, follow the doctor/bidan, Posyandu and Buku KIA).

## What changes in these modes

- Target = maintenance TDEE on the **pre-pregnancy basis** (Mifflin-St Jeor at the pre-pregnancy weight, the
  usual activity multiplier, rounded to 5) **plus** the AKG 2019 addition. No deficit, no Burn target, no
  weight target or date, no measured-TDEE drift (`computeMaternalTargets`, `buildPlan` branches on the row).
- Targets carry `targets.maternal` (`MaternalInfo`): stage, gestation (week/day/trimester/HPL, recomputed
  from the stored HPHT every day), baby age (from the birth date), the AKG nutrient table, the IOM plan and
  the flags the UI explains.
- Hidden or off: streak and milestones (`day.summary` returns 0/[]), weight-lost recap, weight target rows,
  fasting (setSettings refuses it, the reminder cron skips these profiles), the public `/u/<code>` page and
  its toggle, Ramadan `auto` (stays off), group weight and daily-need numbers.
- Entering the mode via Settings keeps the old weight target untouched but unused; **turning it off** (or
  "Sudah melahirkan" -> not breastfeeding) sets target weight = current weight, i.e. a maintenance plan. A
  gentler target is only set by the user, after seeing a doctor.
- AI: the scan prompt (`analyzeFoodPhoto` `userContext`) gets one line with the mode and trimester, forbids
  deficit coaching and asks the model to write doneness into the dish name (`maternalPromptNote`).

## Data (migration 0038, `profile` columns)

`maternal_mode`, `pregnancy_lmp` (HPHT; an entered HPL is stored as HPL - 280 days), `pregnancy_date_kind`
(`hpht` | `hpl`, what the user typed), `pre_pregnancy_weight_kg`, `pregnancy_twins`, `breastfeeding_type`
(`exclusive` | `partial`), `baby_birth_date` (an entered age in months becomes a date so it keeps advancing),
`maternal_conditions` (JSON; only triggers a see-your-doctor note).

API: `profile.upsert` (optional `maternal`, optional target fields), `profile.setMaternal`,
`profile.endPregnancy`, `weight.pregnancyChart`, `day.summary().maternal.caffeine`.

## Sources and the exact numbers used

**AKG 2019**: Permenkes RI No. 28 Tahun 2019, Lampiran I, Tabel 1-3 (checked against the PDF at
jdih.kemkes.go.id/storage/documents/pdfs/2019permenkes028.pdf).

| | T1 | T2 | T3 | Menyusui 6 bln pertama | 6 bln kedua |
| --- | --: | --: | --: | --: | --: |
| Energi (kkal) | +180 | +300 | +300 | +330 | +400 |
| Protein (g) | +1 | +10 | +30 | +20 | +15 |
| Serat (g) | +3 | +4 | +4 | +5 | +6 |
| Air (ml) | +300 | +300 | +300 | +800 | +650 |
| Besi (mg) | +0 | +9 | +9 | +0 | +0 |
| Folat (mcg) | +200 | +200 | +200 | +100 | +100 |
| Kalsium (mg) | +200 | +200 | +200 | +200 | +200 |
| Iodium (mcg) | +70 | +70 | +70 | +140 | +140 |
| Vitamin A (RE) | +300 | +300 | +300 | +350 | +350 |

Bases are the AKG row for the user's age (19-29 y: protein 60 g, fibre 32 g, water 2350 ml, besi 18 mg,
kalsium 1000 mg, iodium 150 mcg; vitamin A 600 RE and folat 400 mcg for every band; 10-12, 13-15, 16-18, 30-49
and 50+ bands are in `akgBand`). Note the source gives breastfeeding protein as +20 g only for the first six
months and +15 g for the second; the second period is used as published, not +20 throughout.
Trimester boundaries: T2 from 14w0d, T3 from 28w0d. Breastfeeding periods follow the baby's completed
months (0-5 first, 6+ second).

**Flagged where the source has no figure**
- Twins: AKG has no twin addition. The singleton pregnancy addition is used and the UI says so
  (`TWINS_ENERGY`); no extra kcal is invented.
- Partial breastfeeding: AKG has no figure; the full AKG addition is used as the estimate (decided by the
  lead: under-feeding a nursing mother is the worse error) and flagged `PARTIAL_ESTIMATE`. The exclusive/partial
  answer only drives that note.
- Baby older than 12 months: AKG stops at 12; the second-period figures keep applying (`BABY_OVER_12`).
- Nutrients our food data cannot track (food logs carry kcal, protein, carbs, fat, fibre; water has its own
  log): besi, folat, kalsium, iodium, vitamin A, DHA are shown as "perhatikan" guidance, not progress.

**DHA**: FAO/WHO, Fats and fatty acids in human nutrition (2010), Table 7.2: 200 mg DHA/day (300 mg EPA+DHA)
in pregnancy and lactation.

**IOM 2009** (Weight Gain During Pregnancy: Reexamining the Guidelines), total gain by pre-pregnancy BMI
(WHO cut-offs 18.5 / 25 / 30):

| BMI | singleton | twins (provisional) |
| --- | --: | --: |
| under | 12.5-18 kg | no range ("insufficient information"): the normal twin range is shown and flagged `TWINS_UNDERWEIGHT` |
| normal | 11.5-16 | 16.8-24.5 |
| over | 7-11.5 | 14.1-22.7 |
| obese | 5-9 | 11.3-19.1 |

Singleton weekly rate in trimesters 2-3: under 0.44-0.58, normal 0.35-0.50, over 0.23-0.33, obese
0.17-0.27 kg/week. IOM assumes 0.5-2 kg for the first trimester in every group. The weekly chart band is
**our interpolation**: 0-0 kg at week 0, 0.5-2 kg at week 13, straight lines to the cited total at week 40
(so it lands exactly on the IOM total). A reading counts as inside the band within 0.5 kg of it.

**Food-safety flags** (`foodFlagsFor`, name matching, gentle notes): alcohol, caffeine (estimated mg per
serving, 200 mg/day limit), raw or undercooked meat, eggs and fish, high-mercury fish, unpasteurized milk and
soft cheese, jamu/herbal. Alcohol, caffeine and herbal apply to both modes; the others to pregnancy only.
Caffeine mg per serving are rough typical values (espresso/black coffee 95, other coffee 80, energy drink 80,
matcha 70, tea 40, cola 35), not a measurement.
