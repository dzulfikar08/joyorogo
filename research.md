Yes — as a **personal diet tool and Indonesia-first product**, it’s still a good idea in September 2026. As a **generic “AI calorie tracker go global” play**, the window is mostly closed. The category is big, but it is no longer empty.

## Verdict in one line

Build JoyoRogo as _your_ diet companion and an Indonesia-specialist product. Do **not** make it forever-free with ads on load. Stay local first; go global only after one cuisine and one habit loop are clearly better than everyone else.

## Is the category still alive?

Alive, growing, and crowded.

- Nutrition/diet apps are projected around **$10.7B in 2026**, with AI features in roughly **60%+** of that market.
- AI photo logging jumped from a minority feature in 2024 to **~73% of top-15 apps** in 2026. “Snap food, get calories” is table stakes, not a moat.
- At least **13 calorie apps already cleared $1M/month revenue** in Q1 2026. New 2024 AI apps (Cal AI, BitePal, etc.) are in that group. MyFitnessPal still leads on users; Yazio is huge in Europe. Cal AI was acquired by MyFitnessPal (deal closed late 2025 / announced 2026).
- The new fight is **accuracy + speed + habit**, not “we have AI.” Independent 2026 tests still show popular photo apps **underestimating calories, especially fat** — sometimes badly. That is an opening if you are honest about error, let users correct, and ground numbers in Indonesian food data (TKPI + warung portions), not USDA pizza photos.

So: the idea is not dead. The undifferentiated idea is dead.

## What JoyoRogo actually is today

From your live site: Bahasa Indonesia web app, made in Malang, Google login, photos discarded after analysis, Mifflin–St Jeor targets, three daily numbers (eat / burn / sleep), Indonesian dish recognition with user correction, Strava import, weight + sleep log.

That positioning is sharper than most clones:

- “Don’t count calories. Follow 3 numbers.”
- Indonesian plates, not Western bowls
- Sleep + burn, not only macros
- Privacy: photo is ephemeral
- Web-first and cheap to run

Weaknesses vs the 2026 market:

- Personal subdomain (`joyorogo.dzulfikar.com`) signals side project, not product
- No public pricing, no App Store/Play listing, no proof of accuracy
- No barcode, no voice, no fasting/Ramadan, no coin/streak loop, no coach chat
- “Fast” will die the moment you put an ad in front of the camera

Use it for your own cut first. That is the right founder move. Dogfood for 8–12 weeks, log every miss on Indonesian food, then productize the misses.

## Competition map

### Global (you will lose a head-on fight)

| Product                                                   | What they win on                                               | Model                                          |
| --------------------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------- |
| MyFitnessPal (+ Cal AI)                                   | Brand, barcode DB, distribution                                | Free + heavy ads, Premium ~$80/yr              |
| Welling / PlateLens / Nutrola-class AI apps               | Photo accuracy + speed (~2–3s), free tier often 3 AI scans/day | Cheap annual Premium (~$30–35) or mid-tier sub |
| MacroFactor                                               | Adaptive TDEE for serious lifters                              | Paid, almost no photo AI                       |
| Cronometer                                                | Micros, clinical vibe                                          | Light ads / Gold                               |
| Lose It!, Yazio, Lifesum, Foodvisor, SnapCalorie, Bitepal | Habit UX, EU foods, photo speed                                | Freemium                                       |
| Chowdown                                                  | “Free forever, no ads” marketing                               | Unclear sustainability                         |

Global users already compare apps on **MAPE, scan speed, and whether free AI is capped**. A new web app on a personal domain will not be in those roundups.

### Indonesia / local (this is your real arena)

You named two. There are more, and names collide.

**Closest consumer rivals**

- **GiziAI** (`giziai.com`) — WhatsApp/LINE coach, snap a plate, local dishes, “no app to install,” positions as cheaper than MFP. Has ID + SG entities. Distribution via chat is a real local advantage.
- **Giziku AI** — photo + type, TDEE, **Ramadan / IF mode**, Gizi Coin to unlock premium scans, ads + IAP, claims Gemini. Very close to your user.
- **Kaloria** — photo + voice + named AI coaches, says it handles nasi goreng / soto / rendang, **40 languages**. Free ~2 scans/day; Premium about **Rp129k/mo or Rp690k/yr**. This is the polished “global product with ID skin.”
- **Cofre** — AI scan tuned for ID food **plus short recipe videos**. Free + paid scan quota. Different wedge: content + calories.
- **Fumai** — 500+ ID foods, barcode, fitness community. Core tracker free; paid workout/AI extras. Database play, not only vision.
- **AI NutriScan, NutriGuide, several “NutriAI” store apps** — same photo-macro pitch, mixed quality, some with ads.

**Not the same product**

- **NutriAI Pro** — B2B for _ahli gizi_ (NCP notes, diet menus). Adjacent, not a consumer tracker.
- **Nutrisai** — mostly packaged-food scan + health coach, multi-country, not an Indonesian home-cooking diary.

Local gap that still exists: **warung / mixed plates / sambal / “porsi warung vs porsi diet” / Ramadan / sleep + steps as first-class**, with a UI that feels like a friend from Malang, not a US gym app translated at 70%.

GiziAI and Giziku already occupy “AI + local food + cheap.” You need a narrower story than “also AI calories.”

## Forever free + ads on loading: don’t

This is the weakest part of the plan, especially if you want the app to feel fast and trustworthy.

