import { describe, expect, test } from "bun:test";

import { EXPO_BATCH, fetchReceipts, isExpoToken, sendExpo } from "./expo-push";
import type { ExpoMessage } from "./expo-push";

const message = (to: string): ExpoMessage => ({ to, title: "t", body: "b", data: { v: 1 } });

function fakeFetch(handler: (url: string, body: unknown, headers: Record<string, string>) => Response | Promise<Response>) {
  const calls: { url: string; body: unknown; headers: Record<string, string> }[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const body: unknown = JSON.parse(String(init?.body));
    calls.push({ url: String(input), body, headers });
    return handler(String(input), body, headers);
  }) as typeof fetch;
  return { impl, calls };
}

describe("isExpoToken", () => {
  test("accepts what getExpoPushTokenAsync returns", () => {
    expect(isExpoToken("ExponentPushToken[abc-DEF_123]")).toBe(true);
    expect(isExpoToken("ExpoPushToken[abc]")).toBe(true);
    expect(isExpoToken("fcm:APA91b")).toBe(false);
    expect(isExpoToken("ExponentPushToken[]")).toBe(false);
    expect(isExpoToken("")).toBe(false);
  });
});

describe("sendExpo", () => {
  test("sends in chunks of 100 and keeps the results in order, with the bearer token when configured", async () => {
    const { impl, calls } = fakeFetch((_url, body) =>
      Response.json({ data: (body as ExpoMessage[]).map((m, i) => ({ status: "ok", id: `${m.to}#${i}` })) }),
    );
    const messages = Array.from({ length: EXPO_BATCH + 5 }, (_, i) => message(`ExponentPushToken[t${i}]`));
    const results = await sendExpo({ EXPO_ACCESS_TOKEN: "secret" }, messages, impl);
    expect(calls).toHaveLength(2);
    expect((calls[0]!.body as unknown[]).length).toBe(EXPO_BATCH);
    expect(calls[0]!.headers.Authorization).toBe("Bearer secret");
    expect(results).toHaveLength(EXPO_BATCH + 5);
    expect(results[0]).toEqual({ ok: true, ticketId: "ExponentPushToken[t0]#0" });
    expect(results[EXPO_BATCH]).toEqual({ ok: true, ticketId: `ExponentPushToken[t${EXPO_BATCH}]#0` });
  });

  test("no Authorization header without a token; defaults are filled in and the test endpoint is honoured", async () => {
    const { impl, calls } = fakeFetch(() => Response.json({ data: [{ status: "ok", id: "x" }] }));
    await sendExpo({ EXPO_PUSH_URL: "http://localhost:9/--/api/v2/push/" }, [message("ExponentPushToken[a]")], impl);
    expect(calls[0]!.url).toBe("http://localhost:9/--/api/v2/push/send");
    expect(calls[0]!.headers.Authorization).toBeUndefined();
    expect((calls[0]!.body as ExpoMessage[])[0]).toMatchObject({ sound: "default", priority: "high", ttl: 86_400 });
  });

  test("classifies ticket errors", async () => {
    const { impl } = fakeFetch(() =>
      Response.json({
        data: [
          { status: "error", message: "x", details: { error: "DeviceNotRegistered" } },
          { status: "error", message: "x", details: { error: "MessageRateExceeded" } },
          { status: "error", message: "too big", details: { error: "MessageTooBig" } },
        ],
      }),
    );
    const results = await sendExpo({}, ["a", "b", "c"].map((t) => message(`ExponentPushToken[${t}]`)), impl);
    expect(results).toEqual([
      { ok: false, dead: true, transient: false, error: "DeviceNotRegistered" },
      { ok: false, dead: false, transient: true, error: "MessageRateExceeded" },
      { ok: false, dead: false, transient: false, error: "MessageTooBig" },
    ]);
  });

  test("HTTP 5xx / 429 and network errors are transient, a 400 is not", async () => {
    for (const [status, transient] of [[500, true], [429, true], [400, false]] as const) {
      const { impl } = fakeFetch(() => new Response("no", { status }));
      const [result] = await sendExpo({}, [message("ExponentPushToken[a]")], impl);
      expect(result).toEqual({ ok: false, dead: false, transient, error: `http-${status}` });
    }
    const failing = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await sendExpo({}, [message("ExponentPushToken[a]")], failing)).toEqual([
      { ok: false, dead: false, transient: true, error: "network" },
    ]);
  });

  test("a response with fewer tickets than messages leaves the rest transient", async () => {
    const { impl } = fakeFetch(() => Response.json({ data: [{ status: "ok", id: "only" }] }));
    const results = await sendExpo({}, [message("ExponentPushToken[a]"), message("ExponentPushToken[b]")], impl);
    expect(results[0]?.ok).toBe(true);
    expect(results[1]).toMatchObject({ ok: false, transient: true });
  });
});

describe("fetchReceipts", () => {
  test("maps ok and DeviceNotRegistered receipts; unknown ids are absent; an HTTP error returns nothing", async () => {
    const { impl } = fakeFetch(() =>
      Response.json({
        data: {
          t1: { status: "ok" },
          t2: { status: "error", message: "gone", details: { error: "DeviceNotRegistered" } },
        },
      }),
    );
    const out = await fetchReceipts({}, ["t1", "t2", "t3"], impl);
    expect(out).toEqual({ t1: { ok: true, dead: false }, t2: { ok: false, dead: true, error: "DeviceNotRegistered" } });
    const down = fakeFetch(() => new Response("x", { status: 503 }));
    expect(await fetchReceipts({}, ["t1"], down.impl)).toEqual({});
  });
});
