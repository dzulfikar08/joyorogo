import { describe, expect, test } from "bun:test";

import { WATCH_SLEEP_SOURCE, pickNightSleep } from "./sleep-night";

describe("pickNightSleep", () => {
  test("the watch's hours stand in when there is no log", () => {
    expect(pickNightSleep(null, 6.4)).toEqual({ hours: 6.4, source: WATCH_SLEEP_SOURCE });
    expect(pickNightSleep(undefined, 6.4)).toEqual({ hours: 6.4, source: WATCH_SLEEP_SOURCE });
  });

  test("a manual entry beats the watch", () => {
    const manual = { hours: 7.5, source: "manual" };
    expect(pickNightSleep(manual, 6.4)).toBe(manual);
  });

  test("the watch beats an import", () => {
    expect(pickNightSleep({ hours: 7, source: "health_connect" }, 6.4)).toEqual({
      hours: 6.4,
      source: "joyofit",
    });
    expect(pickNightSleep({ hours: 7, source: "apple_health" }, 6.4)).toEqual({
      hours: 6.4,
      source: "joyofit",
    });
  });

  test("no usable watch reading falls back to the log", () => {
    const imported = { hours: 7, source: "apple_health" };
    expect(pickNightSleep(imported, null)).toBe(imported);
    expect(pickNightSleep(imported, undefined)).toBe(imported);
    expect(pickNightSleep(imported, 0)).toBe(imported);
    expect(pickNightSleep(imported, Number.NaN)).toBe(imported);
  });

  test("nothing to show is null", () => {
    expect(pickNightSleep(null, null)).toBeNull();
    expect(pickNightSleep(undefined, 0)).toBeNull();
  });
});
