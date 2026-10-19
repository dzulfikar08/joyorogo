import { CALIBRATION_SEEN_PREF_KEY } from "@joyorogo/api/lib/calibration";
import type { CalibrationNotice as CalibrationNoticeData } from "@joyorogo/api/lib/calibration";
import { Button } from "@joyorogo/ui/components/button";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Scale, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Card } from "@/components/kit/surface";
import { saveCalibrationPref } from "@/lib/calibration-prefs";
import { refreshAfterCalibrationPref } from "@/lib/calibration-refresh";
import { fmtInt } from "@/lib/format";

/**
 * "Targetmu disesuaikan": automatic calibration moved the base target. The server sends `notice` only while today's
 * target differs from the figure the person last acknowledged; closing saves the new figure as acknowledged (synced)
 * and hides the card at once.
 */
export function CalibrationNotice({
  notice,
  className,
}: {
  notice: CalibrationNoticeData | null | undefined;
  className?: string;
}) {
  const { t } = useTranslation("energy");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [closedKcal, setClosedKcal] = useState<number | null>(null);

  if (!notice || closedKcal === notice.toKcal) return null;

  const dismiss = () => {
    setClosedKcal(notice.toKcal);
    saveCalibrationPref(CALIBRATION_SEEN_PREF_KEY, notice.toKcal);
    void refreshAfterCalibrationPref(queryClient);
  };

  return (
    <Card className={className} aria-label={t("calNotice.title")}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <Scale className="mt-0.5 size-5 shrink-0 text-bakar" aria-hidden />
          <h2 className="text-base leading-snug font-bold">{t("calNotice.title")}</h2>
        </div>
        <Button variant="ghost" size="icon" aria-label={t("calNotice.dismiss")} onClick={dismiss}>
          <X className="size-4" aria-hidden />
        </Button>
      </div>
      <p className="mt-2 text-sm leading-relaxed font-semibold tabular-nums">
        {t("calNotice.body", { old: fmtInt(notice.fromKcal), new: fmtInt(notice.toKcal) })}
      </p>
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{t("calNotice.hint")}</p>
      <div className="mt-3">
        <Button
          size="sm"
          className="min-h-11"
          onClick={() => {
            void navigate({ to: "/profil/target", search: {}, hash: "calibration" });
          }}
        >
          {t("calNotice.action")}
        </Button>
      </div>
    </Card>
  );
}
