import { describe, expect, test } from "bun:test";
import { ORPCError } from "@orpc/client";

import type { ChatMessage, KeyValue } from "@joyorogo/api/lib/joyo-ai/conversations";
import { grantHostedConsent } from "@joyorogo/api/lib/joyo-ai/consent";
import { hostedAccess } from "@joyorogo/api/lib/joyo-ai/settings";

import {
  HOSTED_LIMITS,
  askText,
  classifyJoyoError,
  failureKey,
  hostedInput,
  readSettings,
  safeHref,
  sanitizeAsk,
  writeSettings,
} from "./joyo-chat";

const memory = (): KeyValue & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return {
    data,
    get: (k) => data.get(k) ?? null,
    set: (k, v) => void data.set(k, v),
    remove: (k) => void data.delete(k),
  };
};

const msg = (role: "user" | "assistant", content: string, i = 0): ChatMessage => ({ id: `m${i}`, role, content, at: i });

describe("safeHref", () => {
  test("http, https and mailto only", () => {
    expect(safeHref("https://joyorogo.com/x")).toBe("https://joyorogo.com/x");
    expect(safeHref("http://a.test")).toBe("http://a.test");
    expect(safeHref("mailto:a@b.test")).toBe("mailto:a@b.test");
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("data:text/html,x")).toBeNull();
    expect(safeHref("//evil.test")).toBeNull();
    expect(safeHref("https://a.test/ b")).toBeNull();
    expect(safeHref(`https://a.test/${"x".repeat(3000)}`)).toBeNull();
  });
});

describe("sanitizeAsk", () => {
  test("keeps a plain question, flattens whitespace and control characters", () => {
    expect(sanitizeAsk("  Aku mau makan  nasi\n\tputih  ")).toBe("Aku mau makan nasi putih");
    expect(sanitizeAsk("a\u0000b\u202ec")).toBe("a b\u202ec");
  });
  test("drops non-strings and empties, caps the length", () => {
    expect(sanitizeAsk(undefined)).toBeUndefined();
    expect(sanitizeAsk(42)).toBeUndefined();
    expect(sanitizeAsk(["x"])).toBeUndefined();
    expect(sanitizeAsk("   ")).toBeUndefined();
    expect(sanitizeAsk("x".repeat(5000))).toHaveLength(HOSTED_LIMITS.messageChars);
  });
});

describe("askText", () => {
  const t = (key: string, o: Record<string, string | number>) => `${key}:${JSON.stringify(o)}`;
  test("one food with grams, one without, several", () => {
    expect(askText([{ name: "Nasi putih", grams: 149.6 }], t)).toBe('ask.food:{"name":"Nasi putih","grams":150}');
    expect(askText([{ name: "Nasi putih" }], t)).toBe('ask.foodNoGrams:{"name":"Nasi putih"}');
    expect(askText([{ name: "Nasi putih", grams: 0 }], t)).toBe('ask.foodNoGrams:{"name":"Nasi putih"}');
    expect(askText([{ name: "Tempe", grams: 50 }, { name: "Nasi" }], t)).toBe('ask.items:{"list":"Tempe (50 g), Nasi"}');
  });
  test("nothing nameable gives nothing", () => {
    expect(askText([], t)).toBeUndefined();
    expect(askText([{ name: "   " }], t)).toBeUndefined();
  });
  test("a long name is cut and more than six foods are not listed", () => {
    const text = askText(Array.from({ length: 9 }, (_, i) => ({ name: `f${i}` })), t)!;
    expect(text).toContain("f5");
    expect(text).not.toContain("f6");
    expect(askText([{ name: "x".repeat(200) }], t)).toContain("x".repeat(60));
    expect(askText([{ name: "x".repeat(200) }], t)).not.toContain("x".repeat(61));
  });
});

describe("settings in storage", () => {
  test("nothing stored is the defaults, with no hosted consent", () => {
    const kv = memory();
    const settings = readSettings(kv);
    expect(settings.hostedConsent).toBeNull();
    expect(hostedAccess(settings, null)).toEqual({ ok: false, reason: "noConsent" });
  });
  test("a granted consent survives a write and a read", () => {
    const kv = memory();
    writeSettings(grantHostedConsent(readSettings(kv), 1_000), kv);
    expect(hostedAccess(readSettings(kv), null)).toEqual({ ok: true });
  });
  test("a damaged record reads as the defaults", () => {
    const kv = memory();
    kv.set("joyorogo.ai.settings", "{not json");
    expect(readSettings(kv).hostedConsent).toBeNull();
  });
});

