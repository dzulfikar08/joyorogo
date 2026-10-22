import { beforeEach, describe, expect, test } from "bun:test";

import { bindUiLoopToAppState, setUiLoopPaused } from "./ui-loop-gate";
import type { AppStateSource } from "./ui-loop-gate";

// A stand-in for the worklets UI runtime: the same perpetual loop `setupRequestAnimationFrame` starts (each frame runs the
// queued animation callbacks, then asks the native side for the next frame through the global the gate sits in front
// of), and a display that delivers a frame per vsync only if one was requested.

type FrameCallback = (timestamp: number) => void;
type Ui = {
  __nativeRequestAnimationFrame?: (callback: FrameCallback) => void;
  __joyoUiLoopGate?: unknown;
};
const ui = globalThis as unknown as Ui;

let inFlight: FrameCallback | null;
let nativeRequests: number;
let frames: number;
let animationCallbacks: FrameCallback[];
let clock: number;

/** The loop is already running when the gate arrives, as it is in the app (worklets starts it during its own init). */
function bootUiRuntime() {
  inFlight = null;
  nativeRequests = 0;
  frames = 0;
  animationCallbacks = [];
  clock = 0;
  delete ui.__joyoUiLoopGate;
  ui.__nativeRequestAnimationFrame = (callback) => {
    nativeRequests++;
    inFlight = callback;
  };
  const flush: FrameCallback = (timestamp) => {
    frames++;
    const queued = animationCallbacks;
    animationCallbacks = [];
    for (const callback of queued) callback(timestamp);
    ui.__nativeRequestAnimationFrame!(flush);
  };
  ui.__nativeRequestAnimationFrame(flush);
}

/** `n` display refreshes; returns how many woke the app (a frame was requested). */
function vsync(n: number): number {
  let wakeups = 0;
  for (let i = 0; i < n; i++) {
    clock += 1000 / 120;
    const callback = inFlight;
    inFlight = null;
    if (!callback) continue;
    wakeups++;
    callback(clock);
  }
  return wakeups;
}

beforeEach(bootUiRuntime);

describe("without the gate", () => {
  test("the loop wakes the app on every refresh, forever (the bug)", () => {
    expect(vsync(120 * 60)).toBe(120 * 60);
  });
});

describe("the app is active", () => {
  test("installing the gate changes nothing", () => {
    setUiLoopPaused(false);
    expect(vsync(240)).toBe(240);
    expect(frames).toBe(240);
  });

  test("animation callbacks run on the next frame", () => {
    setUiLoopPaused(false);
    const seen: number[] = [];
    animationCallbacks.push((timestamp) => seen.push(timestamp));
    vsync(1);
    expect(seen).toHaveLength(1);
  });
});

describe("the app goes to the background", () => {
  test("the frame in flight finishes, then no refresh wakes the app for a minute", () => {
    setUiLoopPaused(false);
    vsync(10);
    setUiLoopPaused(true);
    const wakeups = vsync(120 * 60);
    expect(wakeups).toBe(1);
    // the boot request plus one per frame before the pause; the frame in flight asks for another one, which is held
    expect(nativeRequests).toBe(1 + 10);
  });

  test("a widget refresh boots the host in the background: the gate starts paused, the loop never gets going", () => {
    setUiLoopPaused(true);
    expect(vsync(120 * 60)).toBe(1);
  });

  test("pausing twice is the same as once", () => {
    setUiLoopPaused(true);
    setUiLoopPaused(true);
    expect(vsync(120)).toBe(1);
  });

  test("animation callbacks wait instead of running", () => {
    setUiLoopPaused(true);
    vsync(2);
    const seen: number[] = [];
    animationCallbacks.push((timestamp) => seen.push(timestamp));
    vsync(120);
    expect(seen).toHaveLength(0);
  });
});