Why it fails in _this_ category in 2026:

1. **Loading/interstitial ads destroy the habit.** Logging is already annoying. The apps people quit are the ones that insert a screen between “I just ate” and “it’s logged.” Reviews in this category treat ads as a product defect, not a business model.
2. **You are advertising against your own claim.** Site copy is “fast, confirm, done.” An ad on load makes you slower than Cal AI / Kaloria / Giziku on the one moment that matters.
3. **Health + ad networks is a trust tax.** Food photos, weight, sleep, Google login. Even if you discard photos, loading ads usually mean an ad SDK, tracking, and “diet pill / slimming tea” creatives. That is the worst possible ad adjacency for a diet app.
4. **AI is not free.** Every scan costs tokens/GPU. Ads on _page load_ pay for page views, not for expensive inferences. You can easily lose money on heavy users while annoying light users.
5. **Indonesia ad RPMs are low.** Forever-free only works at huge scale (MFP) or if inference is almost free. You have neither yet.
6. **Store and web policy + UX.** Interstitials on open are exactly the format users, and often platforms, punish.

What actually works in 2026 for “cheap / free”:

| Model                                                    | Who uses it          | Fit for you                                |
| -------------------------------------------------------- | -------------------- | ------------------------------------------ |
| Free forever + **3 AI scans/day**, unlimited manual/text | PlateLens-style apps | Best default                               |
| Free + **coins / rewarded extra scans**                  | Giziku, EatAI        | Good for ID users who won’t pay USD prices |
| Free core diary, pay for unlimited AI + coach            | Kaloria, Cofre       | Cleanest long-term                         |
| WhatsApp bot, pay per pack of scans                      | GiziAI-shaped        | Low install friction                       |
| Truly free no ads                                        | Chowdown-type, rare  | Only if you subsidize it yourself          |

**Better version of your idea:** forever-free _diary_ (targets, weight, sleep, Strava, manual log). AI photo is metered. No ad on load. If you need ads, put a **small banner on the history screen**, never on camera or save. Optional: watch a 15s video to unlock 1 extra scan — user chose it.

Price ID in rupiah, not $8/mo. Kaloria at Rp129k/mo is already spicy for many people; a **Rp25k–49k/mo** or **Rp199k/year** unlimited-scan plan is more honest for a local web app. Or sell scan packs (20 scans / Rp15k).

## Local vs global

**Stay local for 12–18 months.** Then consider SEA, not “the world.”

**Stay local because:**

- Global incumbents have brand, DB, and review-site SEO you cannot buy.
- Your only unfair advantage is **Indonesian food + Indonesian day structure** (nasi + lauk, gorengan, es, sahur/berbuka, motor commute vs gym).
- Payment, language, and trust are easier in ID.
- Web-first is a feature in Indonesia (no 80MB APK, works on cheap Androids). Globally it looks unfinished.
- `dzulfikar.com` subdomain will not convert US/EU users. Even in ID you will want `joyorogo.id` / `.app` before any real push.

**Don’t “go global” until you can show:**

- Blind test: 100 Indonesian mixed plates, your MAPE vs GiziAI / Kaloria / a generic GPT-vision wrapper
- 30-day retention on people who are not you
- A real domain, privacy page, and delete-my-data
- PWA install + optional Play listing (sideload/PWA first is fine)

**Middle path that can work later:** Indonesia → Malaysia / Singapore Malay-Chinese-Indian mixed plates → Philippines. Same rice-based, street-food problem. Not US chicken-and-broccoli.

Going global now just means competing with Kaloria’s 40-language page and MFP’s 20M users using a personal URL.

## What I’d actually do if this were my diet app

1. **Use it yourself for a full cut.** Public “diet journey” is marketing and QA. Publish weekly: weight, adherence, which dishes the model butchered (geprek + nasi + lalapan + es teh is the hard case, not an apple).
2. **Win one job:** “Foto piring warung → angka yang masuk akal dalam 3 detik, bisa dikoreksi.” Not 12 features.
3. **Ground truth in TKPI + your own portion library.** “1 porsi nasi warung ≈ 200g” beats a pretty model that thinks rendang is 193 kcal like a lab sample.
4. **Keep the 3-number UX.** That’s more differentiated than another macro ring. Add Ramadan mode before you add a social feed.
5. **Meter AI, never interstitial-on-load.** Free: 3–5 scans/day + unlimited text. Paid or coins for more.
6. **Move off the personal subdomain** when you invite anyone who isn’t a friend.
7. **Ignore App Store global ASO** until local retention is real. A tight PWA + WhatsApp share (“kirim foto ke JoyoRogo”) can beat a thin native app.

## Honest bottom line

- **Still good in Sept 2026?** Yes, as a focused Indonesia diet companion you actually live in.
- **Good as a global startup thesis?** No. That war is between MFP/Cal AI, Welling/PlateLens-class apps, and well-funded photo trackers.
- **GiziAI / Giziku / Kaloria / Cofre / Fumai** are the competitors that matter, not MyFitnessPal’s homepage.
- **Forever free + ads at loading** trades your only promised feelings (fast, cheap, private) for weak ID ad revenue. Meter the model, not the user’s patience.

If you want, next I can sketch a concrete 90-day plan: scan limits, rupiah pricing, which ID dishes to benchmark first, and a landing page that doesn’t look like a personal side project.
