# Third-party brand marks

JoyoRogo shows a few third-party marks in Profil (native hub `/profil`, web hub `/profil`). They identify the service a row
or screen talks to. Each owner's rules below are binding; do not restyle, recolor, mask, animate or redraw them. JoyoRogo is
not sponsored or endorsed by any of these companies (NOTICE).

## Where each mark lives

| Brand | Native | Web | Source |
|---|---|---|---|
| Strava, `Connect with Strava` button | `assets/images/brand/connect-with-strava.png` (+ `@2x`), the connect control in `components/strava-card.tsx` | `public/brand/connect-with-strava.svg` | Strava API brand kit |
| Strava, `Powered by Strava` | `assets/images/brand/powered-by-strava.png`, bottom of `app/profil/strava.tsx` | `public/brand/powered-by-strava.svg`, bottom of the Strava section | Strava API brand kit |
| Strava symbol tile (row/section head) | `components/brand-mark.tsx` (react-native-svg) | `components/kit/brand-mark.tsx` (inline SVG) | see "Judgement call" |
| Google Health Connect icon | `assets/images/health-connect.png` via `BrandMark`, **Android only** | not used (no Health Connect on web) | developer.android.com Health Connect UI guidelines |
| Apple Health icon | `assets/images/brand/apple-health.png` via `BrandMark`, **iOS builds only** | never | Apple Design Resources (`Icon-Apple-Health`) |
| Claude, ChatGPT, Huawei | none, plain text | none, plain text | n/a |

`BrandMark` (native) renders `strava`, `healthConnect` and `appleHealth` at 36 px; `HEALTH_BRAND` picks Apple Health on iOS and
Health Connect everywhere else. The mark is always shown next to the brand name used as the row title.

## Rules per brand

### Strava (<https://developers.strava.com/guidelines/>)
- `Connect with Strava`: use the supplied artwork unmodified, height 48 (the PNG is 237x48 with a 2x file; the SVG is the same
  artwork). It is the connect control: tapping it must open Strava's OAuth (`strava.authorizeUrl`, which points at
  `strava.com/oauth/authorize` / `/oauth/mobile/authorize`). While a request is in flight it is dimmed and ignores taps; the
  artwork is never swapped for a spinner.
- `Powered by Strava` (JoyoRogo reads Strava data; JoyoFit uses `Compatible with Strava` because it uploads): smaller and less
  prominent than JoyoRogo's own name, separate from JoyoRogo branding, never modified or animated, never used as an app icon,
  never implies Strava sponsorship. The "powered by" text is black, so on the native dark theme it sits on a white plate.
- Do not use the Strava name or logo as the name of JoyoRogo features or in marketing without Strava's approval.
- Imported Strava activities are kept for 7 days (API terms); the retention notice on the Strava screen stays.

### Google Health Connect (<https://developer.android.com/health-and-fitness/health-connect/ui-guidelines>)
- Use Google's icon unmodified (the PNG already carries its own shape), the name "Health Connect" next to it, Android only.
  The icon is transparent with a dark teal half; on native it sits on a white 36 px tile so it stays legible in dark mode. The
  artwork itself is not altered.

### Apple Health (HIG for HealthKit; HealthKit Developer Artwork License)
- Only in the UI of builds running on iOS (`Platform.OS === "ios"`), only to indicate that the app uses HealthKit.
- Show it unmasked: square with its own rounded corners, 36x36, never inside a round chip, no border, shadow, tint or overlay.
- Show the words "Apple Health" next to it; keep clear space of at least 1/10 of the icon height; do not use it as a button.
- Do not redistribute the artwork outside the app, and never put it on Android or web.

### Claude / ChatGPT / Huawei
- Koneksi AI is a generic MCP connector, so it keeps a neutral sparkles icon and names Claude and ChatGPT in plain text.
  Anthropic's and OpenAI's marks are for their own services and partners.
- Huawei is a trademark used nominatively only.

## Judgement call: the Strava symbol tile

Strava's API kit ships only wordmark lockups, no stand-alone symbol. The hub rows and the Strava screen head use the Strava
chevron symbol, white on `#FC5200`, in a 36 px rounded square (radius 9), as a factual reference to the service. It is not
an app icon and not the `Connect with Strava` or `Powered by Strava` artwork. If Strava objects, replace it with the `Powered
by Strava` lockup or a neutral icon: only `BrandMark` (native) and `kit/brand-mark.tsx` (web) need to change.

## Adding a mark

1. Get the artwork from the owner's brand kit, never from a screenshot or an icon font.
2. Add the owner's rules to this file before the first use.
3. Add it to the single `BrandMark` of each app that needs it; never import the asset elsewhere (the connect and powered-by
   artwork are the only exceptions, because they are controls/attributions, not tiles).
