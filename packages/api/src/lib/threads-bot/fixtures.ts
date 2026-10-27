// Test-only: a scripted Threads Graph API (globalThis.fetch stub) and canned scan results for the mention bot's tests.
// No network, no real token.

import { VisionError } from "../vision";
import type { VisionAnalysis } from "../vision";
import type { ThreadsMedia } from "./graph";

export const OWN = { id: "100", username: "joyorogo" };
export const IMAGE_URL = "https://scontent.cdninstagram.com/v/photo.jpg";

export type GraphCall = { method: string; path: string; params: URLSearchParams };

export class FakeGraph {
  media = new Map<string, ThreadsMedia>();
  mentions: ThreadsMedia[] = [];
  calls: GraphCall[] = [];
  published: { replyTo: string; text: string; creation: string }[] = [];
  imageFetches = 0;
  /** Set to make threads_publish answer an error (the container is still created). */
  failPublish = false;
  failImage = false;
  failRefresh = false;
  failMentions = false;
  private containers = new Map<string, { replyTo: string; text: string }>();
  private realFetch = globalThis.fetch;

  install(): void {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) =>
      this.handle(String(input), init)) as typeof fetch;
  }

  uninstall(): void {
    globalThis.fetch = this.realFetch;
  }

  reset(): void {
    this.media.clear();
    this.mentions = [];
    this.calls = [];
    this.published = [];
    this.imageFetches = 0;
    this.failPublish = false;
    this.failImage = false;
    this.failRefresh = false;
    this.failMentions = false;
    this.containers.clear();
  }

  add(post: ThreadsMedia): ThreadsMedia {
    this.media.set(post.id, post);
    return post;
  }

  callsTo(pathPart: string): GraphCall[] {
    return this.calls.filter((call) => call.path.includes(pathPart));
  }

  private async handle(rawUrl: string, init?: RequestInit): Promise<Response> {
    const url = new URL(rawUrl);
    const method = init?.method ?? "GET";
    const params = new URLSearchParams(url.search);
    if (method === "POST" && init?.body)
      for (const [k, v] of new URLSearchParams(String(init.body))) params.set(k, v);

    if (url.hostname === "scontent.cdninstagram.com" || url.hostname.endsWith(".example.net")) {
      this.imageFetches += 1;
      if (this.failImage) return new Response("nope", { status: 500 });
      return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), {
        headers: { "content-type": "image/jpeg" },
      });
    }

    this.calls.push({ method, path: url.pathname, params });
    const path = url.pathname.replace(/^\/v1\.0/, "");
    if (path === "/refresh_access_token") {
      return this.failRefresh
        ? Response.json({ error: { message: "token too new", code: 190 } }, { status: 400 })
        : Response.json({ access_token: "tok-refreshed", expires_in: 5_184_000 });
    }
    if (path === "/oauth/access_token") return Response.json({ access_token: "short-token" });
    if (path === "/access_token")
      return Response.json({ access_token: "long-token", expires_in: 5_184_000 });
    if (path === "/me") return Response.json(OWN);
    if (path === `/${OWN.id}/mentions`) {
      if (this.failMentions)
        return Response.json({ error: { message: "rate limited", code: 4 } }, { status: 429 });
      const since = Number(params.get("since") ?? 0);
      const data = this.mentions.filter(
        (post) =>
          Date.parse(post.timestamp!.replace(/([+-]\d{2})(\d{2})$/, "$1:$2")) / 1000 >= since,
      );
      return Response.json({ data });
    }
    if (path === `/${OWN.id}/threads` && method === "POST") {
      const id = `container-${this.containers.size + 1}`;
      this.containers.set(id, {
        replyTo: params.get("reply_to_id") ?? "",
        text: params.get("text") ?? "",
      });
      return Response.json({ id });
    }
    if (path === `/${OWN.id}/threads_publish` && method === "POST") {
      const creation = params.get("creation_id") ?? "";
      const container = this.containers.get(creation);
      if (this.failPublish || !container)
        return Response.json({ error: { message: "publish failed", code: 1 } }, { status: 400 });
      this.published.push({ ...container, creation });
      return Response.json({ id: `reply-${this.published.length}` });
    }
    const post = this.media.get(path.slice(1));
    return post
      ? Response.json(post)
      : Response.json({ error: { message: "not found", code: 100 } }, { status: 404 });
  }
}

/** An ISO timestamp in Threads' +0000 style, `agoMs` before `now`. */
export function threadsTime(now: number, agoMs = 60_000): string {
  return new Date(now - agoMs).toISOString().replace(/\.\d{3}Z$/, "+0000");
}

export function analysis(
  items: { name: string; kcal: number; confidence?: number }[],
): VisionAnalysis {
  return {
    items: items.map((item) => ({ ...item, kind: "other" })),
    model: "@cf/test/vision",
    usage: { total_tokens: 10 },
    tooMany: false,
    timing: { modelMs: 1, attempts: 1 },
  } as unknown as VisionAnalysis;
}

export function visionFailure(
  reason: "not_food" | "unclear" | "too_many" | "timeout" | "failed",
): VisionError {
  return new VisionError(reason, { itemCount: 0, finish: null, attempts: 1, usage: null });
}
