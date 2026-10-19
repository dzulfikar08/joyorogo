import { CALIBRATION_PREF_KEY } from "@joyorogo/api/lib/calibration";
import type { CalibrationInfo } from "@joyorogo/api/lib/calibration";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Scale } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Card, IconChip, SectionTitle } from "@/components/kit/surface";
import { Switch } from "@/components/kit/switch";
import { refreshAfterCalibrationPref } from "@/lib/calibration-refresh";
import { saveCalibrationPref, storedCalibrationEnabled } from "@/lib/calibration-prefs";
import { fmtDateLong, fmtInt } from "@/lib/format";
import { orpc } from "@/utils/orpc";

const guideOptions = orpc.profile.activityGuide.queryOptions();

const note = "text-sm leading-relaxed text-muted-foreground";

/** One thing the calibration still waits for: its label, how far it is, and a bar for it. */
function Progress({ label, text, value, needed }: { label: string; text: string; value: number; needed: number }) {
  const share = Math.min(1, value / needed);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="min-w-0">{label}</span>
        <span className="shrink-0 font-semibold tabular-nums">{text}</span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={needed}
        aria-valuenow={Math.min(value, needed)}
        aria-valuetext={text}
        className="mt-1 h-2 overflow-hidden rounded-full bg-foreground/10"
      >
        <div className="h-full rounded-full bg-primary" style={{ width: `${Math.round(share * 100)}%` }} />
      </div>
    </div>
  );
}

/** Where the calibration stands, in plain words with the numbers that matter. */
function Status({ info }: { info: CalibrationInfo }) {
  const { t } = useTranslation("energy");
  const title = (key: "collectingTitle" | "waitingTitle" | "activeTitle" | "offTitle") => (
    <p className="text-[0.9375rem] leading-snug font-bold">{t(`auto.status.${key}`)}</p>
  );
  let body: React.ReactNode;
  if (info.status === "collecting") {
    body = (
      <>
        {title("collectingTitle")}
        <div className="mt-3 space-y-3">
          <Progress
            label={t("auto.progress.days")}
            text={t("auto.progress.value", { value: info.loggedDays, needed: info.loggedDaysNeeded })}
            value={info.loggedDays}
            needed={info.loggedDaysNeeded}
          />
          <Progress
            label={t("auto.progress.weighIns")}
            text={t("auto.progress.value", { value: info.weighIns, needed: info.weighInsNeeded })}
            value={info.weighIns}
            needed={info.weighInsNeeded}
          />
          <Progress
            label={t("auto.progress.span")}
            text={t("auto.progress.valueDays", { value: info.spanDays, needed: info.spanDaysNeeded })}
            value={info.spanDays}
            needed={info.spanDaysNeeded}
          />
        </div>
        <p className={`mt-3 ${note}`}>{t("auto.status.collectingHint")}</p>
      </>
    );
  } else if (info.status === "waiting") {
    body = (
      <>
        {title("waitingTitle")}
        <p className={`mt-1 ${note}`}>{t("auto.status.waitingBody", { date: fmtDateLong(info.nextDate) })}</p>
      </>
    );
  } else if (info.status === "active") {
    const measured = info.measuredKcal === null ? "-" : fmtInt(info.measuredKcal);
    body = (
      <>
        {title("activeTitle")}
        <p className="mt-1 text-sm leading-relaxed font-semibold tabular-nums">
          {t("auto.status.activeBody", { formula: fmtInt(info.formulaKcal), used: fmtInt(info.usedKcal ?? info.formulaKcal) })}
        </p>
        <p className={`mt-1 tabular-nums ${note}`}>
          {t(info.clamped ? "auto.status.clamped" : "auto.status.activeMeasured", { measured })}
        </p>
        <p className={`mt-1 ${note}`}>
          {t("auto.status.held", { date: fmtDateLong(info.anchorDate), next: fmtDateLong(info.nextDate) })}
        </p>
      </>
    );
  } else {
    body = (
      <>
        {title("offTitle")}
        <p className={`mt-1 tabular-nums ${note}`}>{t("auto.status.offBody", { formula: fmtInt(info.formulaKcal) })}</p>
        {info.measuredKcal !== null && (
          <p className={`mt-1 tabular-nums ${note}`}>
            {t("auto.status.offMeasured", { measured: fmtInt(info.measuredKcal), formula: fmtInt(info.formulaKcal) })}
          </p>
        )}
      </>
    );
  }
  return <div className="rounded-2xl bg-muted px-4 py-3">{body}</div>;
}

/**
 * Kalibrasi otomatis: the switch for measuring the eat target from the weight trend, where it stands, and one line on how
 * it works with a link to the guide. The server decides everything; this edits the synced switch and shows
 * `activityGuide.autoCalibration`.
 */
export function CalibrationSection({ maternal }: { maternal: boolean }) {
  const { t } = useTranslation("energy");
  const queryClient = useQueryClient();
  const guide = useQuery(guideOptions);
  const [enabled, setEnabled] = useState(storedCalibrationEnabled);
  const isMaternal = maternal || guide.data?.maternal === true;
  const info = guide.data?.autoCalibration ?? null;
  const pending = info?.status === "collecting" || info?.status === "waiting";
  // The server's verdict (the plan it computed) wins over this device's copy, so the switch never disagrees with it.
  const serverEnabled = info?.enabled;
  useEffect(() => {
    if (serverEnabled !== undefined) setEnabled(serverEnabled);
  }, [serverEnabled]);

  const toggle = (next: boolean) => {
    setEnabled(next);
    saveCalibrationPref(CALIBRATION_PREF_KEY, next);
    void refreshAfterCalibrationPref(queryClient);
  };

  return (
    <section id="calibration" className="scroll-mt-4">
      <SectionTitle className="mt-7">{t("auto.title")}</SectionTitle>
      {isMaternal ? (
        <Card className={note}>
          <p>{t("auto.maternal")}</p>
        </Card>
      ) : (
        <Card className="space-y-4">
          <div>
            <div className="flex items-center gap-3">
              <IconChip tone="makan">
                <Scale />
              </IconChip>
              <p className="min-w-0 flex-1 text-[0.9375rem] leading-snug font-semibold">{t("auto.toggle")}</p>
              <Switch label={t("auto.toggle")} checked={enabled} onCheckedChange={toggle} />
            </div>
            <p className={`mt-2 ${note}`}>
              {t(!enabled ? "auto.toggleOff" : pending ? "auto.toggleOnPending" : "auto.toggleOn")}
            </p>
          </div>
          {info && <Status info={info} />}
          <div>
            <p className={note}>{t("auto.explain")}</p>
            <Link
              to="/panduan/kalori"
              hash="calibration"
              className="mt-1 inline-flex min-h-11 items-center text-sm font-semibold text-primary underline underline-offset-4 hover:text-primary/80"
            >
              {t("auto.learn")}
            </Link>
          </div>
        </Card>
      )}
    </section>
  );
}
