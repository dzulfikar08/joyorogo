import { ORPCError } from "@orpc/client";

import { chatLines } from "@joyorogo/api/lib/joyo-ai/conversations";
import type { ChatMessage, KeyValue } from "@joyorogo/api/lib/joyo-ai/conversations";
import { parseSettingsText } from "@joyorogo/api/lib/joyo-ai/settings";
import type { AiSettings } from "@joyorogo/api/lib/joyo-ai/settings";
import type { Locale } from "@joyorogo/i18n";

/** The hosted route's limits (routers/joyo.ts input schema): at most 12 turns, 2,000 characters each. */
export const HOSTED_LIMITS = { turns: 12, messageChars: 2_000 } as const;

/** What the composer accepts: the hosted limit, the same number the server refuses above. */
export const MAX_MESSAGE_CHARS = HOSTED_LIMITS.messageChars;

const SAFE_URL = /^(?:https?:\/\/|mailto:)\S+$/i;

/** A link target that is safe to put in an `href` (http, https, mailto), else null. */
export function safeHref(href: string): string | null {
  return href.length <= 2048 && SAFE_URL.test(href) ? href : null;
}

/**
 * The `?ask=` search param of /joyo as the text for the (unsent) composer: a string, control characters flattened to spaces,
 * trimmed, capped at what the server accepts. Anything else is dropped.
 */
export function sanitizeAsk(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  // eslint-disable-next-line no-control-regex
  const text = raw.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_MESSAGE_CHARS);
  return text === "" ? undefined : text;
}

type AskT = (key: "ask.food" | "ask.foodNoGrams" | "ask.items", options: Record<string, string | number>) => string;

/** One food as the food row sheet knows it. */
export interface AskFood {
  name: string;
  grams?: number | null;
}

const flatName = (name: string): string => name.replace(/\s+/g, " ").trim().slice(0, 60);

/** The question put in the composer by an entry point: it names each food (and the grams of a single one), and is not sent by itself. */
export function askText(foods: readonly AskFood[], t: AskT): string | undefined {
  const named = foods.map((f) => ({ name: flatName(f.name), grams: f.grams ?? null })).filter((f) => f.name !== "");
  if (named.length === 0) return undefined;
  if (named.length === 1) {
    const [food] = named;
    if (food!.grams !== null && food!.grams > 0) return t("ask.food", { name: food!.name, grams: Math.round(food!.grams) });
    return t("ask.foodNoGrams", { name: food!.name });
  }
  const list = named
    .slice(0, 6)
    .map((f) => (f.grams !== null && f.grams > 0 ? `${f.name} (${Math.round(f.grams)} g)` : f.name))
    .join(", ");
  return t("ask.items", { list });
}

// ---- storage: this browser only ----

/** Joyo AI on the web keeps its one-time consent here (the same JSON record as the phone's settings). */
export const SETTINGS_KEY = "joyorogo.ai.settings";

/** `KeyValue` over `localStorage`. A blocked or full storage reads as empty and drops writes: the chat keeps working in memory. */
export const localKeyValue: KeyValue = {
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Quota or private mode: the conversation stays on screen but is not kept.
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      // Nothing to remove from a storage that cannot be reached.
    }
  },
};

export function readSettings(kv: Pick<KeyValue, "get"> = localKeyValue): AiSettings {
  const raw = kv.get(SETTINGS_KEY);
  return parseSettingsText(typeof raw === "string" ? raw : null);
}

export function writeSettings(settings: AiSettings, kv: Pick<KeyValue, "set"> = localKeyValue): void {
  void kv.set(SETTINGS_KEY, JSON.stringify(settings));
}

// ---- the hosted call ----

export interface HostedInput {
  messages: { role: "user" | "assistant"; content: string }[];
  locale: Locale;
  today: string;
  consentVersion: number;
}

/** The request of `client.joyo.chat`: the last turns only, each capped, as the server's schema wants them. */
export function hostedInput(
  history: readonly ChatMessage[],
  options: { locale: Locale; today: string; consentVersion: number },
): HostedInput {
  const messages = chatLines(history)
    .map((m) => ({ role: m.role, content: m.content.trim().slice(0, HOSTED_LIMITS.messageChars) }))
    .filter((m) => m.content !== "")
    .slice(-HOSTED_LIMITS.turns);
  return { messages, ...options };
}

/** Why a hosted call or status read could not give an answer, as the screen words it. */
export type JoyoFailure =
  | { kind: "paywall" }
  | { kind: "minor" }
  | { kind: "noConsent" }
  | { kind: "cap" }
  | { kind: "off" }
  | { kind: "unavailable" }
  | { kind: "aborted" }
  | { kind: "error"; reason: HostedReason };

/** `joyoAi:errors.<reason>` keys the server (or the network) can give after a call started. */
export const HOSTED_REASONS = ["timeout", "empty", "truncated", "aborted", "rateLimit", "network", "server"] as const;
export type HostedReason = (typeof HOSTED_REASONS)[number];

const isReason = (value: unknown): value is HostedReason => typeof value === "string" && (HOSTED_REASONS as readonly string[]).includes(value);

const dataOf = (error: ORPCError<string, unknown>): Record<string, unknown> =>
  typeof error.data === "object" && error.data !== null ? (error.data as Record<string, unknown>) : {};

/**
 * The failure families of `joyo.status` / `joyo.chat`: the paywall (FORBIDDEN, `data.paywall`), refusals (`data.reason` minor,
 * noConsent, cap, off), an older server that has no `joyo` procedures (NOT_FOUND), a stop (abort), and everything else as one of
 * the `joyoAi:errors` reasons (a dropped connection is `network`).
 */
export function classifyJoyoError(error: unknown, signal?: AbortSignal): JoyoFailure {
  if (signal?.aborted || (error instanceof Error && error.name === "AbortError")) return { kind: "aborted" };
  if (error instanceof ORPCError) {
    const data = dataOf(error);
    if (error.code === "NOT_FOUND") return { kind: "unavailable" };
    if (error.code === "FORBIDDEN" && data.paywall === true) return { kind: "paywall" };
    if (error.code === "FORBIDDEN" && data.reason === "minor") return { kind: "minor" };
    if (error.code === "FORBIDDEN" && data.reason === "noConsent") return { kind: "noConsent" };
    if (error.code === "TOO_MANY_REQUESTS" && data.reason === "cap") return { kind: "cap" };
    if (error.code === "SERVICE_UNAVAILABLE" && data.reason === "off") return { kind: "off" };
    if (isReason(data.reason)) return { kind: "error", reason: data.reason };
    return { kind: "error", reason: "server" };
  }
  return { kind: "error", reason: "network" };
}

/** The `joyoAi` key that words a failure. `paywall`, `noConsent` and `unavailable` have their own screens and no line here. */
export function failureKey(failure: JoyoFailure): string | null {
  switch (failure.kind) {
    case "minor":
      return "blocked.minor";
    case "cap":
      return "blocked.cap";
    case "off":
      return "blocked.off";
    case "error":
      return `errors.${failure.reason}`;
    default:
      return null;
  }
}
