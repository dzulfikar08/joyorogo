// Ported from JoyoFit (watch-fit) src/features/ai/open.ts, adapted for JoyoRogo.
import type { ByokBlock } from "@joyorogo/api/lib/joyo-ai/settings";

/** The engine the person chose in Joyo AI settings: JoyoRogo's hosted engine (Pro) or their own key. */
export type EngineChoice = "hosted" | "byok";

/**
 * The hosted engine right now, from `client.joyo.status()`:
 * - `checking`: the answer has not arrived yet
 * - `ready`: unlocked (Pro, or the paywall is off) and the age is not known to be under 18
 * - `locked`: the account is not Pro
 * - `minor`: the profile says under 18
 * - `unavailable`: an older server (NOT_FOUND), the feature switched off, or no connection
 */
export type HostedState = "checking" | "ready" | "locked" | "minor" | "unavailable";

/** The own-key gate (`byokAccess`), reduced to what the route needs; null while the age is still being read. */
export type OwnState = { ok: true } | { ok: false; reason: ByokBlock } | null;

export interface OpenState {
  engine: EngineChoice;
  own: OwnState;
  hosted: HostedState;
}

/** The question a shortcut types (unsent) into a new chat. */
export interface AskSeed {
  text: string;
}

export type JoyoDestination =
  | { pathname: "/joyo"; params?: { ask: string } }
  | { pathname: "/joyo-setup" }
  | { pathname: "/joyo-ai-settings" };

/**
 * Where a shortcut leads. The chat when there is an engine to answer (the own key is ready and chosen, or the hosted engine is
 * ready); the setup screen when nothing is set up; the Joyo AI settings when an own key is ready but the hosted engine is the one
 * chosen and the account cannot use it, so the person can switch engine instead of meeting a paywall. A person under 18 gets the
 * chat, which says why there is nothing to answer. While the age or the account is still being read the chat opens and shows its
 * own checking state.
 */
export function joyoDestination(state: OpenState, ask?: AskSeed | null): JoyoDestination {
  const { engine, own, hosted } = state;
  const chat: JoyoDestination = ask?.text
    ? { pathname: "/joyo", params: { ask: ask.text } }
    : { pathname: "/joyo" };
  if (own === null || hosted === "checking") return chat;
  if (hosted === "minor" || (!own.ok && own.reason === "minor")) return chat;
  const ownReady = own.ok;
  const hostedReady = hosted === "ready";
  if (engine === "byok") return ownReady || hostedReady ? chat : { pathname: "/joyo-setup" };
  if (hostedReady) return chat;
  return ownReady ? { pathname: "/joyo-ai-settings" } : { pathname: "/joyo-setup" };
}
