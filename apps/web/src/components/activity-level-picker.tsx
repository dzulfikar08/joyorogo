import type { ActivityLevel } from "@joyorogo/api/lib/engine";
import type { ActivityOption } from "@joyorogo/api/lib/activity-guide";
import { cn } from "@joyorogo/ui/lib/utils";
import { Check } from "lucide-react";
import { useId } from "react";
import { useTranslation } from "react-i18next";

import { fmtFactor, fmtInt } from "@/lib/format";

/**
 * The five activity levels, each with what it means for this person: factor, TDEE and the eat target it gives.
 * Presentational: onboarding feeds it options computed from the form, Profil feeds it `profile.activityGuide`.
 * `value` is the level the others are compared against (the saved level, or the form's pick).
 */
export function ActivityLevelPicker({
  options,
  value,
  onSelect,
  maternal = false,
  disabled = false,
  className,
}: {
  options: readonly ActivityOption[];
  value: ActivityLevel | null;
  onSelect: (level: ActivityLevel) => void;
  maternal?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const { t } = useTranslation("energy");
  const ruleId = useId();
  const selected = options.find((option) => option.level === value) ?? null;

  return (
    <div className={cn("space-y-3", className)}>
      <p
        id={ruleId}
        className="rounded-2xl bg-muted px-4 py-3 text-sm leading-relaxed font-medium text-muted-foreground"
      >
        {t("pickRule")}
      </p>
      {maternal && (
        <p className="rounded-2xl bg-muted px-4 py-3 text-sm leading-relaxed text-muted-foreground">
          {t("maternalNote")}
        </p>
      )}
      <div role="radiogroup" aria-label={t("pickTitle")} aria-describedby={ruleId} className="space-y-2">
        {options.map((option) => {
          const isSelected = option.level === value;
          const diff = selected ? option.targetKcal - selected.targetKcal : 0;
          return (
            <button
              key={option.level}
              type="button"
              role="radio"
              aria-checked={isSelected}
              disabled={disabled}
              onClick={() => {
                if (!isSelected) onSelect(option.level);
              }}
              className={cn(
                "pressable block w-full rounded-2xl bg-card p-4 text-left focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none disabled:opacity-60",
                isSelected && "bg-makan-soft ring-2 ring-makan",
              )}
            >
              <span className="flex items-start justify-between gap-3">
                <span className="min-w-0">
                  <span className="block text-[0.9375rem] leading-snug font-bold">
                    {t(`levels.${option.level}.name`)}
                  </span>
                  <span className="block text-xs font-semibold text-muted-foreground tabular-nums">
                    {t("factor", { factor: fmtFactor(option.factor) })}
                  </span>
                </span>
                {isSelected && (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-card px-2.5 py-1 text-xs font-bold text-makan-ink">
                    <Check className="size-3.5" aria-hidden />
                    {t("current")}
                  </span>
                )}
              </span>
              <span className="mt-2 block text-sm leading-relaxed">{t(`levels.${option.level}.desc`)}</span>
              <span className="mt-1 block text-sm leading-relaxed text-muted-foreground">
                {t(`levels.${option.level}.example`)}
              </span>
              <span className="mt-3 block border-t border-border/70 pt-3">
                <span className="block text-sm font-bold tabular-nums">
                  {t("impact.target", { kcal: fmtInt(option.targetKcal) })}
                </span>
                <span className="block text-xs text-muted-foreground tabular-nums">
                  {t("impact.tdee", { kcal: fmtInt(option.tdeeKcal) })}
                </span>
                {selected && (
                  <span className="mt-1 block text-xs font-semibold text-muted-foreground tabular-nums">
                    {isSelected
                      ? t("impact.current")
                      : diff > 0
                        ? t("impact.up", { kcal: fmtInt(diff) })
                        : diff < 0
                          ? t("impact.down", { kcal: fmtInt(-diff) })
                          : t("impact.same")}
                  </span>
                )}
                {option.floored && (
                  <span className="mt-1 block text-xs font-semibold text-bakar-ink">{t("impact.floor")}</span>
                )}
              </span>
            </button>
          );
        })}
      </div>
      {selected && (
        <p className="px-1 text-xs leading-relaxed text-muted-foreground tabular-nums">
          {t("included", { kcal: fmtInt(selected.includedKcal), factor: fmtFactor(selected.factor) })}
        </p>
      )}
    </div>
  );
}
