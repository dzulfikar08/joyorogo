// When the app asks for notification permission on its own. No native imports here, so the rules stay unit-testable;
// components/push/push-ask-host.tsx binds them to the permission gate and storage.

export type AskTrigger = "meal" | "social";
export type AskPermission = "granted" | "undetermined" | "blocked";

const CALL_TRIGGER: Record<string, AskTrigger> = {
  "food.add": "meal",
  "food.addScan": "meal",
  "savedFood.relog": "meal",
  "place.relog": "meal",
  "mealPlan.eat": "meal",
  "social.createPost": "social",
  "social.createWatchPost": "social",
  "social.addComment": "social",
  "group.join": "social",
  "group.nudge": "social",
};

/** Which pre-prompt a successful oRPC call may lead to, if any. `path` is the procedure path, e.g. ["food", "add"]. */
export function triggerForCall(path: readonly string[], input: unknown, output: unknown): AskTrigger | null {
  const name = path.join(".");
  const fixed = CALL_TRIGGER[name];
  if (fixed) return fixed;
  // Kudos toggles and follow flips both: only the "on" side counts.
  if (name === "social.kudos") return (output as { kudos?: boolean } | null)?.kudos === true ? "social" : null;
  if (name === "social.setFollow") return (input as { follow?: boolean } | null)?.follow === true ? "social" : null;
  return null;
}

type Listener = (trigger: AskTrigger) => void;
const listeners = new Set<Listener>();

/** Called by the oRPC link after a call succeeded; a no-op when nothing is mounted to answer. */
export function emitPushAsk(trigger: AskTrigger): void {
  for (const listener of listeners) listener(trigger);
}

export function onPushAsk(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export type AskDeps = {
  permission: () => Promise<AskPermission>;
  wasAsked: (trigger: AskTrigger) => Promise<boolean>;
  markAsked: (trigger: AskTrigger) => Promise<void>;
  /** Shows the pre-prompt (or the open-settings sheet when blocked); true when permission ended up granted. */
  prompt: (trigger: AskTrigger) => Promise<boolean>;
  onGranted: () => Promise<void>;
};

/**
 * Asks at most once per trigger, never when permission is already granted. The flag is written right before the
 * sheet shows, so closing the app mid-sheet or tapping "Not now" both count as the one ask.
 * Resolves true when the sheet was shown.
 */
export async function runPushAsk(trigger: AskTrigger, deps: AskDeps): Promise<boolean> {
  if ((await deps.permission()) === "granted") return false;
  if (await deps.wasAsked(trigger)) return false;
  await deps.markAsked(trigger);
  if (await deps.prompt(trigger)) await deps.onGranted();
  return true;
}
