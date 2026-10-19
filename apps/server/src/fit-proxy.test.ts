import { describe, expect, test } from "bun:test";
import { Hono } from "hono";

import { registerFitProxy, sessionCookieHeader } from "./fit-proxy";

type Call = { url: string; method: string; headers: Headers; body: string };

function setup(upstream: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const app = new Hono();
  registerFitProxy(app, {
    allowedOrigins: [APP_ORIGIN],
    createAuth: async () =>
      ({
        api: {
          getSession: async ({ headers }: { headers: Headers }) =>
            headers.get("cookie")?.includes("session_token=good") ? { user: { id: "u1" } } : null,
        },
      }) as never,
    baseUrl: () => "https://fit.test",
    fetch: (async (url: string, init: RequestInit) => {
      const call = {
        url,
        method: init.method ?? "GET",
        headers: new Headers(init.headers),
        body: init.body ? await new Response(init.body).text() : "",
      };
      calls.push(call);
      return upstream(call);
    }) as unknown as typeof fetch,
  });
  return { app, calls };
}

const APP_ORIGIN = "https://app.test";
/** What a POST from the web app carries: its origin and the one content type an upload may have. */
const FROM_APP = { origin: APP_ORIGIN, "content-type": "application/octet-stream" };
const GOOD = "better-auth.session_token=good; better-auth.session_data=abc; theme=dark; _ga=1";

describe("session cookies", () => {
  test("only the session cookies are kept, with or without the __Secure- prefix", () => {
    expect(sessionCookieHeader(GOOD)).toBe(
      "better-auth.session_token=good; better-auth.session_data=abc",
    );
    expect(sessionCookieHeader("__Secure-better-auth.session_token=x")).toBe(
      "__Secure-better-auth.session_token=x",
    );
    expect(sessionCookieHeader("theme=dark")).toBeNull();
    expect(sessionCookieHeader(null)).toBeNull();
  });
});

