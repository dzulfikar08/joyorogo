// Threads webhook plumbing (https://developers.facebook.com/docs/threads/webhooks): the GET verification handshake, the
// X-Hub-Signature-256 check, and reading `mentions` events out of a delivery. No I/O except the HMAC.

import { z } from "zod";

import type { ThreadsMedia } from "./graph";

const encoder = new TextEncoder();

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> | null {
  if (hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) return null;
  const out = new Uint8Array(new ArrayBuffer(hex.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** `X-Hub-Signature-256: sha256=<hex HMAC-SHA256 of the raw body, keyed with the app secret>`; the compare is constant-time (crypto.subtle.verify). */
export async function verifySignature(
  appSecret: string,
  rawBody: string,
  header: string | null | undefined,
): Promise<boolean> {
  const match = header?.trim().match(/^sha256=([0-9a-f]+)$/i);
  const signature = match?.[1] ? hexToBytes(match[1]) : null;
  if (!signature) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify("HMAC", key, signature, encoder.encode(rawBody));
}

/** Test and tooling helper: the header value Meta would send for `rawBody`. */
export async function signBody(appSecret: string, rawBody: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(rawBody)));
  return `sha256=${Array.from(mac, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * GET verification: `hub.mode=subscribe&hub.verify_token=<ours>&hub.challenge=<n>`. Returns the challenge to echo, or null
 * when the mode or token is wrong.
 */
export function verifyChallenge(
  query: Record<string, string | undefined>,
  verifyToken: string,
): string | null {
  if (query["hub.mode"] !== "subscribe") return null;
  const given = query["hub.verify_token"] ?? "";
  if (given.length !== verifyToken.length) return null;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ verifyToken.charCodeAt(i);
  return diff === 0 ? (query["hub.challenge"] ?? "") : null;
}

export type MentionEvent = {
  /** The mentioned Threads user (our brand account): the webhook's target_id, when sent. */
  targetId?: string;
  post: ThreadsMedia;
};

const fieldChange = z.object({ field: z.string(), value: z.unknown() });
const mediaValue = z.looseObject({ id: z.string().min(1) });
const delivery = z.object({
  target_id: z.string().optional(),
  values: z.union([fieldChange, z.array(z.unknown())]).optional(),
  entry: z.array(z.unknown()).optional(),
});
const entrySchema = z.object({
  id: z.string().optional(),
  changes: z.array(z.unknown()).optional(),
});

/**
 * The `mentions` events in a delivery. Meta's Threads doc shows `{ target_id, values: { field, value } }`; Graph webhooks in
 * general wrap the same field/value pairs as `{ entry: [{ id, changes: [{ field, value }] }] }`. Both are read; other fields
 * (replies, publish, delete) and malformed entries are dropped one by one.
 */
export function parseMentionEvents(payload: unknown): MentionEvent[] {
  const parsed = delivery.safeParse(payload);
  if (!parsed.success) return [];
  const out: MentionEvent[] = [];
  const take = (raw: unknown, targetId: string | undefined) => {
    const change = fieldChange.safeParse(raw);
    if (!change.success || change.data.field !== "mentions") return;
    const post = mediaValue.safeParse(change.data.value);
    if (post.success)
      out.push({ post: post.data as ThreadsMedia, ...(targetId ? { targetId } : {}) });
  };

  const { values, entry, target_id } = parsed.data;
  for (const raw of Array.isArray(values) ? values : values ? [values] : []) take(raw, target_id);
  for (const raw of entry ?? []) {
    const wrapped = entrySchema.safeParse(raw);
    if (!wrapped.success) continue;
    for (const change of wrapped.data.changes ?? []) take(change, wrapped.data.id);
  }
  return out;
}
