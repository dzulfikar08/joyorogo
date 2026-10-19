import type { EnergyNotice as EnergyNoticeData } from "@joyorogo/api/lib/energy-notice";
import { Button } from "@joyorogo/ui/components/button";
import { Link, useNavigate } from "@tanstack/react-router";
import { Flame, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Card } from "@/components/kit/surface";
import { useSession } from "@/lib/auth-client";
import { dismissalStoreKey, saveDismissal } from "@/lib/dismissals";
import { fmtFactor, fmtInt } from "@/lib/format";

/**
 * One-time notice that the eat target now starts from TDEE (BMR x the activity factor) instead of the bare BMR. The
 * server sends `notice` only to accounts made before the change that have not closed it; the closing is kept per
 * account (rogo-prefs.ts) and hides it at once.
 */
export function EnergyNotice({ notice, className }: { notice: EnergyNoticeData | null; className?: string }) {
  const { t } = useTranslation("energy");
  const navigate = useNavigate();
  const session = useSession();
  const userId = session.data?.user.id ?? null;
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    if (!userId) return;
    try {
      setDismissed(localStorage.getItem(dismissalStoreKey("dismissed.energyModel", userId)) === "1");
    } catch {
      // Storage blocked (private mode): treat as seen rather than nagging every visit.
      setDismissed(true);
    }
  }, [userId]);

  if (!notice || dismissed) return null;

  const dismiss = () => {
    // Without storage the state below still hides it for this visit.
    if (userId) saveDismissal("dismissed.energyModel", userId);
    setDismissed(true);
  };

  return (
    <Card className={className} aria-label={t("notice.title")}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <Flame className="mt-0.5 size-5 shrink-0 text-bakar" aria-hidden />
          <h2 className="text-base leading-snug font-bold">{t("notice.title")}</h2>
        </div>
        <Button variant="ghost" size="icon" aria-label={t("notice.dismiss")} onClick={dismiss}>
          <X className="size-4" aria-hidden />
        </Button>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t("notice.body")}</p>
      <div className="mt-3 space-y-1 rounded-2xl bg-muted px-4 py-3 text-sm leading-relaxed font-semibold tabular-nums">
        <p>
          {notice.oldKcal === notice.newKcal
            ? t("notice.same", { new: fmtInt(notice.newKcal) })
            : t("notice.change", { old: fmtInt(notice.oldKcal), new: fmtInt(notice.newKcal) })}
        </p>
        <p>
          {t("notice.level", {
            level: t(`levels.${notice.level}.name`),
            factor: fmtFactor(notice.factor),
          })}
        </p>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{t("notice.hint")}</p>
      <div className="mt-3">
        <Button
          size="sm"
          className="min-h-11"
          onClick={() => {
            void navigate({ to: "/profil/target", search: {}, hash: "activity-level" });
          }}
        >
          {t("notice.action")}
        </Button>
      </div>
      <Link
        to="/panduan/kalori"
        className="mt-1 inline-flex min-h-11 items-center text-sm font-semibold text-primary underline underline-offset-4 hover:text-primary/80"
      >
        {t("readMore")}
      </Link>
    </Card>
  );
}
