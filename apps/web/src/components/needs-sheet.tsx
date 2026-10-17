import { Sheet } from "@joyorogo/ui/components/sheet";
import { cn } from "@joyorogo/ui/lib/utils";
import { useTranslation } from "react-i18next";

import { needsBreakdown } from "@joyorogo/api/lib/engine";
import type { Targets } from "@joyorogo/api/lib/engine";

import { fmtInt } from "@/lib/format";

/** "Kebutuhan harianmu": BMR -> activity -> TDEE -> minus cut -> eating target. */
export function NeedsSheet({
  open,
  onOpenChange,
  targets,
  activityLabel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targets: Targets;
  activityLabel: string;
}) {
  const { t } = useTranslation("settings");
  const needs = needsBreakdown(targets);
  const cutKey = needs.cutKcal > 0 ? "cut" : "cutNone";

  const steps = [
    { key: "bmr", value: fmtInt(needs.bmrKcal), body: t("plan.needs.bmr.body") },
    {
      key: "activity",
      value: `+ ${fmtInt(needs.activityKcal)}`,
      body: t("plan.needs.activity.body", { level: activityLabel }),
    },
    { key: "tdee", value: fmtInt(needs.tdeeKcal), body: t("plan.needs.tdee.body") },
    {
      key: cutKey,
      value: needs.cutKcal > 0 ? `− ${fmtInt(needs.cutKcal)}` : "0",
      body: t(`plan.needs.${cutKey}.body`),
    },
    { key: "target", value: fmtInt(needs.targetKcal), body: t("plan.needs.target.body") },
  ] as const;

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("plan.needs.title")}
      description={t("plan.needs.intro")}
    >
      <ol className="space-y-2">
        {steps.map((step) => {
          const final = step.key === "target";
          const total = step.key === "tdee";
          return (
            <li
              key={step.key}
              className={cn(
                "rounded-2xl p-4",
                final ? "bg-makan-soft" : total ? "bg-muted" : "border border-border",
              )}
            >
              <div className="flex items-baseline justify-between gap-3">
                <div className="min-w-0">
                  <p
                    className={cn(
                      "text-xs font-semibold",
                      final ? "text-makan-ink" : "text-muted-foreground",
                    )}
                  >
                    {t(`plan.needs.${step.key}.label`)}
                  </p>
                  <p className="text-[0.9375rem] font-bold">{t(`plan.needs.${step.key}.name`)}</p>
                </div>
                <p className="shrink-0 text-right tabular-nums">
                  <span className="text-2xl font-extrabold tracking-tight">{step.value}</span>
                  <span className="ml-1 text-xs font-semibold text-muted-foreground">kcal</span>
                </p>
              </div>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{step.body}</p>
            </li>
          );
        })}
      </ol>
      <p className="mt-2 px-1 text-xs text-muted-foreground">{t("plan.needs.unit")}</p>

      <div className="mt-3 space-y-3 text-sm leading-relaxed text-muted-foreground">
        {needs.plannedBurnKcal > 0 && (
          <p>
            {t("plan.needs.burnNote", {
              burn: fmtInt(needs.plannedBurnKcal),
              deficit: fmtInt(needs.deficitKcal),
            })}
          </p>
        )}
        {needs.adaptive && (
          <p>{t("plan.needs.adaptive", { formula: fmtInt(needs.formulaTdeeKcal) })}</p>
        )}
      </div>
    </Sheet>
  );
}
