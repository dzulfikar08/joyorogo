# Push notifications

JoyoRogo's server is the hub. One JoyoRogo account has browsers (Web Push), JoyoRogo phones and JoyoFit phones registered
(Expo push tokens); every event is turned into a notification by one pipeline that applies the person's switches, quiet
hours and daily caps, then fans out. JoyoFit keeps its own family alerts on its own server (`watch-fit/server`, see its
`docs/family-monitoring.md`); everything social, group and reminder-like goes through here.

Code: `packages/api/src/lib/notify.ts` (pipeline), `expo-push.ts` (Expo client), `webpush.ts` (VAPID sender),
`reminders.ts` (server reminders), `push-cron.ts` (the five-minute tick), `social-push.ts` (event builders),
`push-link.ts` (where a tap goes), router `packages/api/src/routers/push.ts`, tables `packages/db/src/schema/push.ts`
(migration `0052_push_notifications`), copy `packages/i18n/src/locales/{id,en}/push.json` (`notify.*`, server side) and
`notifications.json` (settings screens, web and native).

## Pipeline

```
notify(userId, event)
  category switch off, or no browser/phone to reach  -> nothing stored (two reads)
  same dedupeKey seen before                          -> nothing happens ("duplicate")
  row written to push_outbox, then delivered at once unless
    quiet hours (default 21:30-06:30 WIB, adjustable)  -> row waits until they end ("queued", cron delivers)
    category daily cap used up                         -> social/group: "digest", others: "dropped"
  fan-out (see Targets)                                -> "sent" (tickets kept for receipts)
  transient failure                                    -> back to "queued" with backoff 5/10/20 min, 4 attempts, then "failed"
  dead token (web 404/410, Expo DeviceNotRegistered)   -> token deleted
```

Settings are read when the row is delivered, not when it is stored, so a retry or a late flush meets the person's
current switches and quiet hours. `kind: "digest"` rows and the test push never count against the cap; the test push
(`push.sendTest`) also ignores switches and quiet hours.

Fan-outs that would cost hundreds of subrequests inline (new post to followers, new challenge to a group) are stored
with `enqueueMany` and delivered by the cron: `flushOutbox` takes up to 100 due rows per round, four rounds per tick,
and does the audience lookups, the cap counts, one Expo call per round and the closing writes in bulk.

`collapse_key`: waiting rows of one person with the same key are replaced by the newest (several kudos on one post that
wait out the night become one).

### Targets

- Events written for JoyoFit (`app: 'joyofit'`: comments and kudos on a post the JoyoFit watch made, recognised by
  `stats.source = 'joyofit'`) go to the person's JoyoFit phones when any is registered, else to JoyoRogo.
- Everything else goes to the browsers and the JoyoRogo phones. A person who only has JoyoFit gets the social events
  there (post, profile, feed, group links, which JoyoFit can open) and nothing else.
