import { describe, expect, test } from "bun:test";
import { otaPercent, otaPhase, otaSource, type OtaSnapshot } from "./ota-policy";

const base: OtaSnapshot = {
  enabled: true,
  isChecking: false,
  isDownloading: false,
  isUpdatePending: false,
  hasError: false,
};

describe("otaPhase", () => {
  test("disabled builds report disabled whatever else is set", () => {
    expect(otaPhase({ ...base, enabled: false, isUpdatePending: true })).toBe("disabled");
  });
  test("idle when nothing is going on", () => {
    expect(otaPhase(base)).toBe("idle");
  });
  test("checking and downloading", () => {
    expect(otaPhase({ ...base, isChecking: true })).toBe("checking");
    expect(otaPhase({ ...base, isDownloading: true })).toBe("downloading");
    expect(otaPhase({ ...base, isChecking: true, isDownloading: true })).toBe("downloading");
  });
  test("a pending update wins over a failed re-check", () => {
    expect(otaPhase({ ...base, isUpdatePending: true, hasError: true })).toBe("ready");
  });
  test("error only when nothing better applies", () => {
    expect(otaPhase({ ...base, hasError: true })).toBe("error");
    expect(otaPhase({ ...base, hasError: true, isChecking: true })).toBe("checking");
  });
});

describe("otaSource", () => {
  test("emergency launch beats embedded", () => {
    expect(otaSource(true, true)).toBe("emergency");
  });
  test("embedded vs downloaded", () => {
    expect(otaSource(true, false)).toBe("embedded");
    expect(otaSource(false, false)).toBe("update");
  });
});

describe("otaPercent", () => {
  test("rounds and clamps", () => {
    expect(otaPercent(0.456)).toBe(46);
    expect(otaPercent(2)).toBe(100);
    expect(otaPercent(-1)).toBe(0);
    expect(otaPercent(undefined)).toBeNull();
    expect(otaPercent(Number.NaN)).toBeNull();
  });
});
