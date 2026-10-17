import { Button } from "@joyorogo/ui/components/button";
import { useQuery } from "@tanstack/react-query";
import { Clock, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Card } from "@/components/kit/surface";
import { useSession } from "@/lib/auth-client";
import { orpc } from "@/utils/orpc";

const dismissKey = (userId: string) => `jrg-strava-7d-${userId}`;

/**
 * Pemberitahuan sekali tampil untuk pengguna yang sudah menyambungkan Strava: impor
 * Strava sekarang dihapus setelah 7 hari (aturan API Strava, docs/strava.md).
 * Penutupan disimpan di perangkat ini per akun, jadi tidak muncul lagi.
 */
export function StravaRetentionNotice({ className }: { className?: string }) {
  const { t } = useTranslation(["settings", "common"]);
  const session = useSession();
  const userId = session.data?.user.id ?? null;
  const status = useQuery(orpc.strava.status.queryOptions());
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    if (!userId) return;
    try {
      setDismissed(localStorage.getItem(dismissKey(userId)) === "1");
    } catch {
      // Storage blocked (private mode): treat as seen rather than nagging every visit.
      setDismissed(true);
    }
  }, [userId]);

  if (!status.data?.connected || dismissed) return null;

  const dismiss = () => {
    try {
      if (userId) localStorage.setItem(dismissKey(userId), "1");
    } catch {
      // Nothing to persist to; the state below still hides it for this visit.
    }
    setDismissed(true);
  };

  return (
    <Card className={className} aria-label={t("strava.retention.noticeTitle")}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Clock className="size-5 text-bakar" aria-hidden />
          <h2 className="text-base font-bold">{t("strava.retention.noticeTitle")}</h2>
        </div>
        <Button variant="ghost" size="icon" aria-label={t("common:actions.close")} onClick={dismiss}>
          <X className="size-4" aria-hidden />
        </Button>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        {t("strava.retention.text")}
      </p>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        {t("strava.retention.healthAlternative")}
      </p>
      <div className="mt-3">
        <Button size="sm" className="min-h-11" onClick={dismiss}>
          {t("strava.retention.understood")}
        </Button>
      </div>
    </Card>
  );
}