- Browsers count only while `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` are set.
- Android `channelId`: JoyoRogo phones get the category (`social`, `group`, `meal`, `weigh`, `recap`), JoyoFit phones
  `social` (JoyoFit's family alerts keep `family`).

### Quiet hours, caps, digest

| Category | Daily cap (WIB day) | Over the cap |
|---|---|---|
| social | 10 | digest |
| group | 8 | digest |
| meal | 2 | dropped |
| weigh | 1 | dropped |
| recap | 2 | dropped |

From 19:00 WIB `runDigest` sends one push per person and category for what the cap held back today ("3 notifikasi
sosial lainnya", link to the notification list / group inbox). Held rows of an earlier day are dropped, not digested.
Quiet hours are per account (`push_prefs`), default 21:30 to 06:30 WIB, switchable, start later than end wraps midnight.
Everything queued during them goes out at the end time; the cron spreads a morning rush over a few ticks.

### Failure handling

- Expo: one HTTP call per round (100 per request). A failed call or `MessageRateExceeded` is transient, other ticket
  errors are not. Tickets (ticket id + device id) are kept on the row; `checkReceipts` reads them 15 minutes to a day
  later and deletes devices that FCM / APNs refused (`DeviceNotRegistered`).
- Web Push: 404/410 deletes the subscription, 0/429/5xx is transient, anything else drops.
- `push_outbox` rows older than 14 days that are not waiting are deleted (first tick after midnight WIB).

## Events

All categories default ON. "Cap" is the category cap above; "limit" is an extra rule of the event itself.

| Event | Category / kind | Who | Rule | Link (tap) |
|---|---|---|---|---|
| Kudos on a post | social / `kudos` | post author | the existing 1 h throttle per actor and post; collapse per post | post |
| Comment | social / `comment` | post author (not when they are the one answered) | once per comment | post thread |
| Reply | social / `reply` | whoever was answered | once per comment | post thread |
| Mention (@) | not sent | | There is no @mention parsing today (`body` carries none, `replyTo` is the structure); a reply push covers "someone answered you". Add the kind when mentions exist. | |
| New follower | social / `follow` | the followed | one per follower per WIB day | follower's profile |
| New post from someone you follow | social / `post` | followers who may see the post (public: all; group-only: shared team), not blocked, with Sosial on | at most 1 per author per follower per 6 h; at most 200 followers per post; delivered by the cron (up to 5 min) | post |
| Poke | group / `poke` | the poked | the existing 1 h limit per pair | group inbox |
| Note | group / `note` | the recipient | the existing 20 notes a day quota | group inbox |
| Someone joined your group | group / `member_join` | the group's owner | once per member and group | group |
| Challenge created | group / `challenge_new` | the other members | once per challenge; cron delivery | challenge |
| Someone joined your challenge | group / `challenge_join` | the host | once per person and challenge | challenge |
| Challenge ended | group / `challenge_end` | members, the morning after the end date, 08:00-10:00 | once per challenge | challenge |
| Nothing logged by lunch | meal / `meal_noon` | people with no `food_log` row today at 13:00-13:45 | 1 per day | Makan |
| Nothing logged all day | meal / `meal_evening` | same at 20:00-20:45 | 1 per day | Makan |
| Streak at risk | meal / `streak` | the evening slot, when today has no food or weigh-in and the streak (food or weigh-in per day, `day.summary` semantics) is 3 days or more | replaces `meal_evening` for that person | Makan |
| Not weighed in N days | weigh / `weigh` | 07:30-09:00, after 7 days without a weigh-in (counted from the account when never weighed), then at most once per 7 days | skipped for Hamil/Menyusui | Berat |
| Weekly recap ready | recap / `recap` | Mondays 08:00-10:00, people who logged food on 2+ days of the past 7 | 1 per week | Rekap |
| Calibrated target changed | recap / `calibration` | daily 08:30-10:00, when `calibrationNotice` would show (50 kcal or more since the figure the person last acknowledged) | once per from/to pair; each person is looked at on one tick of the window (hash of the user id) | Beranda |
| Meal plan ready | recap / `plan` | Mondays 07:30-09:30, Pro accounts with a plan covering today | 1 per week | Rencana makan |

Reminder rules (`reminders.ts`, pure pieces are unit tested):

- The cron looks at each reminder inside its WIB window every tick; a per-day dedupe key makes it fire once, a skipped
  tick only delays it, and a reminder delivered more than 30 minutes after its window closed is dropped as stale.
- Only people who still use the app: food logged within 14 days, or an account younger than that. Nobody is nagged after
  two weeks of silence.
- Intermittent fasting (not Ramadan, not Hamil/Menyusui): no food reminder outside the eating window (a lunch nudge to an
  18:00 OMAD window, an evening one after a 12:00-20:00 window closed). Ramadan: no lunch reminder, the evening one stays.
  Hamil/Menyusui never fast, so a leftover pattern setting is ignored; they get no weigh-in reminder (the plan has no
  weight target) but do get the food ones.
- Everything is WIB, like the rest of the app; the quiet hours check applies on top (`meal` windows are before 21:30).

### Local reminders: skipped, not migrated

The native app's own scheduled reminders (`apps/native/src/lib/notifications.ts`: per-meal times, water, weigh-in,
Naikin BB evening, IF window) stay local: they work offline, at the person's own times, and cancel themselves once the
meal is logged. The reminder choices already sync to the account (`sync_record` rogo/pref/`reminders`), so the server
reads them and steps aside instead of doubling: the lunch reminder is skipped when the person's `meals.makan_siang` is on,
the evening one (and streak) when `meals.makan_malam` is on, the weigh-in one when `weighIn` is on. Breakfast, water,
Naikin BB and the IF window reminders have no server counterpart. The fasting window reminders for browsers
(`runFastingReminders` in `apps/server/src/index.ts`, `profile.fastingNotify`) are unchanged: web only, outside this
pipeline (no quiet hours or caps), because native already schedules them locally.

## API (`push` router)

| Procedure | Input | Output |
|---|---|---|
| `prefs` | | `{ social, group, meal, weigh, recap, quiet: { enabled, start, end }, devices: { web, joyorogo, joyofit } }` |
| `setPrefs` | partial of the same (times `HH:MM`) | the full prefs |
| `registerDevice` | `{ app: 'joyorogo' \| 'joyofit', platform: 'android' \| 'ios', expoToken, locale? }` | `{ ok }`; upsert by token (a token that moves to another account leaves the first), five phones per account and app |
| `unregisterDevice` | `{ expoToken }` | `{ ok }` (own tokens only) |
| `vapidPublicKey` | | `{ key \| null }` |
| `subscribeWeb` / `unsubscribeWeb` | `{ endpoint, keys }` / `{ endpoint }` | `{ ok }` |
| `sendTest` | | `{ status, reached }` (`skipped` = nothing registered) |

`fasting.subscribePush/unsubscribePush/vapidPublicKey` stay for browser tabs opened before this change (same storage).

Payload on the device (Expo `data`, and next to `title`/`body`/`url`/`tag` for Web Push): `{ v: 1, kind, link, url, app }`.
`link` is a `PushLink` (`push-link.ts`): `post` (+ `commentId`), `profile`, `feed`, `inbox`, `group`, `challenge`, `makan`,
`berat`, `rekap`, `beranda`, `rencana`, `settings`. `parsePushData` validates and rebuilds `url`; `nativeHref` gives the
Expo Router href in JoyoRogo native; JoyoFit maps `post`/`profile`/`group`/`feed` to its `/social/*` screens and sends
everything else to `/social`.

## Clients

- Web: `apps/web/src/lib/push.ts` (permission, service worker, subscription), Pengaturan > Notifikasi
  (`/profil/notifikasi`), the fasting card reuses the same module. `public/sw.js` shows `title`/`body`/`tag` and opens
  `data.url` on a tap (same origin only).
  Subscriptions are per origin: since the app moved to `app.joyorogo.com`, `components/push-move-banner.tsx` asks people
  with a registered browser to subscribe again on the new host (`docs/app-subdomain.md`).
- JoyoRogo native: `src/lib/push.ts` (channels, token, registration once a day and on sign-in / foreground / language
  change, unregister on sign-out), `src/lib/push-tap.ts` + `components/push/push-tap-handler.tsx` (taps and cold start),
  `app/profil/notifikasi.tsx` (permission sheet, switches, quiet hours, test). Local reminders are untouched.
- JoyoFit: `src/features/social/pushRegister.ts` registers its token with JoyoRogo through `rogoCall`, `pushLink.ts`
  routes taps, `SocialPushSection` in Settings > Notifications shows Sosial / Grup and the test button. Details in
  JoyoFit's `docs/app-reference.md`.

Old binaries: no token means no registration and nothing is sent to that phone; web is unaffected.

## Credentials and setup (status)

- Expo: `EXPO_ACCESS_TOKEN` is optional (only for "enhanced push security", which is off for the JoyoFit project; the
  JoyoRogo project's setting is not readable through the API, check Project settings > Notifications on expo.dev; when
  it is on, set the secret to an access token of the account that owns both projects). `EXPO_PUSH_URL` overrides the
  send origin for tests.
- Android (FCM v1): the Firebase project `joyorogo` has Android apps `com.joyodigitama.joyorogo` and
  `com.joyodigitama.joyorogo.qa` (the QA build's package); `apps/native/google-services.json` (client identifiers only,
  committed like JoyoFit's) is referenced by `android.googleServicesFile`. The existing `firebase-adminsdk` service
  account key of that project is attached in EAS to `@dzulfikar08/joyorogo` for both package ids.
- iOS (APNs): the account's push key `VRR257ALLP` (Apple team `F6Q6UFUK69`, the one JoyoFit uses; one key serves every
  app of the team) is attached to the EAS iOS credentials of `com.joyodigitama.joyorogo`. The `expo-notifications` plugin
  adds the push entitlement; the App ID needs the Push Notifications capability when the next iOS build is signed.
- Both need a new native build of JoyoRogo (FCM config, entitlement). JS parts degrade quietly on the current binaries.

## Deploy order

1. Apply the D1 migration `0052_push_notifications` (additive: three new tables).
2. Deploy the server (new `push` router, cron step, event wiring). Old clients keep working; nothing is pushed to
   phones until tokens are registered.
3. Deploy the web app.
4. New JoyoRogo native builds (FCM / entitlement) and an OTA for the JS; JoyoFit ships by OTA (its binary already has
   notifications and FCM).
5. Optional: `EXPO_ACCESS_TOKEN` if the JoyoRogo project has enhanced push security.

## Tests

`bun test src/lib/notify.test.ts src/lib/reminders.test.ts src/lib/expo-push.test.ts src/lib/push-link.test.ts` and
`bun test src/routers/push.test.ts` in `packages/api` (pipeline, quiet hours, caps and digest, fan-out per app, dedupe,
dead tokens and receipts, retries, web push, reminder windows and skip rules, registration, event wiring); the tap
routing of native in `apps/native/src/lib/push-tap.test.ts`.
