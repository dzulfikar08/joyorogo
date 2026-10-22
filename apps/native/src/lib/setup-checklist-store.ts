import * as SecureStore from "expo-secure-store";
import { useCallback, useEffect, useState } from "react";

// Whether the person closed the setup checklist on Beranda. Local to the phone, one flag per account (a phone can hold
// several): it is a hint about a screen, not a preference worth syncing.
const keyFor = (userId: string) => `joyorogo.setupChecklist.${userId}`;

/** `dismissed` is null until the stored flag is read, so the card never flashes for someone who closed it. */
export function useSetupChecklistDismissed(userId: string | null): {
  dismissed: boolean | null;
  dismiss: () => void;
} {
  const [dismissed, setDismissed] = useState<boolean | null>(null);
  useEffect(() => {
    if (userId === null) return;
    let cancelled = false;
    SecureStore.getItemAsync(keyFor(userId))
      .then((value) => {
        if (!cancelled) setDismissed(value === "1");
      })
      .catch(() => {
        // Unreadable store: the card shows, which is the safe side for a first-run aid.
        if (!cancelled) setDismissed(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);
  const dismiss = useCallback(() => {
    setDismissed(true);
    if (userId === null) return;
    void SecureStore.setItemAsync(keyFor(userId), "1").catch(() => {
      // Best-effort: it only comes back after a restart.
    });
  }, [userId]);
  return { dismissed, dismiss };
}