describe("the app comes back", () => {
  test("the held request goes out once and the loop runs again", () => {
    setUiLoopPaused(true);
    vsync(5);
    const requestsWhilePaused = nativeRequests;
    setUiLoopPaused(false);
    expect(nativeRequests).toBe(requestsWhilePaused + 1);
    expect(vsync(240)).toBe(240);
  });

  test("animation callbacks queued meanwhile run on the first frame back", () => {
    setUiLoopPaused(true);
    vsync(2);
    const seen: number[] = [];
    animationCallbacks.push((timestamp) => seen.push(timestamp));
    setUiLoopPaused(false);
    vsync(1);
    expect(seen).toHaveLength(1);
  });

  test("resuming when nothing was held does not start a second loop", () => {
    setUiLoopPaused(false);
    setUiLoopPaused(false);
    expect(vsync(60)).toBe(60);
    expect(nativeRequests).toBe(1 + 60);
  });

  test("many background trips keep one loop", () => {
    setUiLoopPaused(false);
    for (let trip = 0; trip < 20; trip++) {
      setUiLoopPaused(true);
      vsync(30);
      setUiLoopPaused(false);
      vsync(30);
    }
    const before = frames;
    expect(vsync(120)).toBe(120);
    expect(frames - before).toBe(120);
  });
});

describe("the UI runtime is not ready", () => {
  test("a missing frame request is ignored and the gate installs on a later call", () => {
    const request = ui.__nativeRequestAnimationFrame;
    delete ui.__nativeRequestAnimationFrame;
    expect(() => setUiLoopPaused(true)).not.toThrow();
    expect(ui.__joyoUiLoopGate).toBeUndefined();
    ui.__nativeRequestAnimationFrame = request;
    setUiLoopPaused(true);
    expect(ui.__joyoUiLoopGate).toBeDefined();
    expect(vsync(120)).toBe(1);
  });
});

describe("following the app state", () => {
  const listeners = new Set<(state: string) => void>();
  const appState = (currentState: string | null): AppStateSource => ({
    currentState,
    addEventListener: (_type, listener) => {
      listeners.add(listener);
      return { remove: () => void listeners.delete(listener) };
    },
  });
  const emit = (state: string) => listeners.forEach((listener) => listener(state));

  beforeEach(() => listeners.clear());

  test("a background launch pauses at once, coming to the front resumes, leaving pauses", () => {
    const calls: boolean[] = [];
    bindUiLoopToAppState(appState("background"), (paused) => calls.push(paused));
    emit("active");
    emit("background");
    expect(calls).toEqual([true, false, true]);
  });

  test("a foreground launch starts unpaused", () => {
    const calls: boolean[] = [];
    bindUiLoopToAppState(appState("active"), (paused) => calls.push(paused));
    expect(calls).toEqual([false]);
  });

  test("repeated states are not forwarded", () => {
    const calls: boolean[] = [];
    bindUiLoopToAppState(appState("active"), (paused) => calls.push(paused));
    emit("active");
    emit("background");
    emit("background");
    emit("inactive");
    expect(calls).toEqual([false, true]);
  });

  test("an unknown state counts as not active", () => {
    const calls: boolean[] = [];
    bindUiLoopToAppState(appState(null), (paused) => calls.push(paused));
    expect(calls).toEqual([true]);
  });

  test("unsubscribing stops the updates", () => {
    const calls: boolean[] = [];
    const unbind = bindUiLoopToAppState(appState("active"), (paused) => calls.push(paused));
    unbind();
    expect(listeners.size).toBe(0);
    emit("background");
    expect(calls).toEqual([false]);
  });

  test("end to end: AppState drives the gate, the app is quiet in the background", () => {
    bindUiLoopToAppState(appState("active"), setUiLoopPaused);
    expect(vsync(120)).toBe(120);
    emit("background");
    expect(vsync(120 * 30)).toBe(1);
    emit("active");
    expect(vsync(120)).toBe(120);
  });
});
