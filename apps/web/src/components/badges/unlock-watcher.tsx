import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { badgeKey } from "@/components/badges/badge-medal";
import { useMyBadges } from "@/components/badges/badge-shelf";
import { useSession } from "@/lib/auth-client";

const key = (userId: string) => `jrg-badges-seen:${userId}`;

/** Badge ids with their tier ("id:tier") that count as earned. */
export function earnedKeys(badges: ReadonlyArray<{ id: string; tier: number }>): string[] {
  return badges.filter((b) => b.tier > 0).map((b) => `${b.id}:${b.tier}`);
}

/**
 * Mounted once in the signed-in layout. Compares earned badges with the set last seen on this device and
 * toasts each new one. The first run only records a baseline, so nobody gets a burst for old awards.
 */
export function BadgeUnlockWatcher() {
  const { t } = useTranslation("badges");
  const navigate = useNavigate();
  const userId = useSession().data?.user.id ?? null;
  const mine = useMyBadges();

  useEffect(() => {
    if (!userId || !mine.data?.enabled) return;
    const now = earnedKeys(mine.data.badges);
    const raw = localStorage.getItem(key(userId));
    if (raw !== null) {
      const seen = new Set<string>(JSON.parse(raw) as string[]);
      for (const badge of mine.data.badges) {
        if (badge.tier > 0 && !seen.has(`${badge.id}:${badge.tier}`)) {
          toast.success(t("unlock.title"), {
            description: t(badgeKey(badge.id, "name")),
            action: { label: t("unlock.view"), onClick: () => void navigate({ to: "/profil" }) },
          });
        }
      }
    }
    localStorage.setItem(key(userId), JSON.stringify(now));
  }, [userId, mine.data, navigate, t]);

  return null;
}
