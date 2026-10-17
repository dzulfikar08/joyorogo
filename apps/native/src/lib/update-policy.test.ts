import { describe, expect, test } from "bun:test";

import {
  CHECK_THROTTLE_MS,
  DISMISS_MS,
  compareVersionCodes,
  downloadPercent,
  isDismissed,
  isNewerVersionCode,
  isPlayInstaller,
  parseTimestamp,
  parseVersionCode,
  shouldCheck,
} from "./update-policy";

const NOW = 1_800_000_000_000;

describe("shouldCheck (6 h throttle)", () => {
  test("never checked -> check", () => {
    expect(shouldCheck(null, NOW)).toBe(true);
  });
  test("just checked -> skip", () => {
    expect(shouldCheck(NOW - 1000, NOW)).toBe(false);
  });
  test("one ms before 6 h -> skip, at 6 h -> check", () => {
    expect(shouldCheck(NOW - CHECK_THROTTLE_MS + 1, NOW)).toBe(false);
    expect(shouldCheck(NOW - CHECK_THROTTLE_MS, NOW)).toBe(true);
  });
  test("a timestamp in the future (clock change) -> check", () => {
    expect(shouldCheck(NOW + 60_000, NOW)).toBe(true);
  });
});

describe("isDismissed (24 h window)", () => {
  test("never dismissed", () => {
    expect(isDismissed(null, NOW)).toBe(false);
  });
  test("inside the window", () => {
    expect(isDismissed(NOW - 60_000, NOW)).toBe(true);
    expect(isDismissed(NOW - DISMISS_MS + 1, NOW)).toBe(true);
  });
  test("window over at exactly 24 h", () => {
    expect(isDismissed(NOW - DISMISS_MS, NOW)).toBe(false);
  });
  test("a timestamp in the future (clock change) does not hide the banner", () => {
    expect(isDismissed(NOW + 60_000, NOW)).toBe(false);
  });
});

describe("parseTimestamp", () => {
  test("valid, missing and garbage", () => {
    expect(parseTimestamp("1800000000000")).toBe(1_800_000_000_000);
    expect(parseTimestamp(null)).toBeNull();
    expect(parseTimestamp("")).toBeNull();
    expect(parseTimestamp("abc")).toBeNull();
    expect(parseTimestamp("-5")).toBeNull();
  });
});

describe("version codes", () => {
  test("parseVersionCode", () => {
    expect(parseVersionCode("1466631")).toBe(1466631);
    expect(parseVersionCode(1466631)).toBe(1466631);
    expect(parseVersionCode(null)).toBe(0);
    expect(parseVersionCode("x")).toBe(0);
    expect(parseVersionCode(-3)).toBe(0);
  });
  test("isNewerVersionCode", () => {
    expect(isNewerVersionCode(1466632, 1466631)).toBe(true);
    expect(isNewerVersionCode(1466631, 1466631)).toBe(false);
    expect(isNewerVersionCode(1466000, 1466631)).toBe(false);
    // Unknown installed version never nags.
    expect(isNewerVersionCode(1466632, 0)).toBe(false);
    expect(isNewerVersionCode(Number.NaN, 1466631)).toBe(false);
  });
  test("compareVersionCodes is numeric, not lexicographic or semver", () => {
    expect(compareVersionCodes("1466700", "1466631")).toBe(1);
    expect(compareVersionCodes("999", "1000")).toBe(-1);
    expect(compareVersionCodes("1466631", "1466631")).toBe(0);
  });
});

describe("isPlayInstaller", () => {
  test("only the Play Store app", () => {
    expect(isPlayInstaller("com.android.vending")).toBe(true);
    expect(isPlayInstaller("com.google.android.packageinstaller")).toBe(false);
    expect(isPlayInstaller("com.sec.android.app.samsungapps")).toBe(false);
    expect(isPlayInstaller("unknown")).toBe(false);
    expect(isPlayInstaller(null)).toBe(false);
    expect(isPlayInstaller(undefined)).toBe(false);
  });
});

describe("downloadPercent", () => {
  test("rounds and clamps", () => {
    expect(downloadPercent(50, 200)).toBe(25);
    expect(downloadPercent(300, 200)).toBe(100);
    expect(downloadPercent(0, 200)).toBe(0);
  });
  test("unknown total -> null", () => {
    expect(downloadPercent(10, 0)).toBeNull();
    expect(downloadPercent(Number.NaN, 10)).toBeNull();
  });
});
