import { useEffect } from "react";
import { AppState } from "react-native";
import { useTranslation } from "react-i18next";

import { authClient } from "@/lib/auth-client";
import { registerPush } from "@/src/lib/push";

/**
 * Registers this phone for remote push after sign-in, on every foreground and after a language switch (the server
 * stores the locale). Does nothing without permission; renders nothing. Mount once inside the providers.
 */
export function PushSync() {
  const { i18n } = useTranslation();
  const language = i18n.language;
  const { data: session } = authClient.useSession();
  const userId = session?.user.id;

  useEffect(() => {
    if (!userId) return;
    void registerPush();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void registerPush();
    });
    return () => sub.remove();
  }, [userId, language]);

  return null;
}
