// Atur's feedback widget (app.diatur.com/widget.js, board of the JoyoFit "FIT" project, workspace `joyofit`): ideas, bug
// reports and help requests from the account menu, filed under the signed-in JoyoFit account without an Atur sign-in.
// The JoyoFit API signs the account's id and email with the board's identify secret (`GET /v1/feedback/identity`,
// reached through this API's `/api/fit/*` proxy); Atur then trusts the email, so a bug report becomes a support ticket
// for that person. The widget follows `<html lang>` (lib/i18n.ts sets it): Indonesian or English.

import { fitApi } from "./fit-api";

/** Public board token (it is in every page that embeds the widget). */
export const FEEDBACK_BOARD_TOKEN = "pk_fb_3d56898896b544949f03abc0f28256cb";
export const FEEDBACK_WIDGET_URL = "https://app.diatur.com/widget.js";

export type FeedbackMode = "idea" | "bug" | "help";

interface Identity {
  id: string;
  email: string;
  name: string | null;
  signature: string;
}

interface AturApi {
  identify: (
    user: { id: string; email?: string; name?: string; signature?: string } | null,
  ) => void;
  open: (mode?: FeedbackMode) => void;
  close: () => void;
  q?: unknown[][];
}

declare global {
  interface Window {
    Atur?: AturApi | { q: unknown[][] };
  }
}

let loading: Promise<void> | null = null;
let identifiedFor: string | null = null;

/** Adds the widget script once (no round button: the account menu opens it). Resolves when it has run. */
export function loadFeedbackWidget(): Promise<void> {
  if (loading) return loading;
  loading = new Promise<void>((resolve, reject) => {
    window.Atur = window.Atur ?? { q: [] };
    const script = document.createElement("script");
    script.src = FEEDBACK_WIDGET_URL;
    script.async = true;
    script.dataset.aturToken = FEEDBACK_BOARD_TOKEN;
    script.dataset.aturLauncher = "off";
    script.dataset.appVersion = "web";
    script.onload = () => resolve();
    script.onerror = () => {
      loading = null;
      script.remove();
      reject(new Error("feedback widget did not load"));
    };
    document.head.appendChild(script);
  });
  return loading;
}

function atur(): AturApi | null {
  const api = window.Atur;
  return api && "open" in api ? api : null;
}

/**
 * Tells the widget who is writing, once per account. Without the signature (API down, secret not set) the widget asks
 * for an email instead, and Atur keeps the report as unverified: still delivered, never lost.
 */
export async function identifyForFeedback(userId: string): Promise<void> {
  const api = atur();
  if (!api || identifiedFor === userId) return;
  try {
    const me = await fitApi<Identity>("/feedback/identity");
    api.identify({
      id: me.id,
      email: me.email,
      name: me.name ?? undefined,
      signature: me.signature,
    });
    identifiedFor = userId;
  } catch {
    api.identify(null);
  }
}

/** Forgets the account on sign-out, so the next person on this browser is not filed under it. */
export function forgetFeedbackIdentity(): void {
  identifiedFor = null;
  atur()?.identify(null);
}

/** Opens the panel on a mode. Call it from a click handler; the widget loads on first use if it is not there yet. */
export async function openFeedback(userId: string, mode: FeedbackMode = "bug"): Promise<boolean> {
  try {
    await loadFeedbackWidget();
  } catch {
    return false;
  }
  await identifyForFeedback(userId);
  const api = atur();
  if (!api) return false;
  api.open(mode);
  return true;
}

/** Where people go when the widget cannot load (blocked by an extension, offline): the portal on the product site. */
export const FEEDBACK_PORTAL_URL = "https://fit.joyorogo.com/issues";
