import { describe, expect, test } from "bun:test";

import { chatGate, type GateInput } from "./gate";

const base: GateInput = {
  engine: "hosted",
  loaded: true,
  own: { ok: false, reason: "noProvider" },
  hosted: "ready",
  hostedConsent: true,
};
const gate = (over: Partial<GateInput>) => chatGate({ ...base, ...over });

describe("chat gate", () => {
  test("nothing is decided before the settings are read", () => {
    expect(gate({ loaded: false })).toEqual({ kind: "checking" });
    expect(gate({ loaded: false, engine: "byok" })).toEqual({ kind: "checking" });
  });

  test("hosted: Pro and the one-time consent make it ready; Pro without consent asks first", () => {
    expect(gate({})).toEqual({ kind: "ready", engine: "hosted" });
    expect(gate({ hostedConsent: false })).toEqual({ kind: "hostedConsent" });
  });

  test("hosted without Pro is the paywall, never ready, whatever the consent says", () => {
    expect(gate({ hosted: "locked" })).toEqual({ kind: "paywall" });
    expect(gate({ hosted: "locked", hostedConsent: false })).toEqual({ kind: "paywall" });
  });

  test("hosted on an older server or switched off: 'unavailable', not an error", () => {
    expect(gate({ hosted: "unavailable" })).toEqual({ kind: "unavailable" });
  });

  test("hosted still being read", () => {
    expect(gate({ hosted: "checking" })).toEqual({ kind: "checking" });
    expect(gate({ own: null })).toEqual({ kind: "checking" });
  });

  test("under 18 is off on both engines, whichever says it first", () => {
    expect(gate({ hosted: "minor" })).toEqual({ kind: "minor" });
    expect(gate({ own: { ok: false, reason: "minor" } })).toEqual({ kind: "minor" });
    expect(gate({ engine: "byok", own: { ok: false, reason: "minor" }, hosted: "ready" })).toEqual({
      kind: "minor",
    });
    expect(gate({ hosted: "minor", hostedConsent: true })).toEqual({ kind: "minor" });
  });

  test("own key: ready when the gate says so, free for everyone (no Pro check, no hosted consent)", () => {
    expect(
      gate({ engine: "byok", own: { ok: true }, hosted: "locked", hostedConsent: false }),
    ).toEqual({ kind: "ready", engine: "byok" });
    expect(gate({ engine: "byok", own: { ok: true }, hosted: "unavailable" })).toEqual({
      kind: "ready",
      engine: "byok",
    });
  });

  test("own key blocked: the reason is kept for the card", () => {
    for (const reason of ["noProvider", "badUrl", "noKey", "noConsent"] as const) {
      expect(gate({ engine: "byok", own: { ok: false, reason } })).toEqual({
        kind: "ownBlocked",
        reason,
      });
    }
  });

  test("own key, age still being read", () => {
    expect(gate({ engine: "byok", own: null })).toEqual({ kind: "checking" });
  });
});