describe("fit proxy", () => {
  test("forwards a read with the session cookies only and passes the answer through", async () => {
    const { app, calls } = setup(() =>
      Response.json(
        { days: [] },
        { headers: { "set-cookie": "x=1", "access-control-allow-origin": "https://evil.test" } },
      ),
    );
    const res = await app.request("/api/fit/sleep?from=2026-10-01&to=2026-10-19", {
      headers: { cookie: GOOD, origin: "https://app.test" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ days: [] });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://fit.test/v1/sleep?from=2026-10-01&to=2026-10-19");
    expect(calls[0]?.headers.get("cookie")).toBe(
      "better-auth.session_token=good; better-auth.session_data=abc",
    );
    // The other API's cookies and CORS headers never reach the browser through this host.
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  test("an upload streams its body and length through, and a download keeps its name", async () => {
    const { app, calls } = setup((call) =>
      call.method === "POST"
        ? Response.json({ id: "a1b2c3d4-0000" }, { status: 201 })
        : new Response("bytes", {
            headers: {
              "content-type": "application/octet-stream",
              "content-disposition": 'attachment; filename="face.hwt"',
              "cache-control": "private, no-store",
            },
          }),
    );
    const post = await app.request("/api/fit/watchfaces?filename=face.hwt", {
      method: "POST",
      headers: { cookie: GOOD, ...FROM_APP, "content-length": "5" },
      body: "hello",
    });
    expect(post.status).toBe(201);
    expect(calls[0]).toMatchObject({
      url: "https://fit.test/v1/watchfaces?filename=face.hwt",
      method: "POST",
      body: "hello",
    });
    expect(calls[0]?.headers.get("content-length")).toBe("5");

    const get = await app.request("/api/fit/watchfaces/a1b2c3d4-0000/file", {
      headers: { cookie: GOOD },
    });
    expect(await get.text()).toBe("bytes");
    expect(get.headers.get("content-disposition")).toBe('attachment; filename="face.hwt"');
    expect(get.headers.get("cache-control")).toBe("private, no-store");
  });

  test("an upload without a length or over the cap is refused here and never forwarded", async () => {
    const { app, calls } = setup(() => Response.json({}, { status: 201 }));
    const noLength = await app.request("/api/fit/watchfaces", {
      method: "POST",
      headers: { cookie: GOOD, ...FROM_APP, "transfer-encoding": "chunked" },
    });
    expect(noLength.status).toBe(411);
    const big = await app.request("/api/fit/watchfaces", {
      method: "POST",
      headers: { cookie: GOOD, ...FROM_APP, "content-length": String(8 * 1024 * 1024 + 1) },
      body: "x",
    });
    expect(big.status).toBe(413);
    expect(await big.json()).toEqual({ error: "too_large", maxBytes: 8 * 1024 * 1024 });
    expect(calls).toHaveLength(0);
    const ok = await app.request("/api/fit/watchfaces", {
      method: "POST",
      headers: { cookie: GOOD, ...FROM_APP, "content-length": "1" },
      body: "x",
    });
    expect(ok.status).toBe(201);
  });

  test("only the headers the JoyoFit API reads are forwarded: no hop-by-hop, host, origin or foreign cookies", async () => {
    const { app, calls } = setup(() => Response.json({}));
    await app.request("/api/fit/sleep?from=a&to=b", {
      headers: {
        cookie: GOOD,
        origin: "https://app.test",
        connection: "keep-alive",
        "x-forwarded-for": "1.2.3.4",
        authorization: "Bearer x",
        "user-agent": "ua",
      },
    });
    const sent = [...(calls[0]?.headers.keys() ?? [])].sort();
    expect(sent).toEqual(["accept", "cookie"]);
  });

  test("the other API's refusal (Pro only, not found) is the answer", async () => {
    const { app } = setup(() =>
      Response.json({ error: "founder_required", paywall: true }, { status: 402 }),
    );
    const res = await app.request("/api/fit/watchfaces", {
      method: "POST",
      headers: { cookie: GOOD, ...FROM_APP, "content-length": "1" },
      body: "x",
    });
    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({ error: "founder_required", paywall: true });
  });

  test("CSRF: a POST or DELETE needs the Origin of one of our web apps; without it, or from another site, it is 403 and goes nowhere", async () => {
    const { app, calls } = setup(() => Response.json({ deleted: true }));
    const upload = { method: "POST", body: "x" } as const;
    for (const headers of [
      // A cross-site form or fetch from an attacker's page: the cookie rides along, the Origin is theirs.
      {
        cookie: GOOD,
        origin: "https://evil.test",
        "content-type": "application/octet-stream",
        "content-length": "1",
      },
      // No Origin at all (not a browser page of ours).
      { cookie: GOOD, "content-type": "application/octet-stream", "content-length": "1" },
      // Same host name, other scheme or port, or a lookalike.
      {
        cookie: GOOD,
        origin: "http://app.test",
        "content-type": "application/octet-stream",
        "content-length": "1",
      },
      {
        cookie: GOOD,
        origin: "https://app.test.evil.test",
        "content-type": "application/octet-stream",
        "content-length": "1",
      },
      {
        cookie: GOOD,
        origin: "null",
        "content-type": "application/octet-stream",
        "content-length": "1",
      },
    ]) {
      const res = await app.request("/api/fit/watchfaces", { ...upload, headers });
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "forbidden_origin" });
    }
    const del = await app.request("/api/fit/watchfaces/a1b2c3d4-0000", {
      method: "DELETE",
      headers: { cookie: GOOD, origin: "https://evil.test" },
    });
    expect(del.status).toBe(403);
    const delNoOrigin = await app.request("/api/fit/watchfaces/a1b2c3d4-0000", {
      method: "DELETE",
      headers: { cookie: GOOD },
    });
    expect(delNoOrigin.status).toBe(403);
    expect(calls).toHaveLength(0);

    // Our own origin may delete, and reads need no Origin (they are not state changes, and unreadable cross-site).
    const ok = await app.request("/api/fit/watchfaces/a1b2c3d4-0000", {
      method: "DELETE",
      headers: { cookie: GOOD, origin: APP_ORIGIN },
    });
    expect(ok.status).toBe(200);
    expect(calls[0]).toMatchObject({
      method: "DELETE",
      url: "https://fit.test/v1/watchfaces/a1b2c3d4-0000",
    });
    expect((await app.request("/api/fit/watchfaces", { headers: { cookie: GOOD } })).status).toBe(
      200,
    );
  });

  test("an upload must be application/octet-stream: the types a plain cross-site form can send are 415", async () => {
    const { app, calls } = setup(() => Response.json({}, { status: 201 }));
    for (const type of [
      "text/plain",
      "multipart/form-data; boundary=x",
      "application/x-www-form-urlencoded",
      "application/json",
      "",
    ]) {
      const headers: Record<string, string> = {
        cookie: GOOD,
        origin: APP_ORIGIN,
        "content-length": "1",
      };
      if (type) headers["content-type"] = type;
      const res = await app.request("/api/fit/watchfaces", { method: "POST", headers, body: "x" });
      expect(res.status).toBe(415);
    }
    expect(calls).toHaveLength(0);
    const ok = await app.request("/api/fit/watchfaces", {
      method: "POST",
      headers: {
        cookie: GOOD,
        origin: APP_ORIGIN,
        "content-type": "Application/Octet-Stream; x=1",
        "content-length": "1",
      },
      body: "x",
    });
    expect(ok.status).toBe(201);
    expect(calls[0]?.headers.get("content-type")).toBe("application/octet-stream");
  });

  test("no session is 401 and nothing is forwarded", async () => {
    const { app, calls } = setup(() => Response.json({}));
    expect((await app.request("/api/fit/sleep?from=a&to=b")).status).toBe(401);
    expect(
      (
        await app.request("/api/fit/sleep", {
          headers: { cookie: "better-auth.session_token=stale" },
        })
      ).status,
    ).toBe(401);
    expect(calls).toHaveLength(0);
  });

  test("it is not an open relay: only the listed routes and methods are forwarded", async () => {
    const { app, calls } = setup(() => Response.json({}));
    const headers = { cookie: GOOD };
    for (const [method, path] of [
      ["GET", "/api/fit/sync"],
      ["GET", "/api/fit/account"],
      ["DELETE", "/api/fit/data"],
      ["POST", "/api/fit/sleep"],
      ["PUT", "/api/fit/watchfaces"],
      ["GET", "/api/fit/watchfaces/../imports"],
      ["GET", "/api/fit/watchfaces/abc"],
      ["GET", "/api/fit/"],
      ["PUT", "/api/fit/watchfaces/a1b2c3d4-0000"],
      ["PUT", "/api/fit/studio/projects"],
      ["DELETE", "/api/fit/studio/projects"],
      ["GET", "/api/fit/studio/projects/x"],
      ["GET", "/api/fit/studio/projects/a1b2c3d4-0000/file"],
      ["POST", "/api/fit/studio/projects/a1b2c3d4-0000"],
      ["PATCH", "/api/fit/studio/projects/a1b2c3d4-0000"],
      ["GET", "/api/fit/studio"],
    ] as const) {
      const res = await app.request(path, { method, headers });
      expect(res.status).toBe(404);
    }
    expect(calls).toHaveLength(0);
  });

  describe("studio projects", () => {
    const ID = "a1b2c3d4-0000";
    const JSON_FROM_APP = { origin: APP_ORIGIN, "content-type": "application/json" };

    test("every route is forwarded to /v1/studio/projects with method, query and body intact", async () => {
      const { app, calls } = setup(() => Response.json({ ok: true }));
      const doc = JSON.stringify({ format: "joyofit-studio-project", project: { version: 1 } });
      const len = String(new TextEncoder().encode(doc).length);

      await app.request("/api/fit/studio/projects?x=1", { headers: { cookie: GOOD } });
      await app.request("/api/fit/studio/projects", {
        method: "POST",
        headers: { cookie: GOOD, ...JSON_FROM_APP, "content-length": len },
        body: doc,
      });
      await app.request(`/api/fit/studio/projects/${ID}`, { headers: { cookie: GOOD } });
      await app.request(`/api/fit/studio/projects/${ID}?y=2`, {
        method: "PUT",
        headers: { cookie: GOOD, ...JSON_FROM_APP, "content-length": len },
        body: doc,
      });
      await app.request(`/api/fit/studio/projects/${ID}`, {
        method: "DELETE",
        headers: { cookie: GOOD, origin: APP_ORIGIN },
      });

      expect(calls.map((c) => [c.method, c.url])).toEqual([
        ["GET", "https://fit.test/v1/studio/projects?x=1"],
        ["POST", "https://fit.test/v1/studio/projects"],
        ["GET", `https://fit.test/v1/studio/projects/${ID}`],
        ["PUT", `https://fit.test/v1/studio/projects/${ID}?y=2`],
        ["DELETE", `https://fit.test/v1/studio/projects/${ID}`],
      ]);
      expect(calls[1]?.body).toBe(doc);
      expect(calls[3]?.body).toBe(doc);
      for (const i of [1, 3]) {
        expect(calls[i]?.headers.get("content-type")).toBe("application/json");
        expect(calls[i]?.headers.get("content-length")).toBe(len);
      }
      expect(calls[0]?.headers.get("cookie")).toBe(
        "better-auth.session_token=good; better-auth.session_data=abc",
      );
      expect(calls[4]?.body).toBe("");
    });

    test("POST, PUT and DELETE need an Origin of ours: another or none is 403 and goes nowhere", async () => {
      const { app, calls } = setup(() => Response.json({}));
      for (const [method, path] of [
        ["POST", "/api/fit/studio/projects"],
        ["PUT", `/api/fit/studio/projects/${ID}`],
        ["DELETE", `/api/fit/studio/projects/${ID}`],
      ] as const) {
        for (const origin of ["https://evil.test", undefined]) {
          const headers: Record<string, string> = {
            cookie: GOOD,
            "content-type": "application/json",
            "content-length": "2",
          };
          if (origin) headers.origin = origin;
          const res = await app.request(path, { method, headers, body: "{}" });
          expect(res.status).toBe(403);
          expect(await res.json()).toEqual({ error: "forbidden_origin" });
        }
      }
      expect(calls).toHaveLength(0);
    });

    test("no session is 401 and nothing is forwarded", async () => {
      const { app, calls } = setup(() => Response.json({}));
      expect((await app.request("/api/fit/studio/projects")).status).toBe(401);
      const put = await app.request(`/api/fit/studio/projects/${ID}`, {
        method: "PUT",
        headers: { ...JSON_FROM_APP, "content-length": "2" },
        body: "{}",
      });
      expect(put.status).toBe(401);
      expect(calls).toHaveLength(0);
    });

    test("a JSON body needs a length (411), at most 5 MiB + 64 KiB (413) and application/json (415)", async () => {
      const { app, calls } = setup(() => Response.json({}, { status: 201 }));
      const base = { cookie: GOOD, ...JSON_FROM_APP };
      const noLength = await app.request("/api/fit/studio/projects", {
        method: "POST",
        headers: { ...base, "transfer-encoding": "chunked" },
      });
      expect(noLength.status).toBe(411);
      const max = 5 * 1024 * 1024 + 64 * 1024;
      const big = await app.request(`/api/fit/studio/projects/${ID}`, {
        method: "PUT",
        headers: { ...base, "content-length": String(max + 1) },
        body: "x",
      });
      expect(big.status).toBe(413);
      expect(await big.json()).toEqual({ error: "too_large", maxBytes: max });
      for (const type of ["text/plain", "application/octet-stream", "multipart/form-data; boundary=x", ""]) {
        const headers: Record<string, string> = { ...base, "content-length": "2" };
        delete headers["content-type"];
        if (type) headers["content-type"] = type;
        const res = await app.request("/api/fit/studio/projects", {
          method: "POST",
          headers,
          body: "{}",
        });
        expect(res.status).toBe(415);
      }
      expect(calls).toHaveLength(0);
      const atCap = await app.request("/api/fit/studio/projects", {
        method: "POST",
        headers: { ...base, "content-type": "Application/JSON; charset=utf-8", "content-length": "2" },
        body: "{}",
      });
      expect(atCap.status).toBe(201);
      expect(calls[0]?.headers.get("content-type")).toBe("application/json");
    });

    test("the kinds do not mix: JSON is refused for a watch face upload", async () => {
      const { app, calls } = setup(() => Response.json({}, { status: 201 }));
      const res = await app.request("/api/fit/watchfaces", {
        method: "POST",
        headers: { cookie: GOOD, ...JSON_FROM_APP, "content-length": "2" },
        body: "{}",
      });
      expect(res.status).toBe(415);
      expect(calls).toHaveLength(0);
    });

    test("the other API's 409, 402 and 413 answers and cache-control pass through", async () => {
      const answers = [
        Response.json({ error: "rev_conflict", rev: 4, updatedAt: 9 }, { status: 409 }),
        Response.json({ error: "founder_required", paywall: true }, { status: 402 }),
        Response.json({ error: "too_large", maxBytes: 5242880 }, { status: 413 }),
        Response.json({ id: ID }, { headers: { "cache-control": "private, no-store" } }),
      ];
      const { app } = setup(() => answers.shift() as Response);
      const put = () =>
        app.request(`/api/fit/studio/projects/${ID}`, {
          method: "PUT",
          headers: { cookie: GOOD, ...JSON_FROM_APP, "content-length": "2" },
          body: "{}",
        });
      const conflict = await put();
      expect(conflict.status).toBe(409);
      expect(await conflict.json()).toEqual({ error: "rev_conflict", rev: 4, updatedAt: 9 });
      expect((await put()).status).toBe(402);
      expect((await put()).status).toBe(413);
      const got = await app.request(`/api/fit/studio/projects/${ID}`, { headers: { cookie: GOOD } });
      expect(got.headers.get("cache-control")).toBe("private, no-store");
    });
  });

  test("an unreachable JoyoFit API is a 502, not a hang or a leak", async () => {
    const app = new Hono();
    registerFitProxy(app, {
      createAuth: async () =>
        ({ api: { getSession: async () => ({ user: { id: "u" } }) } }) as never,
      baseUrl: () => "https://fit.test",
      fetch: (async () => {
        throw new TypeError("connection refused");
      }) as unknown as typeof fetch,
    });
    const res = await app.request("/api/fit/sleep", { headers: { cookie: GOOD } });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "fit_api_unreachable" });
  });
});
