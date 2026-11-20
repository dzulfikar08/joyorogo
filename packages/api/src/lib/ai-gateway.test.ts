import { describe, expect, test } from "bun:test";

import { carriesMedia, withGateway } from "./ai-gateway";

const recorder = () => {
  const calls: unknown[][] = [];
  return { calls, ai: { run: (...args: unknown[]) => (calls.push(args), Promise.resolve("ok")), aiGatewayLogId: "log-1" } };
};

describe("withGateway", () => {
  test("no gateway id: the binding is returned as it was", () => {
    const { ai } = recorder();
    expect(withGateway(ai, undefined)).toBe(ai);
  });

  test("a text call is logged with the request's metadata", async () => {
    const { ai, calls } = recorder();
    const routed = withGateway(ai, "joyorogo", { user: "u1", route: "/rpc/coach/chat" });
    await routed.run("@cf/model", { messages: [{ role: "user", content: "halo" }] });
    expect(calls[0]?.[2]).toEqual({ gateway: { id: "joyorogo", collectLog: true, metadata: { user: "u1", route: "/rpc/coach/chat" } } });
  });

  test("a photo or a voice note is never logged", async () => {
    const { ai, calls } = recorder();
    const routed = withGateway(ai, "joyorogo");
    const photo = `data:image/jpeg;base64,${"A".repeat(100)}`;
    await routed.run("@cf/vision", { messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: photo } }] }] });
    await routed.run("@cf/whisper", { audio: "B".repeat(30_000) });
    expect(calls.map((call) => (call[2] as { gateway: { collectLog: boolean } }).gateway.collectLog)).toEqual([false, false]);
  });

  test("other binding members pass through, metadata is capped at 5 entries", async () => {
    const { ai, calls } = recorder();
    const routed = withGateway(ai, "g", { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6 });
    expect(routed.aiGatewayLogId).toBe("log-1");
    await routed.run("m", {});
    expect(Object.keys((calls[0]?.[2] as { gateway: { metadata: object } }).gateway.metadata)).toHaveLength(5);
  });

  test("carriesMedia ignores ordinary prompt text", () => {
    expect(carriesMedia({ messages: [{ role: "system", content: "x".repeat(5000) }] })).toBe(false);
    expect(carriesMedia({ image: new Uint8Array(4) })).toBe(true);
  });
});
