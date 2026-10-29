import { afterEach, beforeAll, describe, expect, test } from "bun:test";

import type { SendResult } from "./send";
import { IMPORT_CONTENT_TYPE } from "./types";

// `lib/env.ts` refuses to load without an API origin, and `bunfig.toml` turns .env loading off: set it, then import.
process.env.VITE_SERVER_URL = "https://api.example/";
let sendImport: (blob: Blob, fileName: string, signal?: AbortSignal) => Promise<SendResult>;
beforeAll(async () => {
  ({ sendImport } = await import("./send"));
});

type Seen = { url: string; init: RequestInit | undefined };
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function stubFetch(answer: () => Response | Promise<Response>): Seen[] {
  const seen: Seen[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(url), init });
    return answer();
  }) as unknown as typeof fetch;
  return seen;
}

const FILE = new Blob(["gzip bytes"]);
const NAME = "joyofit-import-20261029-1200.ndjson.gz";

describe("sendImport", () => {
  test("POSTs the Blob to the proxy with the cookie, the import type and the encoded file name", async () => {
    const seen = stubFetch(() => Response.json({ id: "a1b2c3d4-0000" }, { status: 201 }));
    expect(await sendImport(FILE, NAME)).toEqual({ ok: true });
    expect(await sendImport(FILE, "my file&1.gz")).toEqual({ ok: true });
    expect(seen[0]?.url).toBe(`https://api.example/api/fit/imports?filename=${NAME}`);
    expect(seen[1]?.url).toBe("https://api.example/api/fit/imports?filename=my%20file%261.gz");
    expect(seen[0]?.init?.method).toBe("POST");
    expect(seen[0]?.init?.credentials).toBe("include");
    expect(seen[0]?.init?.body).toBe(FILE);
    expect(new Headers(seen[0]?.init?.headers).get("content-type")).toBe(IMPORT_CONTENT_TYPE);
  });

  test("a 200 (the same file already there) is a success too", async () => {
    stubFetch(() => Response.json({ id: "a1b2c3d4-0000" }));
    expect(await sendImport(FILE, NAME)).toEqual({ ok: true });
  });

  test("402 is the paywall, 401 the session, 413 the size limit", async () => {
    stubFetch(() => Response.json({ error: "founder_required", paywall: true }, { status: 402 }));
    expect(await sendImport(FILE, NAME)).toEqual({ ok: false, reason: "paywall" });
    stubFetch(() => Response.json({ error: "unauthorized" }, { status: 401 }));
    expect(await sendImport(FILE, NAME)).toEqual({ ok: false, reason: "unauthorized" });
    stubFetch(() => Response.json({ error: "too_large", maxBytes: 1 }, { status: 413 }));
    expect(await sendImport(FILE, NAME)).toEqual({ ok: false, reason: "too_large" });
  });

  test("nothing came back is the network", async () => {
    globalThis.fetch = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    expect(await sendImport(FILE, NAME)).toEqual({ ok: false, reason: "network" });
  });

  test("anything else is the server, with the API's error code when it sent one", async () => {
    stubFetch(() => Response.json({ error: "fit_api_unreachable" }, { status: 502 }));
    expect(await sendImport(FILE, NAME)).toEqual({
      ok: false,
      reason: "server",
      detail: "fit_api_unreachable",
    });
    stubFetch(() => new Response("oops", { status: 500 }));
    expect(await sendImport(FILE, NAME)).toEqual({ ok: false, reason: "server" });
    stubFetch(() => Response.json({ error: "unsupported_media_type" }, { status: 415 }));
    expect((await sendImport(FILE, NAME)).ok).toBe(false);
  });

  test("a success that is not JSON is a server problem, not a crash", async () => {
    stubFetch(() => new Response("<html>", { status: 200 }));
    expect(await sendImport(FILE, NAME)).toEqual({ ok: false, reason: "server" });
  });

  test("an aborted send hands the signal to fetch", async () => {
    const seen = stubFetch(() => Response.json({}));
    const controller = new AbortController();
    await sendImport(FILE, NAME, controller.signal);
    expect(seen[0]?.init?.signal).toBe(controller.signal);
  });
});
