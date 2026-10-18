# Route map on workout posts

Workout posts that JoyoFit makes (`createWatchPost`, `stats.source = 'joyofit'`) show a route map in the feed card, a larger one on the post
page, and a stats row: distance, time, pace (run, walk) or speed (ride), elevation gain, then energy and heart rate. JoyoRogo web, JoyoRogo
native and JoyoFit draw the same thing from the same data.

Code: `packages/api/src/lib/feed-route.ts` (math, shared by server, web and native; JoyoFit keeps a verbatim copy at
`src/features/social/feedRoute.ts`), `packages/api/src/routers/social.ts` (`createWatchPost`, `feedStats`, `workoutDetail`, `setPostMap`,
`updateProfile.shareMaps`), `apps/web/src/components/feed/route-map-preview.tsx`, `apps/native/components/feed/route-map-preview.tsx`,
JoyoFit `src/features/social/RouteMapPreview.tsx`.

## Rendering choice: an SVG polyline on a styled background, drawn by the client

The line travels inside the feed item. At post time the server turns the route into the **shared line**: the first and last 200 m cut
off (`MAP_TRIM_M`, the same trim as the sticker engine's route privacy), reduced with Douglas-Peucker to at most 100 points, and encoded as a
Google polyline at 5 decimals (about 1 m). It is stored once in `post.stats_json` (`mapLine`, plus `hasMap` and `showMap`) and goes out as
`mapLine` on the feed item (about 500 bytes). Each client decodes it, fits it into a box (`projectRoute`) and draws one SVG path with a start
and a finish dot over a faint grid.

| Option | Why not |
|---|---|
| Server-rendered PNG in R2 | Needs a wasm rasteriser in the Worker (about 1.5 MB of bundle, tens of ms of CPU per post), tiles to put under it (OSM's tile policy does not allow bulk use; OpenFreeMap is for interactive maps), an R2 write per post and one extra image request per card (15 to 40 KB) that is 30 to 80 times the size of the line. |
| Client MapLibre / PMTiles per card | 100 to 300 KB of vector tiles per card, per scroll, and one WebGL context per card. Right for one detail screen (the analysis map, which stays), wrong for a list of ten. |
| SVG polyline from the shared line (chosen) | No extra request, no tiles, no R2, no CPU at read time (the line is computed once, at post time, in under a millisecond), identical on web, native and JoyoFit, works offline once the feed is loaded, tiny payload. |

Cost per feed page of ten posts: at most 5 to 7 KB extra JSON when all ten are workouts with GPS, zero extra D1 rows (it is already in
`stats_json`), zero R2 operations, zero tile requests.

## Privacy

- **Trim.** The shared line never contains a fix from the first or last 200 m of the route (tested). A route shorter than 450 m has no map.
- **Simplified only.** Other people never receive the stored route or the analysis track. `social.workoutDetail` for anyone but the author
  returns `route` = the shared line (decoded) and `analysis.series.track = null`; the author gets everything, as before. The full-resolution data
  stays in `post_workout_detail`.
- **Per-post switch.** `stats.showMap`, default on for a workout with GPS. JoyoFit's share sheet has it ("Tampilkan peta" / "Show map"; off
  also leaves the route out of the shared detail); the author flips it later from the post menu (web, native) or the post page (JoyoFit):
  `social.setPostMap({ postId, show })`, author only.
- **Account switch.** `profile.share_maps` (migration 0046, default on): "Peta rute di postingan" in the feed settings of JoyoRogo web and
  native and on JoyoFit's own-profile screen (`social.updateProfile({ shareMaps })`). Off hides the map of every post of that account, for
  everyone including the author's own feed, and the same gate applies to `workoutDetail`'s route. `mapAllowed(post.showMap, author.shareMaps)`
  is the one rule; `toFeedItem` and `workoutDetail` both use it.
- **Strava.** Strava data is owner-only (`docs/strava.md`: never in groups, feed or shares) and `createWatchPost` only takes what JoyoFit
  recorded itself (`canShareToRogo` refuses imported rows). No Strava-sourced post can exist, so none has a map.
- **Indoor and strength posts** have no `mapLine` and keep their rendering. The muscle map of a strength post exists on web only and needs a
  set-to-muscle lookup on the server and a native component; that is not cheap, so it is not part of this change.

## Data

`stats_json` of a watch post gained `sportKind` (`run|walk|ride|swim|other`, from the analysis or guessed from the sport name),
`movingSec`, `elevGainM` (both only when JoyoFit sent an analysis), and, when a map exists, `hasMap`, `showMap`, `mapLine`. Pace and speed are
computed by the client with `paceOrSpeed` (run and walk: pace per km; ride: km/h; other sports: none). `mapLine` is stripped from `stats`
before the item leaves; it is a top-level `mapLine` and only when the gate allows it.

Posts made before this change have no line. `post.stats_json` of the existing watch posts was backfilled once from their stored route or
analysis (same function), so they gained a map the same way new ones get it.

## Screenshots

Taken on the deployed web with the QA account (`qa@joyorogo.com`), test posts deleted afterwards: `docs/img/feed-maps-web-feed.png` (cards: a ride and a run
with their map, an indoor run without one), `feed-maps-web-menu.png` (own-post menu, "Hide map"), `feed-maps-web-settings.png` (account switch),
`feed-maps-web-post.png` (post page as its author: the analysis draws its own tile map, so the shared line is not drawn twice) and
`feed-maps-web-post-public.png` (the same page for a signed-out visitor: the larger map, start and finish, the hint and the Pro card). JoyoFit's
renders are in `watch-fit/docs/screenshots/social-route-map-{light,dark}.png`.

A signed-out visitor of a public workout post used to be sent to `/login`: the post's detail query answers 401 for them and the global
`onUnauthorized` handler treats any 401 as an ended session. `WatchDetail` now marks that query `meta.allowAnonymous`, so the visitor stays on the page and
sees the map and the Pro card.

## Tests

`packages/api/src/lib/feed-route.test.ts` (trim at 200 m, simplification and point cap, polyline codec, `buildFeedMapLine`, the gate, pace and
speed, projection) and `packages/api/src/routers/watch-social.test.ts` ("route map on a workout post: privacy": trimmed line for a teammate, the
stored fields never leave, per-post switch, account switch, too-short route, analysis track as the source; `workoutDetail` never returns the
track to others). JoyoFit has the same `feedRoute.test.ts`.

## Rollout

Migration 0046 first (`wrangler d1 migrations apply DB --remote`), then the server, then web. Old JoyoFit builds keep working: `showMap` is
optional and the server computes the line from the route or analysis they already send. JoyoRogo native and JoyoFit need a JS update (no
native module changed) to draw the map; until then their cards look as before because they ignore the new fields.