describe("hostedInput", () => {
  const options = { locale: "id" as const, today: "2026-10-22", consentVersion: 1 };
  test("sends role and text only, capped per turn", () => {
    const input = hostedInput([{ ...msg("user", "x".repeat(3000)), model: "secret", steps: [] }], options);
    expect(input.messages).toEqual([{ role: "user", content: "x".repeat(HOSTED_LIMITS.messageChars) }]);
    expect(input).toMatchObject(options);
  });
  test("keeps the last twelve turns and drops empty ones", () => {
    const history = Array.from({ length: 20 }, (_, i) => msg(i % 2 === 0 ? "user" : "assistant", `t${i}`, i));
    history.push(msg("user", "   ", 21));
    const input = hostedInput(history, options);
    expect(input.messages).toHaveLength(HOSTED_LIMITS.turns);
    expect(input.messages[input.messages.length - 1]!.content).toBe("t19");
  });
});

describe("classifyJoyoError", () => {
  const orpc = (code: ConstructorParameters<typeof ORPCError>[0], data?: unknown) => new ORPCError(code, { data });
  test("the paywall, the refusals and the cap", () => {
    expect(classifyJoyoError(orpc("FORBIDDEN", { paywall: true }))).toEqual({ kind: "paywall" });
    expect(classifyJoyoError(orpc("FORBIDDEN", { reason: "minor" }))).toEqual({ kind: "minor" });
    expect(classifyJoyoError(orpc("FORBIDDEN", { reason: "noConsent" }))).toEqual({ kind: "noConsent" });
    expect(classifyJoyoError(orpc("TOO_MANY_REQUESTS", { reason: "cap", cap: 20 }))).toEqual({ kind: "cap" });
    expect(classifyJoyoError(orpc("SERVICE_UNAVAILABLE", { reason: "off" }))).toEqual({ kind: "off" });
  });
  test("an older server answers NOT_FOUND", () => {
    expect(classifyJoyoError(orpc("NOT_FOUND"))).toEqual({ kind: "unavailable" });
  });
  test("a stop is not an error", () => {
    const ctl = new AbortController();
    ctl.abort();
    expect(classifyJoyoError(new Error("x"), ctl.signal)).toEqual({ kind: "aborted" });
    expect(classifyJoyoError(new DOMException("x", "AbortError"))).toEqual({ kind: "aborted" });
  });
  test("failures after the stream started carry their reason; unknown ones read as server", () => {
    expect(classifyJoyoError(orpc("INTERNAL_SERVER_ERROR", { reason: "timeout" }))).toEqual({ kind: "error", reason: "timeout" });
    expect(classifyJoyoError(orpc("UNPROCESSABLE_CONTENT", { reason: "truncated" }))).toEqual({ kind: "error", reason: "truncated" });
    expect(classifyJoyoError(orpc("INTERNAL_SERVER_ERROR", { reason: "weird" }))).toEqual({ kind: "error", reason: "server" });
    expect(classifyJoyoError(orpc("INTERNAL_SERVER_ERROR"))).toEqual({ kind: "error", reason: "server" });
  });
  test("a dropped connection is network", () => {
    expect(classifyJoyoError(new TypeError("Failed to fetch"))).toEqual({ kind: "error", reason: "network" });
  });
  test("a FORBIDDEN without the known data is an ordinary error", () => {
    expect(classifyJoyoError(orpc("FORBIDDEN", { reason: "other" }))).toEqual({ kind: "error", reason: "server" });
  });
});

describe("failureKey", () => {
  test("the screens with their own card have no line", () => {
    expect(failureKey({ kind: "paywall" })).toBeNull();
    expect(failureKey({ kind: "noConsent" })).toBeNull();
    expect(failureKey({ kind: "unavailable" })).toBeNull();
    expect(failureKey({ kind: "aborted" })).toBeNull();
    expect(failureKey({ kind: "cap" })).toBe("blocked.cap");
    expect(failureKey({ kind: "error", reason: "timeout" })).toBe("errors.timeout");
  });
});
