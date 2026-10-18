import { describe, expect, test } from "bun:test";

import { STRENGTH_WRITES_LOCKED_AT, strengthWritesLocked } from "./strength-lock";

describe("strengthWritesLocked", () => {
  test("the grace period ends 2026-11-01 00:00 WIB", () => {
    expect(new Date(STRENGTH_WRITES_LOCKED_AT).toISOString()).toBe("2026-10-31T17:00:00.000Z");
  });

  test("open before the instant, locked at and after it", () => {
    expect(strengthWritesLocked(STRENGTH_WRITES_LOCKED_AT - 1)).toBe(false);
    expect(strengthWritesLocked(STRENGTH_WRITES_LOCKED_AT)).toBe(true);
    expect(strengthWritesLocked(STRENGTH_WRITES_LOCKED_AT + 1)).toBe(true);
  });

  test("defaults to the current clock", () => {
    expect(strengthWritesLocked()).toBe(Date.now() >= STRENGTH_WRITES_LOCKED_AT);
  });
});
