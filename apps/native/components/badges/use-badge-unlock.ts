import { router } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import { useBadges } from "@/components/badges/use-badges";
import { useToast } from "@/components/toast";
import { authClient } from "@/lib/auth-client";
import { badgeKey, earnedKeys, newlyEarned } from "@/src/lib/badges";

// Per account: one phone can hold several.
const seenKey = (userId: string) => `joyorogo.badgesSeen.${userId}`;

async function readSeen(userId: string): Promise<string[] | null> {
  try {
    const raw = await SecureStore.getItemAsync(seenKey(userId));
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === "string") : null;
  } catch {
    return null;
  }
}

/**
 * Mount once in the authenticated layout. Compares the earned set (id:tier) with the last one this phone saw:
 * the first ever run stores a silent baseline, later new badges raise one toast with a "View" action.
 */
export function useBadgeUnlock() {
  const { t } = useTranslation("badges");
  const toast = useToast();
  const { data: session } = authClient.useSession();
  const userId = session?.user.id ?? null;
  const badges = useBadges();
  const data = badges.data;
  const running = useRef(false);

  useEffect(() => {
    if (!userId || !data?.enabled || running.current) return;
    running.current = true;
    void (async () => {
      try {
        const seen = await readSeen(userId);
        const fresh = newlyEarned(seen, data.badges);
        await SecureStore.setItemAsync(seenKey(userId), JSON.stringify(earnedKeys(data.badges)));
        if (fresh.length > 0) {
          toast.success(t("unlock.title"), fresh.map((b) => t(badgeKey(b.id, "name"))).join(", "), {
            label: t("unlock.view"),
            onPress: () => router.push("/profil/lencana"),
          });
        }
      } catch {
        // Best-effort: a failed store only means the toast may come again.
      } finally {
        running.current = false;
      }
    })();
  }, [userId, data, toast, t]);
}
