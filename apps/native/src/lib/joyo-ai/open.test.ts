import { describe, expect, test } from "bun:test";

import { joyoDestination, type OpenState } from "./open";

const state = (over: Partial<OpenState>): OpenState => ({
  engine: "hosted",
  own: { ok: false, reason: "noProvider" },
  hosted: "locked",
  ...over,
});
const ownReady = { ok: true } as const;

describe("where a Joyo AI shortcut leads", () => {
  test("nothing set up and no Pro: the setup screen, with or without a question", () => {
    expect(joyoDestination(state({}))).toEqual({ pathname: "/joyo-setup" });
    expect(joyoDestination(state({}), { text: "Cocok?" })).toEqual({ pathname: "/joyo-setup" });
    expect(joyoDestination(state({ hosted: "unavailable" }))).toEqual({ pathname: "/joyo-setup" });
  });

  test("hosted engine ready: the chat, the question passed as a param", () => {
    expect(joyoDestination(state({ hosted: "ready" }))).toEqual({ pathname: "/joyo" });
    expect(joyoDestination(state({ hosted: "ready" }), { text: "Cocok nasi 150 g?" })).toEqual({
      pathname: "/joyo",
      params: { ask: "Cocok nasi 150 g?" },
    });
    expect(joyoDestination(state({ hosted: "ready" }), { text: "" })).toEqual({
      pathname: "/joyo",
    });
    expect(joyoDestination(state({ hosted: "ready" }), null)).toEqual({ pathname: "/joyo" });
  });

  test("own key ready and chosen: the chat even without Pro", () => {
    expect(joyoDestination(state({ engine: "byok", own: ownReady }))).toEqual({
      pathname: "/joyo",
    });
    expect(
      joyoDestination(state({ engine: "byok", own: ownReady, hosted: "unavailable" })),
    ).toEqual({ pathname: "/joyo" });
  });

  test("own key ready but the hosted engine is chosen and cannot be used: the settings, to switch engine", () => {
    expect(joyoDestination(state({ own: ownReady }))).toEqual({ pathname: "/joyo-ai-settings" });
    expect(joyoDestination(state({ own: ownReady, hosted: "unavailable" }))).toEqual({
      pathname: "/joyo-ai-settings",
    });
  });

  test("own key chosen but not usable and no Pro: setup", () => {
    expect(
      joyoDestination(state({ engine: "byok", own: { ok: false, reason: "noConsent" } })),
    ).toEqual({ pathname: "/joyo-setup" });
    expect(
      joyoDestination(state({ engine: "byok", own: { ok: false, reason: "badUrl" } })),
    ).toEqual({ pathname: "/joyo-setup" });
  });

  test("own key chosen but blocked while the hosted engine is ready: the chat, which says why", () => {
    expect(
      joyoDestination(
        state({ engine: "byok", own: { ok: false, reason: "noKey" }, hosted: "ready" }),
      ),
    ).toEqual({ pathname: "/joyo" });
  });

  test("under 18, by the profile on either engine: the chat, which explains; never setup", () => {
    expect(joyoDestination(state({ engine: "byok", own: { ok: false, reason: "minor" } }))).toEqual(
      { pathname: "/joyo" },
    );
    expect(
      joyoDestination(state({ own: { ok: false, reason: "minor" }, hosted: "minor" }), {
        text: "x",
      }),
    ).toEqual({
      pathname: "/joyo",
      params: { ask: "x" },
    });
    expect(joyoDestination(state({ own: ownReady, hosted: "minor" }))).toEqual({
      pathname: "/joyo",
    });
  });

  test("still reading the age or the account: the chat opens and shows its own checking state", () => {
    expect(joyoDestination(state({ own: null }))).toEqual({ pathname: "/joyo" });
    expect(joyoDestination(state({ hosted: "checking" }))).toEqual({ pathname: "/joyo" });
  });
});
