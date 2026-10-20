# Depth sensing and on-device ML for portion grams (research)

Written 2026-10-20. Research only: no code, nothing decided, nothing shipped. Question: could on-device ML (LiteRT/TFLite, Core ML, MediaPipe) and depth sensing (iPhone Pro LiDAR, ARCore Depth API, dual-camera depth) fix the weak point of the photo scan, grams? Context is `docs/ai-accuracy-log.md` (2026-10-20): the model answers 150 g of rice where a weighed eater takes about 100 g (+45%, 43 g MAE on the external set), plate kcal +20% / 83 kcal MAE, and a prompt that tells the model to read plate size (`scale-cues`) did nothing for rice.

Tags: `[INFERENCE]` = my reasoning, not read in a source or measured here. Numbers without a tag are from the sources at the bottom, quoted as the authors report them.

## Recommendation in five lines

1. Depth is the one input in the literature that roughly halves portion error, but only with a good sensor, a plate-plane fit and a density table. On a phone LiDAR at plate distance the signal (1 cm of mound height is about 45 g of rice) is the same size as the sensor's own error (about 1 cm). Whether it works for us is an open measurement, not a given.
2. Reach is small. LiDAR iPhones are `[INFERENCE]` about 5-8% of our mobile users; ARCore depth-from-motion covers most Androids on paper but is worst exactly where we need it (close range, featureless white rice, no sweep time).
3. On-device ML alone does not fix grams (a scale-free monocular model scored 68% MAPE in the one paper I read; our own `scale-cues` run gave nothing). It is an enabler (segmentation, a plate detector), not the fix.
4. Do the cheap, all-device work first: `Porsi kebiasaanmu` (landed, flag-off) and `Piring saya` (in flight) already attack rice. Depth's real value is where those fail: a first scan, a new dish, eating out, and the "this plate is bigger than usual" case the prior's big-plate guard handles with a blunt 1.4x rule.
5. Run a 2-3 day offline feasibility test on one LiDAR iPhone before any store build (section 9). Go/no-go on measured numbers: empty-plate height noise and rice/lauk MAE against a kitchen scale. Only then build the iOS-only, allowlisted capture module (Phase 1). Android only after iOS proves value.

## 1. What the evidence says

| Evidence | Setup | Result |
|---|---|---|
| Humans eyeballing portions (Nutrition5k, 20 raters, 10 dishes) [1] | photo only | mean error 41% (4 nutritionists), 53% (16 non-nutritionists) |
| RGB-only CNN (Nutrition5k) [1] | one RGB image, direct regression | calories MAE 70.6 kcal = 26.1%; total mass 38.1 g = 29.5% (Table 4 subset) |
| Same + depth-derived volume scalar (Nutrition5k) [1] | overhead RealSense D435 at a fixed 35.9 cm, volume = sum of per-pixel height x pixel area, fed as an extra input to the mass regressor | mass 29.4 g = 13.7%; end-to-end calories 41.3 kcal = 16.5%. Depth as a 4th image channel: 18.8%. Calories per gram alone (portion-independent): 9.5%, so portion is most of the error |
| iPhone X TrueDepth app (SNAQ, Bern) [2] | 48 hospital meals / 128 items, one capture at 45 or 90 degrees, RANSAC table plane, food type picked by the user, density table | weight MAE 35.1 g = 14.0%; energy 41.2 kcal = 12.7%; cooked meals 18.2% with +15% bias; 22.9 s processing; angle made no significant difference; 7 of 128 items (5.5%) needed manual segmentation fixes. The same paper cites earlier RGB-only apps at 26.2% and 24.7% carb error |
| MealScan3D (structure-sensor iPad, 179 people) [3] | 3D scans vs written food record, trained coders adjusted segmentation | energy r2 84.6% vs 59.3%; mean energy +120 kcal vs -171 kcal. Vegetable and starch sides were far better (broccoli +5 g vs +88 g), main entrees worse (chicken +45 g vs +15 g, pork +50 g vs +12 g): meat shape, bone and density hurt volume methods |
| SnapCalorie (company FAQ and TechCrunch) [4][5] | uses the depth sensor on supported devices plus human reviewers | claims about 15% mean caloric error. Company claim, not independently checked, mixed with human review |
| Reference-object methods, single view (survey table) [6] | checkerboard, plate, cutlery or coin in frame | reported 6-21%: Fang 2015 <6% (19 items), Akpa 2016 6.9% (cutlery), Jia 2012 <10% (circular plate), Okamoto 2016 21.3% (60 test images). Tiny sets, different metrics, not comparable with each other |
| Monocular, no scale (MFP3D) [7] | single image to a 3D point cloud to regression | best energy MAPE 68% on MetaFood3D (whole foods, 108 classes), 24% on SimpleFood45; "3D assisted" with a physical reference was 102% / 25%. Scale is the missing piece |
| Phone LiDAR itself (iPhone 12 Pro) [8] | 576-point dToF array, 256x192 fused depth in ARKit [9] | absolute accuracy +/-1 cm for objects >10 cm; precision drops under 10 cm and the detection limit is about 5 cm; point density 7,225/m2 at 25 cm falling to 150/m2 at 250 cm |

