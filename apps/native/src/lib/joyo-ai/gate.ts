import type { ByokBlock } from "@joyorogo/api/lib/joyo-ai/settings";

import type { EngineChoice, HostedState } from "./open";

/** What the chat screen shows instead of the conversation while it cannot answer; nothing is sent in any state but `ready`. */
export type ChatGate =
  | { kind: "checking" }
  | { kind: "ready"; engine: EngineChoice }
  /** Under 18 by the profile: Joyo AI is off on both engines. */
  | { kind: "minor" }
  /** Hosted engine, Pro, but the one-time consent for what the server reads is missing (or the text changed). */
  | { kind: "hostedConsent" }
  /** Hosted engine chosen and the account is not Pro. */
  | { kind: "paywall" }
  /** An older server, the feature switched off, or no connection while the hosted engine is chosen. */
  | { kind: "unavailable" }
  /** Own key chosen and not usable; `reason` says which gate. */
  | { kind: "ownBlocked"; reason: Exclude<ByokBlock, "minor"> };

export interface GateInput {
  engine: EngineChoice;
  /** The settings have been read from the file. */
  loaded: boolean;
  /** `byokAccess`; null until the age is known. */
  own: { ok: true } | { ok: false; reason: ByokBlock } | null;
  hosted: HostedState;
  /** `hostedConsentOk(settings)`. */
  hostedConsent: boolean;
}

/** The state of the chat screen from the engine chosen, the own-key gate and the hosted status. */
export function chatGate(input: GateInput): ChatGate {
  const { engine, loaded, own, hosted, hostedConsent } = input;
  if (!loaded) return { kind: "checking" };
  if (engine === "byok") {
    if (own === null) return { kind: "checking" };
    if (own.ok) return { kind: "ready", engine: "byok" };
    if (own.reason === "minor") return { kind: "minor" };
    return { kind: "ownBlocked", reason: own.reason };
  }
  if (hosted === "checking" || own === null) return { kind: "checking" };
  if (hosted === "minor" || (!own.ok && own.reason === "minor")) return { kind: "minor" };
  if (hosted === "locked") return { kind: "paywall" };
  if (hosted === "unavailable") return { kind: "unavailable" };
  return hostedConsent ? { kind: "ready", engine: "hosted" } : { kind: "hostedConsent" };
}
