/**
 * react-native-worklets 0.10.1 (Android) keeps its UI-runtime animation loop running while the app is in the
 * background. The loop is perpetual by design: `setupRequestAnimationFrame` re-requests the next frame at the end of
 * every frame, whether or not anything animates. The native `AnimationFrameQueue` has a pause()/resume() for it, but
 * `WorkletsModule` implements `LifecycleEventListener` and never registers itself with the React context, so pause()
 * is never called (fixed upstream in worklets 0.10.4 / 0.11.4 / 0.12.0, "UI loop not pausing when the app is
 * backgrounded"). The result on the owner's phone, measured with perfetto and `top -H`:
 *
 * - the main thread wakes on every vsync (120 times a second) and spends ~0.4 ms per frame, ~4-12% of a core, in a
 *   Choreographer "animation" callback, with the JS thread at 0%;
 * - it does so with the Activity paused, stopped or never created (a home-screen widget refresh boots the whole React
 *   host headlessly, and that host's loop never stops), for as long as the process lives;
 * - Android's batterystats billed it as "CPU while cached": 49.9 mAh of the app's 115 mAh over 16 h, 23m50s of the
 *   28m50s with the screen on (vsync is only delivered while the display is on), and the OS killed the cached process
 *   for "excessive cpu" ("limit=10") four times.
 *
 * A native fix needs a new build (bump worklets to >= 0.10.4, which changes the OTA fingerprint). Until then this gates
 * the loop from JS, which an OTA update can ship: the UI runtime calls `globalThis.__nativeRequestAnimationFrame` at
 * the end of each frame (looked up at call time), so while the app is not active the call is held instead of
 * forwarded. The frame already in flight finishes, no further frame is requested, the display stops waking the process,
 * and returning to the app forwards the held request so the loop (and every animation riding it) continues. The
 * trigger is React Native's AppState, which is driven by the same onHostPause/onHostResume the upstream fix uses; the
 * headless widget host starts "background", so its loop never gets going.
 *
 * index.js wires it to `AppState` and `scheduleOnUI`. Delete this file and that wiring once the app ships with
 * worklets >= 0.10.4.
 */

type FrameCallback = (timestamp: number) => void;

type LoopGate = { setPaused(paused: boolean): void };

type UiRuntimeGlobal = {
  __nativeRequestAnimationFrame?: (callback: FrameCallback) => void;
  __joyoUiLoopGate?: LoopGate;
};

/**
 * Runs on the UI runtime: puts the gate in front of the frame request on first call, then only flips it. The held
 * callback is the loop's own next-frame request; nothing else is dropped, user animation callbacks stay queued inside
 * worklets until the loop runs again.
 */
export function setUiLoopPaused(paused: boolean): void {
  "worklet";
  const ui = globalThis as unknown as UiRuntimeGlobal;
  if (ui.__joyoUiLoopGate) {
    ui.__joyoUiLoopGate.setPaused(paused);
    return;
  }
  const request = ui.__nativeRequestAnimationFrame;
  if (typeof request !== "function") return;

  let isPaused = paused;
  let held: FrameCallback | null = null;
  ui.__nativeRequestAnimationFrame = (callback) => {
    if (isPaused) {
      held = callback;
      return;
    }
    request(callback);
  };
  ui.__joyoUiLoopGate = {
    setPaused(next) {
      isPaused = next;
      if (!next && held) {
        const callback = held;
        held = null;
        request(callback);
      }
    },
  };
}

/** The part of `react-native`'s `AppState` the binding reads. */
export type AppStateSource = {
  currentState: string | null;
  addEventListener(type: "change", listener: (state: string) => void): { remove(): void };
};

/**
 * Calls `setPaused` with the current state now and on every change; true for anything but "active". Repeated states
 * are not forwarded. Returns the unsubscribe.
 */
export function bindUiLoopToAppState(
  appState: AppStateSource,
  setPaused: (paused: boolean) => void,
): () => void {
  let last: boolean | null = null;
  const sync = (state: string | null) => {
    const paused = state !== "active";
    if (paused === last) return;
    last = paused;
    setPaused(paused);
  };
  const subscription = appState.addEventListener("change", sync);
  sync(appState.currentState);
  return () => subscription.remove();
}
