import { useEffect } from "react";
import { AppState } from "react-native";

import { authClient } from "@/lib/auth-client";
import { forgetPrefsSync, startPrefsSync, syncPrefs } from "@/src/lib/prefs-sync";

/**
 * Keeps this phone's preferences in step with the account: syncs when a session appears and whenever the app comes
 * back to the foreground. Edits sync themselves a couple of seconds after they are made (src/lib/prefs-sync.ts).
 * Sign-in itself is covered earlier, by the login screen's restore. Renders nothing; mount once at the root.
 */
export function PrefsSync() {
  const { data: session } = authClient.useSession();
  const userId = session?.user.id ?? null;

  useEffect(() => {
    if (!userId) {
      forgetPrefsSync();
      return;
    }
    startPrefsSync(userId);
    void syncPrefs().catch(() => undefined);
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void syncPrefs().catch(() => undefined);
    });
    return () => sub.remove();
  }, [userId]);

  return null;
}
