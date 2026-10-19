import { ACTIVITY_FACTOR } from "@joyorogo/api/lib/engine";
import type { ActivityLevel } from "@joyorogo/api/lib/engine";
import type { ActivityOption, CalibrationRecommendation, StepsRecommendation } from "@joyorogo/api/lib/activity-guide";
import { Button } from "@joyorogo/ui/components/button";
import { Footprints, Scale } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { Card, IconChip } from "@/components/kit/surface";
import { fmtFactor, fmtInt } from "@/lib/format";

function RecommendationCard({
  icon,
  title,
  level,
  current,
  applying,
  disabled,
  onApply,
  children,
}: {
  icon: ReactNode;
  title: string;
  level: ActivityLevel;
  current: ActivityLevel | null;
  applying: boolean;
  disabled: boolean;
  onApply: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation("energy");
  const levelName = t(`levels.${level}.name`);
  return (
    <div className="rounded-2xl bg-muted p-4">
      <div className="flex items-start gap-3">
        <IconChip tone="makan">{icon}</IconChip>
        <div className="min-w-0 flex-1">
          <h3 className="text-[0.9375rem] leading-snug font-bold">{title}</h3>
          <p className="mt-0.5 text-sm font-semibold text-makan-ink">{t("recommend.suggest", { level: levelName })}</p>
        </div>
      </div>
      <div className="mt-2 space-y-2 text-sm leading-relaxed text-muted-foreground">{children}</div>
      <div className="mt-3">
        {level === current ? (
          <p className="text-sm font-semibold">{t("recommend.same")}</p>
        ) : (
          <Button size="sm" className="min-h-11" disabled={disabled} onClick={onApply}>
            {applying ? t("recommend.applying") : t("recommend.apply")}
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * "Lebih akurat": the steps and the weight-trend recommendations for the level. Only recommendations: the person taps
 * "Pakai". `showEmpty` is the Profil screen's note for when neither exists (onboarding shows nothing instead).
 */
export function ActivityRecommendations({
  steps,
  calibration,
  options,
  current,
  applyingLevel,
  onApply,
  showEmpty,
  className,
}: {
  steps: StepsRecommendation | null;
  calibration: CalibrationRecommendation | null;
  /** the per-level factors this person's plan uses (maternal plans have their own) */
  options: readonly ActivityOption[];
  current: ActivityLevel | null;
  /** the level being saved right now, if any */
  applyingLevel: ActivityLevel | null;
  onApply: (level: ActivityLevel) => void;
  showEmpty: boolean;
  className?: string;
}) {
  const { t } = useTranslation("energy");
  if (!steps && !calibration && !showEmpty) return null;
  const busy = applyingLevel !== null;
  const factorOf = (level: ActivityLevel) =>
    options.find((option) => option.level === level)?.factor ?? ACTIVITY_FACTOR[level];

  return (
    <Card className={className} aria-label={t("recommend.title")}>
      <h2 className="text-base font-bold tracking-tight">{t("recommend.title")}</h2>
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{t("recommend.intro")}</p>
      <div className="mt-3 space-y-3">
        {steps && (
          <RecommendationCard
            icon={<Footprints />}
            title={t("recommend.steps.title")}
            level={steps.level}
            current={current}
            applying={applyingLevel === steps.level}
            disabled={busy}
            onApply={() => onApply(steps.level)}
          >
            <p>
              {t("recommend.steps.body", {
                steps: fmtInt(steps.avgSteps),
                days: steps.days,
                level: t(`levels.${steps.level}.name`),
              })}
            </p>
            <p className="text-xs">{t("recommend.steps.bounds")}</p>
          </RecommendationCard>
        )}
        {calibration && (
          <RecommendationCard
            icon={<Scale />}
            title={t("recommend.calibration.title")}
            level={calibration.level}
            current={current}
            applying={applyingLevel === calibration.level}
            disabled={busy}
            onApply={() => onApply(calibration.level)}
          >
            <p>
              {t("recommend.calibration.body", {
                days: calibration.windowDays,
                logged: calibration.loggedDays,
                measured: fmtInt(calibration.measuredKcal),
                formula: fmtInt(calibration.formulaKcal),
                level: t(`levels.${calibration.level}.name`),
                factor: fmtFactor(factorOf(calibration.level)),
              })}
            </p>
            <p className="flex flex-wrap gap-x-4 gap-y-1 font-semibold text-foreground tabular-nums">
              <span>{t("recommend.calibration.measured", { kcal: fmtInt(calibration.measuredKcal) })}</span>
              <span>{t("recommend.calibration.formula", { kcal: fmtInt(calibration.formulaKcal) })}</span>
            </p>
            <p className="text-xs">{t("recommend.calibration.note")}</p>
          </RecommendationCard>
        )}
        {!steps && !calibration && (
          <p className="text-sm leading-relaxed text-muted-foreground">{t("recommend.empty")}</p>
        )}
      </div>
    </Card>
  );
}
