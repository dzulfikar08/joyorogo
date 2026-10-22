# Native app: CPU while in the background

Android's battery stats over ~16 h billed JoyoRogo 115 mAh, 49.9 mAh of it as **CPU while the process was cached**
(28m50s of CPU, 23m50s of it with the screen on) against 4m20s of foreground CPU. The camera (`camera:cached` 13.8 s) and
16 WorkManager runs were the other suspects. This is what it was and what was changed.

## Root cause: worklets never pauses its UI loop on Android

`react-native-worklets` 0.10.1 runs a perpetual frame loop on the UI runtime: `setupRequestAnimationFrame`
(`runLoop/uiRuntime/requestAnimationFrame.ts`) re-requests the next frame at the end of every frame, animating or not.
The native `AnimationFrameQueue` can pause it, but `WorkletsModule` implements `LifecycleEventListener` and never calls
`addLifecycleEventListener(this)` (Reanimated's `ReanimatedModule.initialize()` does), so `onHostPause` never arrives.
Upstream fixed it in worklets 0.10.4 / 0.11.4 / 0.12.0 ("UI loop not pausing when the app is backgrounded",
software-mansion/react-native-reanimated#10196).

Measured on the owner's phone (perfetto, `top -H`, `/proc/<pid>/task/*/stat`, logcat; all read-only):

| | |
|---|---|
| Main thread | wakes on every vsync (120/s), one Choreographer `animation` callback each: ~0.37 ms, of which ~0.22 ms is `scheduleVsync` |
| CPU | 4-12% of a core (87-283 ticks per 22 s; it follows the display rate, ~2.8x lower while a 60 Hz app is in front), JS thread 0% |
| When | Activity paused (React `onHostPause` was delivered), Activity destroyed (`Activities: 0`, `Views: 0`), and in a process a widget refresh booted headlessly; for the whole life of the process |
| Why it survives | MIUI's freezer skips the uid while the screen is on: `GreezeManager: freezeUid uid=10549 return:WIDGET_APP` every 5 s, then `FZ ... reason=screen off success` (and `THAW` on screen on). That is the 23m50s screen-on / 3m screen-off split |
| Cost | Android's own kill: `am_kill ... excessive cpu 35990 during 300102 ... limit=10`; batterystats lists four "Killed for cpu use" at 8-11%; each kill is followed by a MIUI `prestart-top-activity` or a widget `broadcast` start, so the process keeps coming back |

The widget matters twice: `updatePeriodMillis` 1 800 000 (the Android minimum) wakes the app every 30 min, the headless
host boots the whole bundle, and a host nobody ever resumed never pauses its loop; and a widget makes MIUI refuse to
freeze the cached process while the screen is on.

## What was changed (JS only, ships by OTA)

- `src/lib/ui-loop-gate.ts`, wired from `index.js` through `src/lib/ui-loop-gate-start.ts` (Android only): while
  React Native's `AppState` is not `active`, the UI runtime's `globalThis.__nativeRequestAnimationFrame` (looked up at call
  time by the loop) holds the request instead of forwarding it. The frame in flight finishes, the next is not requested,
  the display stops waking the process; `active` forwards the held request. A host booted headlessly starts as
  `background`, so its loop never starts. Same trigger the upstream fix uses (`onHostPause`/`onHostResume` drive AppState).
  `ui-loop-gate.test.ts` replays the loop against a fake display: 7 200 wakeups a minute without the gate, 1 with it,
  one loop after 20 background trips, animation callbacks wait and then run.
- `src/lib/widgets/refresh-policy.ts` + `single-flight.ts`: the launcher starts one headless run per widget on the same
  tick and WorkManager runs them side by side. A run now repaints the stored snapshot and fetches only if the snapshot is
  older than 10 min (2 min for a just-placed widget); concurrent runs share one fetch (three API calls per run before).
- `src/lib/use-camera-active.ts`: `CameraView` mounts only while its screen is focused and the app is not in the
  background (`makan-ai`, `makan-barcode`, `grup/[id]/var`, `grup/[id]/var-saya`; `var` also drops it behind the reveal
  card). CameraX (`bindToLifecycle(currentActivity)`) already closed the camera when the Activity stopped, so
  `camera:cached` was the gap between pause and stop (~1.2 s per session); the gate closes it at pause and stops a
  screen another screen was pushed over from keeping the sensor on.

Checked and not a cause: react-query (`focusManager` is wired to AppState in `query-focus.ts`; `refetchInterval` stops
in the background), JS `setInterval`s and Animated/Reanimated loops (React Native stops timers and native-driven
animations on `onHostPause`; a headless run only keeps timers alive while its task runs), WebSocket/SSE (none in the
app), location (`getLastKnownPositionAsync`/`getCurrentPositionAsync`, one-shot).

## Not changed (needs a native build, which also changes the OTA fingerprint)

- Bump `react-native-worklets` 0.10.1 to 0.10.4 (Reanimated 4.5.1 peers `0.10.x`), then delete `ui-loop-gate.ts`,
  `ui-loop-gate.test.ts`, `ui-loop-gate-start.ts` and its import in `index.js`. Bumping it before the OTA with the gate ships
  would move the fingerprint and the installed build would never receive the gate.
- Widget `updatePeriodMillis` in `app.json` (1 800 000 now). Each tick is a headless boot; 3 600 000 halves them, and the
  app already pushes a fresh snapshot whenever its screens load.

## Re-measuring

```sh
adb shell 'PID=$(pidof com.joyodigitama.joyorogo); for t in /proc/$PID/task/*; do echo $(cat $t/comm) $(awk "{print \$14+\$15}" $t/stat); done'
```

Run it twice 20 s apart with the app in the background and the screen on: the `gitama.joyorogo` (main) thread gains
~100-280 ticks before the gate, ~0 after (check `oom_score_adj` > 100 and that the focused window is another app).
`dumpsys batterystats com.joyodigitama.joyorogo` should show `cpu:cached` falling from tens of minutes to seconds a day.
