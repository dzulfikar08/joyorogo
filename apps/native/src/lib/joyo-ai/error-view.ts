// Ported from JoyoFit (watch-fit) src/features/ai/ui/errors.ts, adapted for JoyoRogo.
import { PROVIDERS } from "@joyorogo/api/lib/joyo-ai/providers";
import { AiError, type AiErrorKind, type ProviderId } from "@joyorogo/api/lib/joyo-ai/types";

/** Where the next step of an error leads. */
export type ErrorTarget = "setup" | "model" | "settings" | "keyPage";

/** An i18n key with its variables; the screen translates it (`joyoAi:` or `joyoAiApp:` as the key says). */
export interface MessageRef {
  key: string;
  vars?: Record<string, string | number>;
}

export interface AiErrorView {
  kind: AiErrorKind | "unknown";
  /** The cause and what to do next, in one short text. */
  message: MessageRef;
  action: { label: string; target: ErrorTarget } | null;
  /** The provider's own words, for a collapsed "message from the provider" line. Never contains the key. */
  detail: string | null;
  /** The HTTP status the provider answered with, when it did. */
  status: number | null;
  /** Whose words `detail` is: the provider's, or the engine's own technical line (finish reason, lengths). */
  detailFrom: "provider" | "engine";
}

const BLOCK_REASONS = ["ceiling", "noKey", "noConsent", "noProvider", "minor", "badUrl"] as const;
type BlockReason = (typeof BLOCK_REASONS)[number];
const isBlockReason = (v: string | null): v is BlockReason =>
  v !== null && (BLOCK_REASONS as readonly string[]).includes(v);

const DETAIL_CHARS = 300;
const act = (label: string, target: ErrorTarget) => ({ label, target });

/** Labels of the actions, keys in `joyoAiApp`. */
export const ACTION_LABELS = {
  setup: "err.action.setup",
  model: "err.action.model",
  settings: "err.action.settings",
  keyPage: "err.action.keyPage",
} as const;

function describe(
  error: unknown,
  ctx: { provider: ProviderId | null; ceiling: number },
): Omit<AiErrorView, "status" | "detailFrom"> {
  if (!(error instanceof AiError))
    return {
      kind: "unknown",
      message: { key: "joyoAiApp:err.unknown" },
      action: null,
      detail: null,
    };
  const detail =
    error.kind === "blocked" || !error.detail ? null : error.detail.slice(0, DETAIL_CHARS);
  const to = (target: ErrorTarget) => act(ACTION_LABELS[target], target);
  switch (error.kind) {
    case "badKey":
    case "forbidden":
      return {
        kind: error.kind,
        message: { key: `joyoAi:errors.${error.kind}` },
        action: to("setup"),
        detail,
      };
    case "quota": {
      const keyPage = ctx.provider ? PROVIDERS[ctx.provider].keyUrl : null;
      return {
        kind: "quota",
        message: { key: "joyoAi:errors.quota" },
        action: keyPage ? to("keyPage") : null,
        detail,
      };
    }
    case "modelNotFound":
    case "noTools":
    case "truncated":
      return {
        kind: error.kind,
        message: { key: `joyoAi:errors.${error.kind}` },
        action: to("model"),
        detail,
      };
    case "badRequest":
      if (error.detail === "url")
        return {
          kind: "badRequest",
          message: { key: "joyoAi:blocked.badUrl" },
          action: to("setup"),
          detail: null,
        };
      return {
        kind: "badRequest",
        message: { key: "joyoAi:errors.badRequest" },
        action: to("model"),
        detail,
      };
    case "blocked": {
      const reason = isBlockReason(error.detail) ? error.detail : null;
      if (reason === "ceiling")
        return {
          kind: "blocked",
          message: { key: "joyoAi:blocked.ceiling" },
          action: to("settings"),
          detail: null,
        };
      if (reason === "minor")
        return {
          kind: "blocked",
          message: { key: "joyoAi:blocked.minor" },
          action: null,
          detail: null,
        };
      if (reason)
        return {
          kind: "blocked",
          message: { key: `joyoAi:blocked.${reason}` },
          action: to("setup"),
          detail: null,
        };
      return {
        kind: "blocked",
        message: { key: "joyoAiApp:err.blockedOther" },
        action: to("settings"),
        detail: null,
      };
    }
    case "rateLimit":
    case "server":
    case "network":
    case "timeout":
    case "empty":
    case "aborted":
      return {
        kind: error.kind,
        message: { key: `joyoAi:errors.${error.kind}` },
        action: null,
        detail,
      };
  }
}

