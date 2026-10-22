import { describe, expect, test } from "bun:test";

import { AiError } from "@joyorogo/api/lib/joyo-ai/types";

import { hostedFailure, viewAiError } from "./error-view";

const ctx = { provider: "openrouter" as const, ceiling: 40 };

describe("own-key errors", () => {
  test("a refused key leads to the key setup and carries the provider's words", () => {
    const view = viewAiError(new AiError("badKey", 401, "Invalid API key"), ctx);
    expect(view.message.key).toBe("joyoAi:errors.badKey");
    expect(view.action).toEqual({ label: "err.action.setup", target: "setup" });
    expect(view.detail).toBe("Invalid API key");
    expect(view.status).toBe(401);
    expect(view.detailFrom).toBe("provider");
  });

  test("quota links to the provider's key page only when it has one", () => {
    expect(viewAiError(new AiError("quota", 402), ctx).action?.target).toBe("keyPage");
    expect(
      viewAiError(new AiError("quota", 402), { provider: "custom", ceiling: 40 }).action,
    ).toBeNull();
    expect(
      viewAiError(new AiError("quota", 402), { provider: null, ceiling: 40 }).action,
    ).toBeNull();
  });

  test("model problems lead to the model picker", () => {
    for (const kind of ["modelNotFound", "noTools", "truncated", "badRequest"] as const) {
      expect(viewAiError(new AiError(kind, 400, "x"), ctx).action?.target).toBe("model");
    }
  });

  test("a bad custom URL is worded as a blocked address, not a model problem", () => {
    const view = viewAiError(new AiError("badRequest", null, "url"), ctx);
    expect(view.message.key).toBe("joyoAi:blocked.badUrl");
    expect(view.action?.target).toBe("setup");
    expect(view.detail).toBeNull();
  });

  test("blocked reasons: nothing was sent, and the words say which gate", () => {
    const ceiling = viewAiError(new AiError("blocked", null, "ceiling"), ctx);
    expect(ceiling.message.key).toBe("joyoAi:blocked.ceiling");
    expect(ceiling.action?.target).toBe("settings");
    expect(viewAiError(new AiError("blocked", null, "noConsent"), ctx).message.key).toBe(
      "joyoAi:blocked.noConsent",
    );
    expect(viewAiError(new AiError("blocked", null, "minor"), ctx).action).toBeNull();
    expect(viewAiError(new AiError("blocked", null, "weird"), ctx).message.key).toBe(
      "joyoAiApp:err.blockedOther",
    );
    expect(viewAiError(new AiError("blocked", null, "noKey"), ctx).detail).toBeNull();
  });

  test("empty and truncated are the engine's own lines", () => {
    expect(viewAiError(new AiError("empty", 200, "finish=stop"), ctx).detailFrom).toBe("engine");
    expect(viewAiError(new AiError("truncated", 200, "length"), ctx).detailFrom).toBe("engine");
  });

  test("long provider text is cut", () => {
    expect(viewAiError(new AiError("server", 500, "x".repeat(900)), ctx).detail?.length).toBe(300);
  });

  test("anything that is not an AiError is the unknown line", () => {
    const view = viewAiError(new Error("boom"), ctx);
    expect(view.kind).toBe("unknown");
    expect(view.message.key).toBe("joyoAiApp:err.unknown");
  });
});

describe("hosted failures", () => {
  const orpc = (code: string, data?: unknown) => Object.assign(new Error(code), { code, data });
  test("reasons the server sends", () => {
    expect(hostedFailure(orpc("FORBIDDEN", { reason: "minor" }))).toBe("minor");
    expect(hostedFailure(orpc("FORBIDDEN", { reason: "noConsent" }))).toBe("noConsent");
    expect(hostedFailure(orpc("TOO_MANY_REQUESTS", { reason: "cap" }))).toBe("cap");
    expect(hostedFailure(orpc("SERVICE_UNAVAILABLE"))).toBe("off");
  });

  test("an older server without the procedure is 'unavailable', never a crash", () => {
    expect(hostedFailure(orpc("NOT_FOUND"))).toBe("unavailable");
    expect(hostedFailure({ status: 404 })).toBe("unavailable");
  });

  test("no connection, timeout, abort", () => {
    expect(hostedFailure(new TypeError("Network request failed"))).toBe("network");
    expect(hostedFailure(Object.assign(new Error("x"), { name: "AbortError" }))).toBe("aborted");
    expect(hostedFailure(new AiError("aborted"))).toBe("aborted");
    expect(hostedFailure(orpc("TIMEOUT"))).toBe("timeout");
  });

  test("a failure after the stream started names its kind in data.reason", () => {
    expect(hostedFailure(orpc("UNPROCESSABLE_CONTENT", { reason: "truncated" }))).toBe("truncated");
    expect(hostedFailure(orpc("INTERNAL_SERVER_ERROR", { reason: "timeout" }))).toBe("timeout");
    expect(hostedFailure(orpc("UNPROCESSABLE_CONTENT", { reason: "rateLimit" }))).toBe("rateLimit");
    expect(hostedFailure(orpc("UNPROCESSABLE_CONTENT", { reason: "server" }))).toBe("server");
  });

  test("anything else is 'other'", () => {
    expect(hostedFailure(orpc("INTERNAL_SERVER_ERROR"))).toBe("other");
    expect(hostedFailure(orpc("FORBIDDEN", { x: 1 }))).toBe("other");
    expect(hostedFailure("string")).toBe("other");
    expect(hostedFailure(null)).toBe("other");
  });
});