Gaps I could not close: I found one 2025 peer-reviewed paper on food calories with a phone LiDAR (ACPR 2025, [10]) but the publisher blocked the full text, so I do not know its error. There is no published validation I could find for Indonesian dishes, nasi campur plates or ARCore depth on food.

### What this means for us

- **Best case is large.** From RGB-only 29.5% to 13.7% on mass (-54%, Nutrition5k) and 26% to 14-15% on carbs (SNAQ vs earlier apps) with a good depth sensor and a user-confirmed food type.
- **Our case is worse than those labs** `[INFERENCE]`: handheld phone, 30-40 cm, sparse LiDAR (my interpolation of [8]: about 26 raw points on a 9 cm rice mound at 35 cm, the rest is ARKit's learned upsampling), mixed plates, concave plates and banana leaf, white rice, sauces covering food, bone-in meat, items that touch and overlap.
- **Haircut.** I would plan for a 20-40% cut of portion error on items where it works, not 54%, and only on items measurable by top-down volume: nasi, lauk with a solid shape, telur, tempe/tahu, mie. Not measurable: soups and anything in a bowl, drinks, items under other items, raw leafy lalapan (FAO bulk density 0.08 g/ml, so a 1 cm error is the whole answer), mixed dishes the prompt keeps as one item (gado-gado, soto) `[INFERENCE]`.
- **Worked example, rice.** 100 g of boiled rice at 0.73 g/ml is 137 cm3, about a 9 cm wide, 3.5 cm high mound (spherical-cap model, 64 cm2 footprint). 150 g is about 205 cm3, roughly 1.1 cm higher on the same footprint. A mean height error `dh` over the footprint costs about `46 g x dh[cm]`: 3 mm = 14 g, 5 mm = 23 g, 1 cm = 46 g. The model's current rice error is +50 g. So depth beats the model only if the plane fit and depth keep mean height error under about 7 mm, and halves its error at about 3-4 mm. This is the number the MVP has to measure.
- **Floor from density.** Even perfect volume leaves density: a scoop that is packed vs fluffed differs `[INFERENCE]` 10-15%. SNAQ's 14% weight error includes it.

## 2. What each sensor and model gives

| Option | What it is | Fit for portion volume |
|---|---|---|
| iPhone LiDAR, ARKit `sceneDepth` | LiDAR iPhones only (`supportsFrameSemantics(.sceneDepth)`); 256x192 float depth in meters plus confidence map at up to 60 fps, registered to the color image, 4:3 [9][11]. AVFoundation's LiDAR depth camera is the alternative; a forum thread reports a lower frame rate than ARKit | Best available on a phone. Works without moving; ARKit also gives the camera pose and plane detection. Limits as in section 1: sparse, +/-1 cm, near its 25 cm lower regime |
| iPhone TrueDepth (front camera) | structured light, the sensor SNAQ used [2] | More precise at 30 cm but it faces the user; capturing a plate with the selfie camera is not a real flow |
| iPhone dual / wide camera depth (AVDepthData disparity) | passive stereo between two lenses 1-2 cm apart | `[INFERENCE]` low-res, smoothed for portrait effects, close-focus limits on the tele lens. Not recommended |
| Android ARCore Depth API | depth from motion, ML-assisted; merges a ToF sensor when there is one. Depth needs the user to move the phone; "most accurate half a meter to about five meters"; featureless surfaces such as white walls are imprecise [12]. Depth API supported on over 88% of active ARCore devices (May 2026) [13] | At 30-40 cm over white rice this is the hardest case for it `[INFERENCE]`. Image is low-res, quality varies by phone. Only a handful of old flagships have ToF (S10 5G, Note10+, S20+/Ultra, A80, LG V60, AQUOS R5G in Google's list [13]) |
| Reference object: plate or card | known diameter turns pixels into cm (plate diameter, an ISO card 85.6x54 mm) | Gives area, not height. Cheapest on all devices. `Piring saya` (in flight) is this idea. Area x per-dish grams-per-cm2 sidesteps height `[INFERENCE]` |
| On-device monocular depth (Depth Anything V2-class via Core ML / LiteRT) | relative depth from one image, runs on any phone | Metric scale is missing (see MFP3D [7]); with a plate diameter you get lateral scale but height is still affine-ambiguous `[INFERENCE]`. Research-grade, not an MVP |

### On-device ML specifically

- **LiteRT/TFLite, Core ML, MediaPipe** are runtimes. They help in three places: (a) per-item masks (a class-agnostic segmenter such as MobileSAM/FastSAM, or MediaPipe's interactive segmenter `[INFERENCE]` that these exist in mobile form), (b) finding the plate ellipse and rim for the plane fit, (c) monocular depth as a no-sensor fallback. None of them knows grams by itself.
- We already get per-item boxes from the server model: the scan prompt asks for `box = [ymin,xmin,ymax,xmax]` on a 0-1000 grid (`packages/api/src/lib/vision.ts`), used today for crops. Box intersected with "above the plate plane" is a usable first mask, so Phase 1 needs no on-device segmenter. A segmenter only matters when boxes overlap (rice touching lauk).
- **Libraries for the Expo app:** `react-native-fast-tflite` (JSI, Nitro, zero-copy buffers) [14] for LiteRT; Core ML would be a local Swift module like `apps/native/modules/apple-health` and `apple-iap`. Android MediaPipe/LiteRT would need a Kotlin module; we have none yet.
- **Verdict:** on-device ML is a means. Do not start with it.

## 3. Device coverage in Indonesia

| Fact | Number | Source |
|---|---|---|
| iOS share of mobile web traffic, Indonesia, Sept 2026 | 20.79% (Android 79.16%) | StatCounter [15] |
| Vendor split, same month | Apple 20.78%, Samsung 14.15%, Oppo 11.83%, Xiaomi 10.85%, Vivo 9.21%, unknown 22.15% | StatCounter [16] |
| LiDAR | Pro / Pro Max iPhones since the 12 Pro (Oct 2020), iPad Pro; no non-Pro iPhone | [8][9] |
| Share of Indonesian iPhones that are Pro | not found | `[INFERENCE]` 25-40% |
| So LiDAR users | `[INFERENCE]` about 5-8% of mobile users (0.208 x 0.25-0.40). Web-traffic share skews rich and urban; our installed base may differ | |
| iPhone 16 availability | sale ban lifted, first sales 11 Apr 2025, so 16 Pro units before then were grey import | [17] |
| ARCore Depth API | over 88% of *active ARCore devices* (global, not Indonesia) | [13] |
| Depth API flag in Google's device list, by model row (not sales-weighted) | Samsung 195/264, Oppo 145/188, Vivo 201/240, Xiaomi 77/121, realme 56/96, Infinix 41/48, Tecno 45/53 | [13] |
| So ARCore-depth users | `[INFERENCE]` most mid-range Androids from about 2021 on, perhaps 60-70% of Android users; but quality is motion-dependent, no ToF on budget phones | |
| Our own device mix | **unknown.** `push_device` stores only platform (`packages/db/src/schema/push.ts`); the app ships `react-native-device-info` but nothing reports a model | measure it (below) |

Measure it from our data, not the market: the cheapest read is the iOS model identifier and Android brand/model, sent once and anonymously. Caution: `docs/ota.md` treats new data collection as a reviewed-build change (Data safety / privacy labels), so it belongs in the next store build, not an OTA. The only fact we need is one boolean per install (`lidar` / `arcoreDepth`).

## 4. UX friction

| | Today (`app/makan-ai.tsx`) | LiDAR iOS | ARCore Android |
|---|---|---|---|
| Capture | tap shutter, `expo-camera` `CameraView` 4:3, 1024 px JPEG, about 10 s round trip | hold 30-40 cm above, whole plate and rim in frame, hold still about 1 s while depth settles `[INFERENCE]` 1-2 s extra | sweep the phone for 1-2 s before depth is valid (docs: valid depth only after the user starts moving [12]); then hold `[INFERENCE]` 3-5 s extra |
| Angle | free; the model reads any angle | top-down or 45 degrees; SNAQ saw no accuracy effect between 45 and 90 degrees [2] | top-down preferred for the plane fit `[INFERENCE]` |
| Not available | gallery imports (`launchImageLibraryAsync`) and any photo not taken live in the app have no depth, so most "eating out later" photos fall back | same | same |
| Camera stack | `expo-camera` | cannot share its capture session with ARKit; needs a dedicated capture view (native) | same, ARCore session owns the camera |
| Failure modes | none that matter | concave plates and bowls, banana leaf and rattan plates lined with paper, plate rim out of frame, hands in view, stacked food | the same plus white rice without texture |

Fallback must be silent: no depth, low confidence or an ineligible item means the answer is exactly today's.

## 5. How it would plug into the pipeline

Facts from the code: the server returns per item `grams`, `kcal`, macros, `kind`, `box` (0-1000 grid) and, for flagged users, `portionPrior`. `calibrateItems` rescales kcal to the grams (library band scaled by grams, 9 kcal/g cap). The native client has the original photo and, with a new module, the depth frame of the same instant. `Porsi kebiasaanmu` (`docs/portion-prior.md`) already shows the pattern: a post-hoc default, the model's number one tap away, behind a Worker-var allowlist (`PORTION_PRIOR_USER_IDS`).

**Proposal (not built): post-hoc, on device, grams only.**

1. Capture RGB + depth together (native module); upload the 1024 px RGB exactly as today. The model call, prompt and cost do not change.
2. When the answer arrives, for each item that has a `box` and a food key with a density row (`canonicalFood` in `tkpi.ts`), the client computes from the local depth map: plate plane (RANSAC on the rim and gaps outside the food boxes), then volume = sum of height above plane over pixels in the box, above a small height threshold, times pixel footprint (the integral Nutrition5k used [1], the plane step SNAQ used [2]).
3. `grams = volume x bulkDensity[food]`. Send the server only numbers per item: `{ index, volumeCm3, footprintCm2, meanHeightMm, confidence }`. The depth map never leaves the phone.
4. The server (or the shared `portion-chip.ts` logic) turns that into a third choice next to "AI" and "Biasanya kamu": for example **Dari kedalaman: 98 g**, kcal recomputed through `calibrateItems`. Same chip UI, same one-tap switch.
5. Decision rules to test, not assume: use depth when confidence is ok and it lies within 0.5x-2x of the model; when a user prior exists and depth is within about 25% of it keep the prior; when depth exceeds the prior by 1.4x or more take depth (this replaces the prior's blind big-plate guard with a measurement).
6. Flag: a Worker var allowlist like the prior's (name it e.g. `PORTION_DEPTH_USER_IDS`), off for users, on for the owner and QA. Without the module the client simply sends no depth block.

Why not feed depth to the vision model: raw depth inputs are not something the hosted model takes, boxes arrive only after its first pass, and a second pass doubles latency and Workers AI spend. The Nutrition5k design (volume as a *number* next to the image) maps to our post-hoc chip.

### Density table (g/cm3) for Indonesian foods

Shape: `{ key (canonicalFood), bulkDensity { low, mid, high }, shape: mound | flat | pieces, eligible, basis }`, shipped as TypeScript in the JS bundle so it is OTA-updatable and tunable without a store build (only the capture module needs one). Use *bulk* density (it includes air gaps in a heap), not particle density.

Starting values from FAO/INFOODS Density Database v2.0 [18] (g/ml; I searched it for rice, noodles, cassava, potato, egg, chicken, tofu, tempeh, cabbage and similar; it has no row for tofu or tempeh):

| Food | Density | FAO row |
|---|---|---|
| nasi putih (boiled rice) | 0.73 (plain rice + water 0.70; rice with fat 0.70) | Rice, boiled (KEN, RC) |
| mie / bihun boiled | 0.59 (noodles with fat 0.80) | Pasta/noodles boiled (KEN); Noodles/pasta with fat |
| singkong rebus / ubi rebus / kentang rebus | 0.63 / 0.65 / 0.59 | Cassava, Sweet potato, Potato boiled (KEN) |
| telur rebus (whole eggs, bulk) | 0.60 | Egg, chicken, boiled/poached (FNDDS) |
| wortel parut | 0.71 | Carrot, raw, grated (KEN) |
| sayur daun mentah (lalapan) | 0.08 | Spinach leaves raw (RC): not measurable by volume |
| kuah / soto / sup | about 1.0 | soup rows (S&W): volume needs the bowl, ineligible |
| ayam goreng, tempe, tahu, telur dadar, sambal, tumisan | not in FAO | `[INFERENCE]` solid-ish pieces 0.9-1.1 but bone, crust and oil change it; weigh them |

Fill the rest by weighing, not guessing: for each library dish in `TKPI_DISHES`, 5-10 portions of known grams, measured volume by depth scan against water displacement or a measuring cup, record low/mid/high. Bone-in items need an edible-fraction column (MealScan3D overestimated chicken and pork by about 35-39% [3]; our own log already flags bone-in weights).

## 6. Cost

| Item | Detail |
|---|---|
| Native work | iOS: a local Expo module in Swift, like `apps/native/modules/apple-health` and `apple-iap` (podspec + `expo-module.config.json`): ARKit session with `.sceneDepth`, returns RGB + depth + confidence + intrinsics + camera pose to JS, small native preview view. `[INFERENCE]` 4-6 dev days. Android: Kotlin module around `Session`, `Config.DepthMode.AUTOMATIC`, `frame.acquireDepthImage16Bits()`, Play Services for AR install flow. `[INFERENCE]` 6-10 days and a test matrix of phones we may not own. We have no Android native module of our own yet |
| Volume math | plane fit, per-box integration, quality score, in TS (OTA-able) or native. `[INFERENCE]` 3-5 days including a harness variant |
| Density table | weighing sessions plus the table. `[INFERENCE]` 2-3 days of owner time for the main 20-30 dishes |
| Store builds | native code never ships over the air; `runtimeVersion` is the `fingerprint` policy so a new native module is a new runtime and needs a store build and review (`docs/ota.md`). iOS build on the Mac is about 15 min, review days. The capture screen needs a build; the math, density table and chip can go OTA afterwards |
| Binary and permissions | `[INFERENCE]` ARKit and ARCore need no new permission beyond the camera we already ask for; on Android `com.google.ar.core` would be declared `optional` so non-ARCore phones still install |
| Workers AI | unchanged: the model sees the same JPEG. Extra spend only for harness reruns |
| Test hardware | needs at least one LiDAR iPhone (Pro) and one mid-range ARCore Android. Not verified that we have either; the QA Android build exists (`preview` channel) |
| Eval data | the external contributor's photos have no depth, so they cannot test this. New cases need depth captured at weighing time; `docs/datasets.md` register needs a depth data type and consent line |

## 7. Privacy

- Depth map and RGB stay on the device; only per-item numbers (volume, footprint, mean height, confidence) go up. That is not a new data category beyond what a portion number already is `[INFERENCE]`; confirm against the Play Data safety form and Apple privacy label at submission.
- Android: Google requires an in-app disclosure that the app runs on Google Play Services for AR (ARCore) and how it processes data, prominently and easily reachable (for example on the main menu or a notice screen) [19]. ARCore is therefore a visible privacy surface, LiDAR/ARKit is not.
- Owner dataset and any consenting contributor: raw depth would go to the private `joyorogo-scans` bucket only under the existing opt-in/consent path, listed in `docs/datasets.md`; never committed (public repo).

## 8. Cheaper alternatives that take part of the gain

| Option | Status | What it covers | What it leaves |
|---|---|---|---|
| `Porsi kebiasaanmu` | landed, flag-off (`docs/portion-prior.md`) | regular eaters with 5+ typed/edited weights: rice MAE 43 g to 13 g in the harness | first scans, new dishes, eating out; big plates are pulled down (one 150 g plate answered 100 g, -33%) |
| `Piring saya` | in flight (reference-plate registry) | scale for users with a known plate | height; unknown plates |
| Count-based input ("2 sendok nasi") | not built | users who can count | still self-estimate |
| Footprint x areal density `[INFERENCE]` | idea | all phones, no sensor: plate ellipse from `Piring saya` gives cm per pixel, item box gives cm2, a per-dish g/cm2 gives grams | height variation inside a dish |
| Depth (this doc) | research | measured height on LiDAR phones | reach, effort, concave plates |

The footprint idea should be tried before depth: it needs only a plate reference, runs on every phone, and its error on flat, regularly plated foods is `[INFERENCE]` much smaller than the depth noise. It is not covered by the literature I found beyond the reference-object rows in section 1.

## 9. Phased plan and the MVP experiment

**Phase 0: offline feasibility (2-3 days, no store build, no code in the repo).** Do first, decide after.

1. Borrow one LiDAR iPhone. Capture raw RGB + depth with an off-the-shelf depth-capture app that exports the depth map and confidence (verify the exact app; Record3D is one candidate) or a throwaway Swift test app kept outside the repo.
2. **Noise floor:** an empty flat plate and a flat table, 30, 40, 50 cm, hand-held and propped, 20 captures each. Fit a plane, report the standard deviation and bias of height residual in mm. This is the number that decides everything (breakeven about 7 mm, good under 4 mm, section 1).
3. **Known volumes:** a measuring cup of packed rice, a mound of rice shaped with a measuring spoon, an egg, a block of tempe, a 250 ml measuring cup of packed rice unmolded onto a plate. Avoid water and glossy or transparent items: they confuse a depth sensor `[INFERENCE]`. Compare scanned volume to known volume.
4. **Real food:** 30 plates, weighed on a kitchen scale per item (1 g), rice at 60 / 100 / 150 / 200 g, ayam goreng with and without bone, tempe, tahu, telur dadar, tumisan, mie; flat melamine plate, rattan plate with paper, one bowl as the failure case. Photo each plate from the real scan angle; run the same JPEG through `analyzeFood` (a few cents for 30 photos, `[INFERENCE]` from the per-run cost in the accuracy log) for the model baseline on the same plates.
5. Offline script (Python, not committed) computes plate plane and per-box volume; apply density from section 5; report per item signed and absolute error, by food, for model vs depth vs depth-with-prior. If the reference weights and labels follow the external-case format (`docs/datasets.md`) the harness can score them later.

**Go/no-go for Phase 1** (all of): empty-plate mean height error <= 5 mm at 35-40 cm; rice and solid lauk MAE <= 20% or 15 g (model: +45%/43 g for rice); depth better than the model on at least 70% of eligible items; 5 s or less added capture time; and at least a third of plates by the owner's real warteg/home meals eligible (flat plate, visible, separable). If it fails, stop and spend the effort on the footprint path and `Piring saya`.

**Phase 1: iOS shadow capture (about 2 weeks of work, one store build).** Swift module + capture screen, allowlisted, no UI change for users. Records per scan, for the owner and consenting testers only, the numbers from section 5 beside the model's answer and what the user finally saves. Also in the same build: the one-boolean capability ping (`lidar`, `arcoreDepth`) so we learn our true reach.

**Phase 2: show it (OTA after the build).** "Dari kedalaman" chip behind the allowlist, harness variant `depth-volume` on the cases collected in Phase 1 plus new weighed days. Tune the decision rules in section 5 with the prior. Criterion to widen the flag: depth chip accepted over the model's number on at least half of tapped cases and no rise in under-estimates (the owner prefers over to under).

**Phase 3: widen or stop.** If Phase 2 holds, open to all LiDAR iPhones. Android ARCore only with its own noise-floor test on 2-3 mid-range phones from Google's list; otherwise Android users stay on prior + plate reference. On-device segmentation (LiteRT/Core ML) only if overlapping items make the box mask the dominant error.

## 10. Risks and open questions

- The noise floor may be above 7 mm; then LiDAR is useless for portions and we stop at Phase 0.
- Eligibility: bowls and soups, covered or stacked food, mixed items are out; if less than a third of real plates qualify the gain does not justify native work.
- Density and edible fraction (bone, crust, oil) may add more error than depth removes for meat.
- Selection bias: users with LiDAR iPhones are richer, may eat differently from our weighed contributor.
- Two-hands UX: a deliberate scan mode is slower than snapping; adoption may be low even for supported phones.
- App review: a new native module, an ARKit usage and (Android) an ARCore disclosure need a reviewed build.
- Do we have a LiDAR iPhone and a mid-range ARCore phone in hand? Unverified here.

## Sources

1. Thames et al., *Nutrition5k*, CVPR 2021. https://arxiv.org/html/2103.03375v2 (Tables 3-4, section 4.6)
2. Herzig et al., *Volumetric Food Quantification Using Computer Vision on a Depth-Sensing Smartphone*, JMIR mHealth uHealth 2020;8(3):e15294. https://pmc.ncbi.nlm.nih.gov/articles/PMC7142738/
3. Schenk et al., *3D images and food descriptions from a smartphone device ... for dietary assessment* (MealScan3D), Nutrients 2024;16(6):828. https://pmc.ncbi.nlm.nih.gov/articles/PMC10976213/
4. SnapCalorie FAQ (accuracy claim). https://www.snapcalorie.com/faq.html
5. TechCrunch, 2023-06-26 (depth sensors on supported devices, human reviewers). https://techcrunch.com/2023/06/26/snapcalorie-computer-vision-health-app-raises-3m/
6. Survey of image-based food recognition and volume estimation, Healthcare 2021 (Table 7, single-view methods). https://pmc.ncbi.nlm.nih.gov/articles/PMC8700885
7. Ma et al., *MFP3D: Monocular Food Portion Estimation Leveraging 3D Point Clouds*, 2024. https://arxiv.org/html/2411.10492v1
8. Luetzenburg, Kroon, Bjork, *Evaluation of the Apple iPhone 12 Pro LiDAR for an Application in Geosciences*, Sci Rep 2021. https://www.nature.com/articles/s41598-021-01763-9
9. Apple, *Explore ARKit 4* (WWDC20 10611): `sceneDepth` on LiDAR devices. https://developer.apple.com/videos/play/wwdc2020/10611/ ; 256x192 at 60 fps per an Apple developer forum thread, https://developer.apple.com/forums/thread/712943
10. *Mobile Food Calorie Estimation Using Smartphone LiDAR Sensor*, ACPR 2025 (full text not accessible to me). https://dl.acm.org/doi/10.1007/978-981-95-4398-4_10
11. Depth map format and confidence map: https://www.it-jim.com/blog/iphones-12-pro-lidar-how-to-get-and-interpret-data/
12. Google, ARCore Depth API overview. https://developers.google.com/ar/develop/depth
13. Google, ARCore supported devices (per-model Depth API and ToF notes, "over 88% of active devices as of May 2026"). https://developers.google.com/ar/devices
14. react-native-fast-tflite. https://github.com/margelo/react-native-fast-tflite
15. StatCounter, mobile OS share, Indonesia. https://gs.statcounter.com/os-market-share/mobile/indonesia
16. StatCounter, mobile vendor share, Indonesia. https://gs.statcounter.com/vendor-market-share/mobile/indonesia/2025
17. Nikkei Asia, iPhone 16 Indonesia debut after sales-ban lift. https://asia.nikkei.com/business/technology/iphone-16-makes-indonesia-market-debut-after-lifting-of-sales-ban
18. FAO/INFOODS Density Database v2.0 (2012). https://www.fao.org/fileadmin/templates/food_composition/documents/density_DB_v2_0_final-1__1_.xlsx
19. Google, ARCore user privacy requirements. https://developers.google.com/ar/develop/privacy-requirements
