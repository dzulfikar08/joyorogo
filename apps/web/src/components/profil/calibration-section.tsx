import { CALIBRATION_PREF_KEY } from "@joyorogo/api/lib/calibration";
import type { CalibrationInfo } from "@joyorogo/api/lib/calibration";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Scale } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Card, IconChip, SectionTitle } from "@/components/kit/surface";
import { Switch } from "@/components/kit/switch";
import { refreshAfterCalibrationPref } from "@/lib/calibration-refresh";
import { saveCalibrationPref, storedCalibrationEnabled } from "@/lib/calibration-prefs";
import { fmtDateLong, fmtInt } from "@/lib/format";
import { orpc } from "@/utils/orpc";

const guideOptions = orpc.profile.activityGuide.queryOptions();

function Status({ info }: { info: CalibrationInfo }) {
  const { t } = useTranslation("energy");
  const note = "text-sm leading-relaxed text-muted-foreground";
  if (info.status === "collecting") {
    return (
      <div className="space-y-1">
        <p className="text-sm leading-relaxed font-semibold tabular-nums">
          {t("auto.status.collecting", {
            logged: info.loggedDays,
            loggedNeeded: info.loggedDaysNeeded,
            span: info.spanDays,
            spanNeeded: info.spanDaysNeeded,
          })}
        </p>
        <p className={note}>{t("auto.status.collectingHint")}</p>
      </div>
    );
  }
  if (info.status === "waiting") {
    return (
      <p className="text-sm leading-relaxed font-semibold">
        {t("auto.status.waiting", { date: fmtDateLong(info.nextDate) })}
      </p>
    );
  }
  if (info.status === "active") {
    return (
      <div className="space-y-1">
        <p className="text-sm leading-relaxed font-semibold tabular-nums">
          {t("auto.status.active", {
            formula: fmtInt(info.formulaKcal),
            measured: info.measuredKcal === null ? "-" : fmtInt(info.measuredKcal),
            used: info.usedKcal === null ? "-" : fmtInt(info.usedKcal),
          })}
        </p>
        {info.clamped && <p className={note}>{t("auto.status.clamped")}</p>}
        <p className={note}>
          {t("auto.status.held", { date: fmtDateLong(info.anchorDate), next: fmtDateLong(info.nextDate) })}
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <p className="text-sm leading-relaxed font-semibold tabular-nums">
        {t("auto.status.off", { formula: fmtInt(info.formulaKcal) })}
      </p>
      {info.measuredKcal !== null && (
        <p className={note}>
          {t("auto.status.offMeasured", { measured: fmtInt(info.measuredKcal), formula: fmtInt(info.formulaKcal) })}
        </p>
      )}
    </div>
  );
}

/**
 * Kalibrasi otomatis: the switch for measuring the eat target from the weight trend, what it does, and where it stands.
 * The server decides everything; this edits the synced switch and shows `activityGuide.autoCalibration`.
 */
export function CalibrationSection({ maternal }: { maternal: boolean }) {
  const { t } = useTranslation("energy");
  const queryClient = useQueryClient();
  const guide = useQuery(guideOptions);
  const [enabled, setEnabled] = useState(storedCalibrationEnabled);
  const isMaternal = maternal || guide.data?.maternal === true;
  const info = guide.data?.autoCalibration ?? null;

  const toggle = (next: boolean) => {
    setEnabled(next);
    saveCalibrationPref(CALIBRATION_PREF_KEY, next);
    void refreshAfterCalibrationPref(queryClient);
  };

  const note = "text-sm leading-relaxed text-muted-foreground";
  return (
    <section id="calibration" className="scroll-mt-4">
      <SectionTitle className="mt-7">{t("auto.title")}</SectionTitle>
      {isMaternal ? (
        <Card className={note}>
          <p>{t("auto.maternal")}</p>
        </Card>
      ) : (
        <Card className="space-y-4">
          <div className="flex items-center gap-3">
            <IconChip tone="makan">
              <Scale />
            </IconChip>
            <p className="min-w-0 flex-1 text-[0.9375rem] leading-snug font-semibold">{t("auto.toggle")}</p>
            <Switch label={t("auto.toggle")} checked={enabled} onCheckedChange={toggle} />
          </div>
          {info && (
            <div className="rounded-2xl bg-muted px-4 py-3">
              <Status info={info} />
            </div>
          )}
          <div className={`space-y-2 ${note}`}>
            <p>{t("auto.how")}</p>
            <p>{t("auto.guard")}</p>
            <p>{t("auto.weekly")}</p>
            <p>{t("auto.off")}</p>
            <p>{t("auto.levelNote")}</p>
          </div>
        </Card>
      )}
    </section>
  );
}
