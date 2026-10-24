import { describe, expect, test } from "bun:test";

import { corosEnabled } from "./coros-grant";

const base = { COROS_CLIENT_ID: "client-1", BETTER_AUTH_URL: "https://api.joyorogo.com" };

describe("corosEnabled", () => {
  test("nobody when the allowlist is unset or empty", () => {
    expect(corosEnabled(base, "u1")).toBe(false);
    expect(corosEnabled({ ...base, COROS_USER_IDS: "" }, "u1")).toBe(false);
    expect(corosEnabled({ ...base, COROS_USER_IDS: " , " }, "")).toBe(false);
  });

  test("only the listed users, ids trimmed", () => {
    const env = { ...base, COROS_USER_IDS: "u1, u2 ,u3" };
    expect(corosEnabled(env, "u1")).toBe(true);
    expect(corosEnabled(env, "u2")).toBe(true);
    expect(corosEnabled(env, "u4")).toBe(false);
    expect(corosEnabled(env, "u")).toBe(false);
  });

  test("* is everyone", () => {
    expect(corosEnabled({ ...base, COROS_USER_IDS: "*" }, "anyone")).toBe(true);
  });

  test("a listed user still needs the client configured", () => {
    expect(corosEnabled({ COROS_USER_IDS: "u1", BETTER_AUTH_URL: base.BETTER_AUTH_URL }, "u1")).toBe(false);
    expect(corosEnabled({ COROS_USER_IDS: "*", COROS_CLIENT_ID: "c" }, "u1")).toBe(false);
  });
});
