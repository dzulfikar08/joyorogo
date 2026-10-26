# UTM convention (JRG-131)

One set of tags for every link we post or ship, for JoyoRogo and JoyoFit. RevKlik (site id
`88069ee9-6eac-4dc9-a23b-f5757a4b948e`, script `https://app.revklik.com/klikapa.js`) is loaded on joyorogo.com and
fit.joyorogo.com. It reads `utm_source`, `utm_medium`, `utm_campaign` and `utm_content` from the landing URL and reports them
under campaigns and referrers. It does not see anything that happens inside Play or the App Store, so those two use their
own mechanisms (below). Click goals on buttons use `data-revklik-goal` / `data-revklik-goal-location`; they are separate from UTM.

Always lowercase, ASCII, hyphens inside a value, no spaces.

## utm_source: where the link was posted

| Value | Use for |
| --- | --- |
| `threads` | Threads posts and replies |
| `instagram` | Instagram posts, stories, reels |
| `tiktok` | TikTok captions |
| `whatsapp` | WhatsApp status, groups, broadcasts |
| `strava` | The opt-in line in uploaded Strava activity descriptions |
| `joyofit` | Cross-app: links from JoyoFit (app or fit.joyorogo.com) to JoyoRogo |
| `email` | Email we send |

JoyoRogo linking to JoyoFit uses `utm_source=joyorogo`. Add new sources to this table before using them.

## utm_medium: how it was posted

| Value | Meaning |
| --- | --- |
| `social` | A normal post or caption |
| `bio` | Profile bio link |
| `dm` | Direct message or private chat |
| `referral` | A link placed on another page, including a Strava description |
| `app` | A link opened from inside one of our apps |

## utm_campaign: `<yyyy-mm>-<topic>`

Month the campaign started plus a short topic: `2026-10-launch`, `2026-11-ramadan-diary`. Links that live in code for
years (app cards, site buttons, the Strava description) are not dated; use `evergreen-<where>`, for example
`evergreen-today-card`.

## utm_content: post id

Optional. Identifies the single post or variant: the platform post id or a short slug (`abc123`, `reel-a`). Use it when the
same campaign runs several posts.

## Play Store

Play drops UTM parameters on the listing URL. Pass them in `referrer`, URL-encoded (`=` as `%3D`, `&` as `%26`), so they
show up in Play Console acquisition reports and in the install referrer:

```
https://play.google.com/store/apps/details?id=<package>&referrer=utm_source%3Dthreads%26utm_medium%3Dsocial%26utm_campaign%3D2026-10-launch
```

Packages: JoyoRogo `com.joyodigitama.joyorogo`, JoyoFit `com.joyodigitama.joyofit`.

## App Store

Apple uses a campaign token, `ct=`, up to 100 characters, no spaces. App Store Connect groups it as the campaign name.
Source and medium do not exist there, so put the source in the token: `ct=<source>-<yyyy-mm>-<topic>`.

```
https://apps.apple.com/id/app/id6823222101?ct=threads-2026-10-launch
```

## Ready-made links

Replace `2026-10-launch` and the source/medium per post. The rows below are for a Threads post (`threads`, `social`);
swap `utm_source` and `utm_medium` for other channels (bio link: `utm_medium=bio`).

| Destination | Link |
| --- | --- |
| JoyoRogo web | `https://joyorogo.com/?utm_source=threads&utm_medium=social&utm_campaign=2026-10-launch` |
| JoyoFit web | `https://fit.joyorogo.com/?utm_source=threads&utm_medium=social&utm_campaign=2026-10-launch` |
| JoyoFit guide | `https://fit.joyorogo.com/panduan?utm_source=threads&utm_medium=social&utm_campaign=2026-10-launch` |
| JoyoRogo on Play | `https://play.google.com/store/apps/details?id=com.joyodigitama.joyorogo&referrer=utm_source%3Dthreads%26utm_medium%3Dsocial%26utm_campaign%3D2026-10-launch` |
| JoyoFit on Play | `https://play.google.com/store/apps/details?id=com.joyodigitama.joyofit&referrer=utm_source%3Dthreads%26utm_medium%3Dsocial%26utm_campaign%3D2026-10-launch` |
| JoyoRogo on the App Store | `https://apps.apple.com/id/app/id6823222101?ct=threads-2026-10-launch` |

## Already applied in code

| Where | Link tags |
| --- | --- |
| JoyoFit app, Today card (diary, site, Play) | `utm_source=joyofit&utm_medium=app&utm_campaign=evergreen-today-card` (Play via `referrer`) |
| JoyoFit app, Settings cloud section to `/pro` | `utm_source=joyofit&utm_medium=app&utm_campaign=evergreen-cloud-settings` |
| fit.joyorogo.com to `/harga` | `utm_source=joyofit&utm_medium=referral&utm_campaign=evergreen-site-cloud` |
| joyorogo.com iPhone buttons (landing, footer, blog) | `ct=joyorogo-evergreen-web` (`apps/web/src/lib/store-urls.ts`) |
| JoyoRogo app, update gate on iPhone (`/api/config` `app.ios.storeUrl`) | `ct=joyorogo-evergreen-update` (`apps/server/src/app-version.ts`) |
| Broadcast email default campaign | `ct=email-2026-10-broadcast` (`apps/server/src/broadcast-campaign.ts`) |
| Strava activity description (opt-in) | `fit.joyorogo.com/?utm_source=strava&utm_medium=referral&utm_campaign=evergreen-description` |
