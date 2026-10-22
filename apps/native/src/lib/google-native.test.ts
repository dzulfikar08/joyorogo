import { describe, expect, test } from "bun:test";

import {
  type NativeGoogleDeps,
  type NativeGoogleToken,
  classifyNativeGoogleError,
  signInWithNativeGoogle,
} from "./google-native";

const codes = { SIGN_IN_CANCELLED: "-5", PLAY_SERVICES_NOT_AVAILABLE: "2" };

function setup(token: NativeGoogleToken, over: Partial<NativeGoogleDeps> = {}) {
  const calls = { exchanged: [] as string[], logs: [] as string[], requested: 0 };
  const deps: NativeGoogleDeps = {
    available: () => true,
    requestIdToken: async () => {
      calls.requested++;
      return token;
    },
    exchange: async (t) => {
      calls.exchanged.push(t);
      return { error: null };
    },
    log: (m) => calls.logs.push(m),
    ...over,
  };
  return { deps, calls };
}

describe("signInWithNativeGoogle", () => {
  test("a token is exchanged with the server and signs in", async () => {
    const { deps, calls } = setup({ status: "ok", idToken: "tok" });
    expect(await signInWithNativeGoogle(deps)).toEqual({ kind: "signed-in" });
    expect(calls.exchanged).toEqual(["tok"]);
  });

  test("a binary without the native module falls back without touching the sheet", async () => {
    const { deps, calls } = setup({ status: "ok", idToken: "tok" }, { available: () => false });
    expect((await signInWithNativeGoogle(deps)).kind).toBe("fallback");
    expect(calls.requested).toBe(0);
  });

  test("a cancelled sheet never falls back", async () => {
    const { deps, calls } = setup({ status: "cancelled" });
    expect(await signInWithNativeGoogle(deps)).toEqual({ kind: "cancelled" });
    expect(calls.exchanged).toEqual([]);
    expect(calls.logs).toEqual([]);
  });

  test("an unavailable native sign-in falls back and logs why", async () => {
    const { deps, calls } = setup({ status: "unavailable", reason: "developer error: 10" });
    expect(await signInWithNativeGoogle(deps)).toEqual({ kind: "fallback", reason: "developer error: 10" });
    expect(calls.logs[0]).toContain("developer error: 10");
  });

  test("another native failure is reported, not retried in the browser", async () => {
    const { deps } = setup({ status: "failed", reason: "7 network" });
    expect(await signInWithNativeGoogle(deps)).toEqual({ kind: "failed", reason: "7 network" });
  });

  test("a server rejection is a failure, not a fallback", async () => {
    const { deps, calls } = setup(
      { status: "ok", idToken: "tok" },
      { exchange: async () => ({ error: { message: "Invalid token" } }) },
    );
    expect(await signInWithNativeGoogle(deps)).toEqual({ kind: "failed", reason: "Invalid token" });
    expect(calls.logs[0]).toContain("Invalid token");
  });
});

describe("classifyNativeGoogleError", () => {
  test("cancel code", () => {
    expect(classifyNativeGoogleError({ code: "-5" }, codes)).toEqual({ status: "cancelled" });
  });
  test("developer error 10 (numeric or string) is unavailable", () => {
    expect(classifyNativeGoogleError({ code: "10", message: "x" }, codes).status).toBe("unavailable");
    expect(classifyNativeGoogleError({ code: 10 }, codes).status).toBe("unavailable");
    expect(classifyNativeGoogleError({ code: "10" }).status).toBe("unavailable");
  });
  test("Play services missing is unavailable", () => {
    expect(classifyNativeGoogleError({ code: "2" }, codes).status).toBe("unavailable");
  });
  test("anything else, including a non-error, is a failure", () => {
    expect(classifyNativeGoogleError({ code: "7" }, codes).status).toBe("failed");
    expect(classifyNativeGoogleError(new Error("boom"), codes).status).toBe("failed");
    expect(classifyNativeGoogleError("weird").status).toBe("failed");
  });
});
