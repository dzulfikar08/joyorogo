import { CALIBRATION_SEEN_PREF_KEY } from "@joyorogo/api/lib/calibration";
import type { CalibrationNotice as CalibrationNoticeData } from "@joyorogo/api/lib/calibration";
import { Button } from "@joyorogo/ui/components/button";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Scale, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { CollapsibleNotice } from "@/components/collapsible-notice";
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
    <CollapsibleNotice
      id="calibration"
      className={className}
      title={t("calNotice.title")}
      icon={<Scale />}
      action={
        <Button variant="ghost" size="icon" aria-label={t("calNotice.dismiss")} onClick={dismiss}>
          <X className="size-4" aria-hidden />
        </Button>
      }
    >
      <p className="text-sm leading-relaxed font-semibold tabular-nums">
        {t("calNotice.body", { old: fmtInt(notice.fromKcal), new: fmtInt(notice.toKcal) })}
      </p>
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{t("calNotice.hint")}</p>
      <div className="mt-3 flex flex-wrap items-center gap-x-4">
        <Button
          size="sm"
          className="min-h-11"
          onClick={() => {
            void navigate({ to: "/profil/target", search: {}, hash: "calibration" });
          }}
        >
          {t("calNotice.action")}
        </Button>
        <Link
          to="/panduan/kalori"
          hash="calibration"
          className="inline-flex min-h-11 items-center text-sm font-semibold text-primary underline underline-offset-4 hover:text-primary/80"
        >
          {t("calNotice.learn")}
        </Link>
      </div>
    </CollapsibleNotice>
  );
}
