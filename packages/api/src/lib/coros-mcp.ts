import { z } from "zod";

import { parseActivityDetail, parseSportRecords } from "./coros-parse";
import type { CorosActivity, CorosActivityDetail, ToolOutput } from "./coros-parse";

// A minimal MCP client over Streamable HTTP (https://modelcontextprotocol.io/specification/2025-06-18/basic/transports):
// JSON-RPC 2.0 over POST, the answer is either one JSON body or a short SSE stream carrying it. Only what a sync needs:
// initialize, notifications/initialized, tools/call. COROS's endpoint is stateless (changelog 2026-06-24) but a session id
// is kept when the server hands one out.

export const COROS_MCP_URL = "https://mcp.coros.com/mcp";
const PROTOCOL_VERSION = "2025-06-18";
const TIMEOUT_MS = 15_000;

/** `unauthorized`: the token was refused (401). `unavailable`: the network or the server failed. `tool`: the tool answered with an error. */
export type CorosMcpFailure = "unauthorized" | "unavailable" | "tool";

export class CorosMcpError extends Error {
  constructor(
    readonly failure: CorosMcpFailure,
    message: string = failure,
  ) {
    super(message);
    this.name = "CorosMcpError";
  }
}

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

const rpcResponse = z.object({
  id: z.union([z.number(), z.string(), z.null()]).optional(),
  result: z.unknown().optional(),
  error: z.object({ code: z.number().optional(), message: z.string().optional() }).optional(),
});

const initializeResult = z.object({ protocolVersion: z.string().optional() });

const toolResult = z.object({
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })).optional(),
  structuredContent: z.unknown().optional(),
  isError: z.boolean().optional(),
});

/** The JSON-RPC messages inside an SSE body: each event's `data:` lines joined, parsed as JSON. */
function sseMessages(body: string): unknown[] {
  const messages: unknown[] = [];
  for (const event of body.split(/\r?\n\r?\n/)) {
    const data = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, ""))
      .join("\n");
    if (data === "") continue;
    try {
      messages.push(JSON.parse(data));
    } catch {
      // A keep-alive or comment event: nothing to read.
    }
  }
  return messages;
}

export class CorosMcpClient {
  private nextId = 1;
  private sessionId: string | null = null;
  private protocolVersion = PROTOCOL_VERSION;
  private ready: Promise<void> | null = null;

  constructor(
    private readonly accessToken: string,
    private readonly fetcher: Fetcher = (input, init) => fetch(input, init),
    private readonly url: string = COROS_MCP_URL,
  ) {}

  private async post(body: unknown, withProtocolHeader: boolean): Promise<Response> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.accessToken}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    };
    if (withProtocolHeader) headers["mcp-protocol-version"] = this.protocolVersion;
    if (this.sessionId) headers["mcp-session-id"] = this.sessionId;
    let response: Response;
    try {
      response = await this.fetcher(this.url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      throw new CorosMcpError("unavailable", error instanceof Error ? error.message : "request failed");
    }
    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel();
      throw new CorosMcpError("unauthorized");
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new CorosMcpError("unavailable", `HTTP ${response.status}`);
    }
    return response;
  }

  /** One request, its result. The reply may be JSON or SSE; the message whose id matches ours is the answer. */
  private async request(method: string, params: unknown, withProtocolHeader: boolean): Promise<unknown> {
    const id = this.nextId++;
    const response = await this.post({ jsonrpc: "2.0", id, method, params }, withProtocolHeader);
    const session = response.headers.get("mcp-session-id");
    if (session) this.sessionId = session;
    const text = await response.text().catch(() => {
      throw new CorosMcpError("unavailable", "unreadable body");
    });
    const contentType = response.headers.get("content-type") ?? "";
    let candidates: unknown[];
    if (contentType.includes("text/event-stream")) {
      candidates = sseMessages(text);
    } else {
      try {
        const parsed: unknown = JSON.parse(text);
        candidates = Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        throw new CorosMcpError("unavailable", "not JSON");
      }
    }
    for (const candidate of candidates) {
      const message = rpcResponse.safeParse(candidate);
      if (!message.success || message.data.id !== id) continue;
      if (message.data.error) {
        throw new CorosMcpError("tool", message.data.error.message ?? "JSON-RPC error");
      }
      return message.data.result;
    }
    throw new CorosMcpError("unavailable", "no answer to the request");
  }

  private initialize(): Promise<void> {
    this.ready ??= (async () => {
      const result = await this.request(
        "initialize",
        { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "JoyoRogo", version: "1.0.0" } },
        false,
      );
      const negotiated = initializeResult.safeParse(result);
      if (negotiated.success && negotiated.data.protocolVersion) this.protocolVersion = negotiated.data.protocolVersion;
      // The initialized notification has no id and no answer (202); only its status matters.
      const response = await this.post({ jsonrpc: "2.0", method: "notifications/initialized" }, true);
      await response.body?.cancel();
    })();
    // A failed handshake must not poison later calls on this client.
    this.ready.catch(() => {
      this.ready = null;
    });
    return this.ready;
  }

  /** Calls one tool; a tool-level error (`isError`) is a `CorosMcpError("tool")`. */
  async callTool(name: string, args: Record<string, unknown>): Promise<ToolOutput> {
    await this.initialize();
    const raw = await this.request("tools/call", { name, arguments: args }, true);
    const parsed = toolResult.safeParse(raw);
    if (!parsed.success) throw new CorosMcpError("unavailable", "unexpected tool result");
    const text = (parsed.data.content ?? [])
      .map((block) => (block.type === "text" ? (block.text ?? "") : ""))
      .filter((part) => part !== "")
      .join("\n");
    if (parsed.data.isError) throw new CorosMcpError("tool", text || name);
    return { text, ...(parsed.data.structuredContent === undefined ? {} : { structured: parsed.data.structuredContent }) };
  }

  /** Activities between two `yyyyMMdd` days (all sports, every filter off). */
  async querySportRecords(startDate: string, endDate: string, limit: number): Promise<{ activities: CorosActivity[]; unparsed: number }> {
    const output = await this.callTool("querySportRecords", {
      startDate,
      endDate,
      sportTypeCodes: [65535],
      minDistanceKm: 0,
      maxDistanceKm: 0,
      minDurationMinutes: 0,
      maxDurationMinutes: 0,
      maxAveragePace: "",
      locationKeyword: "",
      limit,
    });
    return parseSportRecords(output);
  }

  async getActivityDetail(labelId: string, sportType: number): Promise<CorosActivityDetail> {
    return parseActivityDetail(await this.callTool("getActivityDetail", { labelId, sportType }));
  }
}
