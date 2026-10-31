import * as SecureStore from "expo-secure-store";
import { useEffect, useRef } from "react";

import { useNotificationGate } from "@/components/reminders/permission-sheet";
import { getNotificationPermission } from "@/src/lib/notifications";
import { type AskTrigger, onPushAsk, runPushAsk } from "@/src/lib/push-ask";
import { registerPush } from "@/src/lib/push";
import { authClient } from "@/lib/auth-client";

// Per phone, like the permission itself. Written when the sheet is about to show, so each trigger asks once.
const flagKey = (trigger: AskTrigger) => `joyorogo.pushask.${trigger}.v1`;

// The success screens (scan sheet, composer) are still closing when the call returns; a sheet shown on top of a
// modal that is dismissing gets lost on iOS.
const SETTLE_MS = 900;

/**
 * Answers `emitPushAsk` (fired by the oRPC link after a meal is logged or a social action succeeds) with the shared
 * pre-prompt. Mount once inside the providers; renders only the gate's sheet.
 */
export function PushAskHost() {
  const gate = useNotificationGate();
  const { data: session } = authClient.useSession();
  const signedIn = Boolean(session?.user.id);
  const busy = useRef(false);
  const ensure = useRef(gate.ensure);
  ensure.current = gate.ensure;

  useEffect(() => {
    if (!signedIn) return;
    return onPushAsk((trigger) => {
      if (busy.current) return;
      busy.current = true;
      void (async () => {
        try {
          const settled = Promise.withResolvers<void>();
          setTimeout(settled.resolve, SETTLE_MS);
          await settled.promise;
          await runPushAsk(trigger, {
            permission: getNotificationPermission,
            wasAsked: async (t) => (await SecureStore.getItemAsync(flagKey(t)).catch(() => null)) === "1",
            markAsked: (t) => SecureStore.setItemAsync(flagKey(t), "1").catch(() => undefined),
            prompt: (t) => ensure.current(t),
            onGranted: async () => {
              await registerPush({ force: true });
            },
          });
        } finally {
          busy.current = false;
        }
      })();
    });
  }, [signedIn]);

  return <>{gate.sheet}</>;
}
