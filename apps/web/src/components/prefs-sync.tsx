import { useEffect } from "react";

import { useSession } from "@/lib/auth-client";
import { forgetPrefsSync, startPrefsSync, syncPrefs } from "@/lib/prefs-sync";

/**
 * Keeps this browser's preferences in step with the account: syncs when a session appears and whenever the tab
 * becomes visible again. Edits sync themselves a couple of seconds after they are made (lib/prefs-sync.ts).
 * Renders nothing; mount once inside the signed-in shell.
 */
export function PrefsSync() {
  const session = useSession();
  const userId = session.data?.user.id ?? null;

  useEffect(() => {
    if (!userId) {
      forgetPrefsSync();
      return;
    }
    startPrefsSync(userId);
    void syncPrefs().catch(() => undefined);
    const onVisible = () => {
      if (document.visibilityState === "visible") void syncPrefs().catch(() => undefined);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [userId]);

  return null;
}