/**
 * Words an error of the own-key engine for the person: what happened (the cause) and the one next step, plus what a bug report
 * needs (kind, HTTP status, the detail line) for the collapsed "technical details". `provider` is the provider in use (for the link
 * to its key page).
 */
export function viewAiError(
  error: unknown,
  ctx: { provider: ProviderId | null; ceiling: number },
): AiErrorView {
  const view = describe(error, ctx);
  if (!(error instanceof AiError) || error.kind === "blocked")
    return { ...view, status: null, detailFrom: "provider" };
  return {
    ...view,
    status: error.status,
    detailFrom: error.kind === "empty" || error.kind === "truncated" ? "engine" : "provider",
  };
}

// ---- the hosted engine ----

/**
 * Why a hosted question did not get an answer, from the error `client.joyo.chat` threw. The paywall FORBIDDEN (`data.paywall`) is
 * decided by the caller with `isPaywallError` before this runs.
 */
export type HostedFailure =
  | "minor"
  | "noConsent"
  | "cap"
  | "unavailable"
  | "off"
  | "network"
  | "timeout"
  | "empty"
  | "truncated"
  | "rateLimit"
  | "server"
  | "aborted"
  | "other";

/** What the server names (`data.reason`) when a failure ends the stream after it started: a `joyoAi:errors.*` kind. */
const STREAM_REASONS = ["timeout", "empty", "truncated", "rateLimit", "network", "server"] as const;

const rec = (v: unknown): Record<string, unknown> =>
  typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};

export function hostedFailure(error: unknown): HostedFailure {
  const e = rec(error);
  const name = typeof e.name === "string" ? e.name : "";
  if (name === "AbortError" || (error instanceof AiError && error.kind === "aborted"))
    return "aborted";
  const code = typeof e.code === "string" ? e.code : "";
  const data = rec(e.data);
  if (code === "NOT_FOUND" || e.status === 404) return "unavailable";
  const streamed = STREAM_REASONS.find((reason) => reason === data.reason);
  if (streamed && code !== "FORBIDDEN" && code !== "TOO_MANY_REQUESTS") return streamed;
  if (code === "FORBIDDEN")
    return data.reason === "minor" ? "minor" : data.reason === "noConsent" ? "noConsent" : "other";
  if (code === "TOO_MANY_REQUESTS") return data.reason === "cap" ? "cap" : "other";
  if (code === "SERVICE_UNAVAILABLE") return "off";
  if (code === "TIMEOUT" || name === "TimeoutError") return "timeout";
  // fetch rejects with a TypeError when the phone has no connection ("Network request failed" in React Native).
  if (
    error instanceof TypeError ||
    /network|fetch failed|failed to fetch/i.test(typeof e.message === "string" ? e.message : "")
  )
    return "network";
  return "other";
}

/** The message of a hosted failure: Core's `joyoAi:blocked.*` / `errors.*` lines, plus the app's own for an older server. */
export const HOSTED_MESSAGE: Record<Exclude<HostedFailure, "aborted">, string> = {
  minor: "joyoAi:blocked.minor",
  noConsent: "joyoAi:blocked.noConsent",
  cap: "joyoAi:blocked.cap",
  off: "joyoAi:blocked.off",
  unavailable: "joyoAiApp:hosted.unavailableBody",
  network: "joyoAi:errors.network",
  timeout: "joyoAi:errors.timeout",
  empty: "joyoAi:errors.empty",
  truncated: "joyoAi:errors.truncated",
  rateLimit: "joyoAi:errors.rateLimit",
  server: "joyoAi:errors.server",
  other: "joyoAi:errors.server",
};
