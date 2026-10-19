/**
 * The coach conversation as the web holds it: a list of messages in the tab (memory, mirrored to `sessionStorage` so a
 * reload of the tab keeps it, and gone when the tab closes), the payload `coach.chat` takes from it, and the reading of
 * the errors it answers with. The server stores no message (docs/coach.md); "Hapus percakapan" is the only erase there is.
 * Pure apart from the storage object passed in.
 */

import { ORPCError } from "@orpc/client";

/** `coach.chat` limits (`COACH_LIMITS` in packages/api/src/lib/coach-chat.ts; a test keeps them equal). */
export const COACH_INPUT_LIMITS = { maxMessages: 12, maxMessageChars: 2000 } as const;

export type CoachFlag = "injury" | "medical";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** Set on a reply the server wrote without calling the model (a worrying message): shown with a note. */
  flagged: CoachFlag | null;
}

/** The newest messages `coach.chat` takes: at most 12, each trimmed, never empty, the last one from the person. */
export function toPayload(
  messages: readonly ChatMessage[],
): { role: "user" | "assistant"; content: string }[] {
  const usable = messages
    .map((m) => ({
      role: m.role,
      content: m.content.trim().slice(0, COACH_INPUT_LIMITS.maxMessageChars),
    }))
    .filter((m) => m.content !== "");
  while (usable.length > 0 && usable[usable.length - 1]?.role !== "user") usable.pop();
  return usable.slice(-COACH_INPUT_LIMITS.maxMessages);
}

const isFlag = (value: unknown): value is CoachFlag => value === "injury" || value === "medical";

/** Messages out of storage text; anything that is not exactly a message list is dropped, never trusted. */
export function parseStored(text: string | null): ChatMessage[] {
  if (!text) return [];
  try {
    const raw: unknown = JSON.parse(text);
    if (!Array.isArray(raw)) return [];
    const out: ChatMessage[] = [];
    for (const item of raw) {
      if (typeof item !== "object" || item === null) continue;
      const { id, role, content, flagged } = item as Record<string, unknown>;
      if (
        typeof id !== "string" ||
        (role !== "user" && role !== "assistant") ||
        typeof content !== "string" ||
        content === ""
      )
        continue;
      out.push({ id, role, content, flagged: isFlag(flagged) ? flagged : null });
    }
    return out;
  } catch {
    return [];
  }
}

export const storageKey = (userId: string): string => `joyofit-web:coach:${userId}`;

export type CoachErrorKind =
  /** Not Pro (any more): the paywall. */
  | "paywall"
  /** The daily cap is spent. */
  | "capReached"
  /** The server turned the coach off (`COACH_DAILY_CAP=0`) or has no AI binding. */
  | "unavailable"
  /** The model answered nothing usable or timed out; the server's message says which, in the person's language. */
  | "failed"
  /** The request did not reach the server. */
  | "network";

export interface CoachError {
  kind: CoachErrorKind;
  /** The server's own localized message, for `failed`. */
  message: string | null;
  /** The cap in the server's answer, for `capReached`. */
  cap: number | null;
}

export function classifyCoachError(error: unknown): CoachError {
  if (!(error instanceof ORPCError)) return { kind: "network", message: null, cap: null };
  const data = (error.data ?? {}) as {
    paywall?: unknown;
    coachCapReached?: unknown;
    cap?: unknown;
    reason?: unknown;
  };
  if (error.code === "FORBIDDEN" && data.paywall === true)
    return { kind: "paywall", message: null, cap: null };
  if (error.code === "TOO_MANY_REQUESTS" && data.coachCapReached === true) {
    return {
      kind: "capReached",
      message: null,
      cap: typeof data.cap === "number" ? data.cap : null,
    };
  }
  if (error.code === "SERVICE_UNAVAILABLE")
    return { kind: "unavailable", message: null, cap: null };
  if (typeof data.reason === "string") return { kind: "failed", message: error.message, cap: null };
  // A transport problem the client library wrapped (status 0 or a gateway error) is "network"; anything else is a failure.
  return error.status === 0 || error.status === 502 || error.status === 503 || error.status === 504
    ? { kind: "network", message: null, cap: null }
    : { kind: "failed", message: null, cap: null };
}
