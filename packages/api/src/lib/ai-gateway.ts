// Cloudflare AI Gateway for every model call of a request (docs/ai-gateway.md). The binding stays the same; each
// `run` gains a third argument, `{ gateway: { id, collectLog, metadata } }`, so the gateway dashboard shows the
// prompt, answer, latency, tokens and errors per call, tagged with who asked and which procedure called.
//
// Photos and voice notes are never logged: a call whose input carries a long base64 string (an image or audio) sends
// collectLog: false. It still counts in the gateway's analytics (requests, latency, errors, tokens), only without the
// stored request and response. Scan photos are meant to expire from R2 in ~2 days; a gateway log would outlive that.
import type { AiBinding } from "../context";

/** A string this long in a model input is a base64 photo or audio clip, never prompt text. */
const MEDIA_CHARS = 20_000;

/** True when the input holds a media payload anywhere (data: URL or raw base64), checked without stringifying it. */
export function carriesMedia(value: unknown, depth = 0): boolean {
  if (typeof value === "string") return value.length >= MEDIA_CHARS || value.startsWith("data:image/") || value.startsWith("data:audio/");
  if (depth > 6 || value === null || typeof value !== "object") return false;
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return true;
  const children = Array.isArray(value) ? value : Object.values(value as Record<string, unknown>);
  return children.some((child) => carriesMedia(child, depth + 1));
}

/** Gateway log metadata: at most 5 entries of strings, numbers or booleans. */
export type GatewayMetadata = Record<string, string | number | boolean>;

/**
 * `ai` with every run routed through gateway `id`. No id (AI_GATEWAY_ID unset) = the binding as it was.
 * Other members of the binding (aiGatewayLogId, gateway(), ...) pass through untouched.
 */
export function withGateway<T extends AiBinding>(ai: T, id: string | undefined, metadata: GatewayMetadata = {}): T {
  if (!id) return ai;
  const meta = Object.fromEntries(Object.entries(metadata).slice(0, 5));
  return new Proxy(ai, {
    get(target, prop) {
      if (prop !== "run") {
        const member = Reflect.get(target, prop, target);
        return typeof member === "function" ? member.bind(target) : member;
      }
      return (model: string, input: unknown, options?: Record<string, unknown>) =>
        (target.run as (model: string, input: unknown, options?: unknown) => Promise<unknown>).call(target, model, input, {
          ...options,
          gateway: {
            id,
            collectLog: !carriesMedia(input),
            metadata: meta,
            ...((options?.gateway as Record<string, unknown> | undefined) ?? {}),
          },
        });
    },
  }) as T;
}
