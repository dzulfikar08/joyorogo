import { describe, expect, test } from "bun:test";

import { CorosMcpClient, CorosMcpError } from "./coros-mcp";

type Seen = { method: string; headers: Headers; body: { method?: string; params?: { name?: string; arguments?: unknown }; id?: number } };

function server(handler: (message: Seen["body"], seen: Seen) => Response) {
  const calls: Seen[] = [];
  const fetcher = async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    const seen = { method: String(init?.method), headers: new Headers(init?.headers), body };
    calls.push(seen);
    return handler(body, seen);
  };
  return { calls, fetcher };
}

const result = (id: number | undefined, value: unknown) => ({ jsonrpc: "2.0", id, result: value });

describe("CorosMcpClient", () => {
  test("initialize, initialized, then tools/call with the bearer token and protocol headers (JSON answers)", async () => {
    const { calls, fetcher } = server((body) => {
      if (body.method === "initialize") {
        return Response.json(result(body.id, { protocolVersion: "2025-03-26" }), { headers: { "mcp-session-id": "sess-1" } });
      }
      if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
      return Response.json(result(body.id, { content: [{ type: "text", text: "hello" }, { type: "text", text: "world" }] }));
    });
    const out = await new CorosMcpClient("tok", fetcher).callTool("getActivityDetail", { labelId: "1", sportType: 100 });
    expect(out).toEqual({ text: "hello\nworld" });
    expect(calls.map((c) => c.body.method)).toEqual(["initialize", "notifications/initialized", "tools/call"]);
    expect(calls[0]!.headers.get("authorization")).toBe("Bearer tok");
    expect(calls[0]!.headers.get("accept")).toBe("application/json, text/event-stream");
    expect(calls[0]!.headers.get("mcp-protocol-version")).toBeNull();
    // After the handshake: the negotiated version and the session id travel with every request.
    expect(calls[1]!.headers.get("mcp-protocol-version")).toBe("2025-03-26");
    expect(calls[2]!.headers.get("mcp-session-id")).toBe("sess-1");
    expect(calls[2]!.body.params).toEqual({ name: "getActivityDetail", arguments: { labelId: "1", sportType: 100 } });
  });

  test("an SSE answer carries the response; other events are ignored", async () => {
    const { fetcher } = server((body) => {
      if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
      const payload = body.method === "initialize" ? { protocolVersion: "2025-06-18" } : { content: [{ type: "text", text: "from sse" }], structuredContent: { a: 1 } };
      const stream = `: keep-alive\n\nevent: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", method: "notifications/progress", params: {} })}\n\nevent: message\ndata: ${JSON.stringify(result(body.id, payload))}\n\n`;
      return new Response(stream, { headers: { "content-type": "text/event-stream" } });
    });
    expect(await new CorosMcpClient("t", fetcher).callTool("x", {})).toEqual({ text: "from sse", structured: { a: 1 } });
  });

  test("401 is unauthorized, 5xx and network failures are unavailable, isError is a tool error", async () => {
    await expect(new CorosMcpClient("t", server(() => new Response("no", { status: 401 })).fetcher).callTool("x", {})).rejects.toMatchObject({
      failure: "unauthorized",
    });
    await expect(new CorosMcpClient("t", server(() => new Response("boom", { status: 502 })).fetcher).callTool("x", {})).rejects.toMatchObject({
      failure: "unavailable",
    });
    const offline = new CorosMcpClient("t", async () => {
      throw new TypeError("network");
    });
    await expect(offline.callTool("x", {})).rejects.toBeInstanceOf(CorosMcpError);

    const failing = server((body) => {
      if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
      if (body.method === "initialize") return Response.json(result(body.id, {}));
      return Response.json(result(body.id, { isError: true, content: [{ type: "text", text: "bad labelId" }] }));
    });
    await expect(new CorosMcpClient("t", failing.fetcher).callTool("x", {})).rejects.toMatchObject({ failure: "tool", message: "bad labelId" });
  });

  test("a failed handshake is retried by the next call", async () => {
    let first = true;
    const { fetcher } = server((body) => {
      if (body.method === "initialize" && first) {
        first = false;
        return new Response("down", { status: 503 });
      }
      if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
      if (body.method === "initialize") return Response.json(result(body.id, {}));
      return Response.json(result(body.id, { content: [{ type: "text", text: "ok" }] }));
    });
    const client = new CorosMcpClient("t", fetcher);
    await expect(client.callTool("x", {})).rejects.toMatchObject({ failure: "unavailable" });
    expect((await client.callTool("x", {})).text).toBe("ok");
  });
});
