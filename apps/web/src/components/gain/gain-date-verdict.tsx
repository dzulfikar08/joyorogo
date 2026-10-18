import { Button } from "@joyorogo/ui/components/button";
import { CircleAlert, CircleCheck, Info } from "lucide-react";
import { useTranslation } from "react-i18next";

import { MAX_TARGET_DAYS, shiftDate } from "@joyorogo/api/lib/engine";
import type { TargetDateCheck } from "@joyorogo/api/lib/engine";
import { MAX_SURPLUS_KCAL } from "@joyorogo/api/lib/gain";

import { fmtDateLong, fmtInt, fmtKg } from "@/lib/format";

type GainCheck = Extract<TargetDateCheck, { status: "gainOk" | "gainFast" | "gainSlow" }>;

export function isGainCheck(check: TargetDateCheck): check is GainCheck {
  return check.status === "gainOk" || check.status === "gainFast" || check.status === "gainSlow";
}

/** The reverse (Naikin BB) verdicts of a target date. Warnings are neutral info cards, never red. */
export function GainDateVerdict({
  check,
  today,
  onUseDate,
}: {
  check: GainCheck;
  today: string;
  /** days from today of the date the card offers */
  onUseDate: (offsetDays: number) => void;
}) {
  const { t } = useTranslation("gain");
  const suggested = fmtDateLong(shiftDate(today, Math.min(check.feasibleDays, MAX_TARGET_DAYS))).replace(
    /^\w+, /,
    "",
  );
  const pace = { perWeek: fmtKg(check.weeklyKg), pct: fmtKg(check.pacePct) };

  if (check.status === "gainOk") {
    return (
      <p className="flex items-start gap-1.5 text-sm leading-relaxed text-makan-ink">
        <CircleCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
        {check.band === "lean"
          ? t("date.ok.lean", { kg: fmtKg(check.gainKg), count: check.days, ...pace })
          : t("date.ok.brisk", { kg: fmtKg(check.gainKg), count: check.days, ...pace })}
      </p>
    );
  }

  if (check.status === "gainFast") {
    return (
      <div className="rounded-2xl bg-bakar-soft p-4">
        <p className="flex items-start gap-1.5 text-sm leading-snug font-bold text-bakar-ink">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          {check.pacePct <= 1
            ? t("date.fast.titleSurplus", { surplus: fmtInt(check.rawSurplusKcal), max: fmtInt(MAX_SURPLUS_KCAL) })
            : t("date.fast.title", pace)}
        </p>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          {t("date.fast.body", { kg: fmtKg(check.gainKg), count: check.feasibleDays })}
        </p>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="mt-3"
          onClick={() => onUseDate(check.feasibleDays)}
        >
          {t("date.fast.useDate", { date: suggested })}
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-muted p-4">
      <p className="flex items-start gap-1.5 text-sm leading-snug font-bold">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
        {t("date.slow.title")}
      </p>
      <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
        {t("date.slow.body", { surplus: fmtInt(check.surplusKcal), date: suggested })}
      </p>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="mt-3"
        onClick={() => onUseDate(check.feasibleDays)}
      >
        {t("date.slow.useDate", { date: suggested })}
      </Button>
    </div>
  );
}
