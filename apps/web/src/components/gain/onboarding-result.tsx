import { useTranslation } from "react-i18next";

import type { Targets } from "@joyorogo/api/lib/engine";
import type { GainInfo } from "@joyorogo/api/lib/gain";

import { GainDisclaimer, GainNotes } from "@/components/gain/gain-notes";
import { PlanNumbers } from "@/components/plan-numbers";
import { fmtDateLong, fmtInt, fmtKg } from "@/lib/format";

/** Onboarding result card of a Naikin BB plan: TDEE + surplus = target, pace, protein, notes. */
export function GainOnboardingResult({ targets, gain }: { targets: Targets; gain: GainInfo }) {
  const { t } = useTranslation("gain");
  return (
    <>
      <PlanNumbers targets={targets} />
      <div className="mt-3 space-y-3 rounded-2xl bg-card p-4 text-sm leading-relaxed">
        <p className="font-semibold tabular-nums">
          {t("today.cardSummary", {
            target: fmtInt(targets.eatKcal),
            tdee: fmtInt(targets.tdee),
            surplus: `+${fmtInt(gain.surplusKcal)}`,
          })}
        </p>
        <p className="text-muted-foreground tabular-nums">
          {t("plan.pace", { kg: fmtKg(gain.paceKgPerWeek), pct: fmtKg(gain.pacePct) })}{" "}
          {t("plan.reach", { date: fmtDateLong(gain.reachDate).replace(/^\w+, /, "") })}
        </p>
        <p className="text-muted-foreground tabular-nums">
          {t("plan.protein", {
            min: fmtInt(gain.protein.minG),
            max: fmtInt(gain.protein.maxG),
            target: fmtInt(gain.protein.targetG),
          })}
        </p>
        <p className="text-muted-foreground">{t("plan.leanNote")}</p>
      </div>
      <GainNotes gain={gain} className="mt-3" />
      <GainDisclaimer short className="mt-3 px-1" />
    </>
  );
}
