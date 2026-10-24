import { describe, expect, test } from "bun:test";

import { garminEnabled } from "./garmin-grant";

describe("garminEnabled", () => {
  test("nobody when the allowlist is unset or empty", () => {
    expect(garminEnabled({}, "u1")).toBe(false);
    expect(garminEnabled({ GARMIN_USER_IDS: "" }, "u1")).toBe(false);
    expect(garminEnabled({ GARMIN_USER_IDS: " , " }, "")).toBe(false);
  });

  test("only the listed users, ids trimmed", () => {
    const env = { GARMIN_USER_IDS: "u1, u2 ,u3" };
    expect(garminEnabled(env, "u1")).toBe(true);
    expect(garminEnabled(env, "u2")).toBe(true);
    expect(garminEnabled(env, "u4")).toBe(false);
    expect(garminEnabled(env, "u")).toBe(false);
  });

  test("* is everyone", () => {
    expect(garminEnabled({ GARMIN_USER_IDS: "*" }, "anyone")).toBe(true);
  });
});
