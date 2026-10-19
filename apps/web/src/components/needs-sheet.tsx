import { Sheet } from "@joyorogo/ui/components/sheet";
import { cn } from "@joyorogo/ui/lib/utils";
import { useTranslation } from "react-i18next";

import { needsBreakdown } from "@joyorogo/api/lib/engine";
import type { Targets } from "@joyorogo/api/lib/engine";
import { MAX_SURPLUS_KCAL, MIN_SURPLUS_KCAL } from "@joyorogo/api/lib/gain";

import { Link } from "@tanstack/react-router";

import { EnergySources } from "@/components/energy-sources";
import { storedAddBackSettings } from "@/lib/exercise-credit-prefs";
import { fmtDateLong, fmtFactor, fmtInt } from "@/lib/format";

/**
 * "Kebutuhan harianmu": BMR x factor = TDEE -> minus cut -> eating target. Hamil/Menyusui: TDEE -> AKG addition ->
 * target. Movement measured beyond the factor comes on top; the sources behind every number close the sheet.
 */
export function NeedsSheet({
  open,
  onOpenChange,
  targets,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targets: Targets;
}) {
  const { t } = useTranslation(["settings", "maternal", "gain", "energy", "home"]);
  const needs = needsBreakdown(targets);
  const maternal = targets.maternal;
  const gain = targets.gain;
  const cutKey = needs.cutKcal > 0 ? "cut" : "cutNone";
  const hasExtra = needs.exerciseKcal > 0;
  const calibration = needs.calibration;
  const active = calibration?.status === "active" ? calibration : null;
  const calibrated = active !== null;
  const step = (
    key: "bmr" | "activity" | "tdee" | "cut" | "cutNone" | "target",
    value: string,
    body: string,
  ) => ({
    key,
    label: t(`settings:plan.needs.${key}.label`),
    name: t(`settings:plan.needs.${key}.name`),
    value,
    body,
  });

  const steps = [
    step("bmr", fmtInt(needs.bmrKcal), t("settings:plan.needs.bmr.body")),
    step(
      "activity",
      `+ ${fmtInt(needs.activityKcal)}`,
      active
        ? t("energy:needs.calibrated", {
            formula: fmtInt(active.formulaKcal),
            measured: fmtInt(active.measuredKcal ?? active.formulaKcal),
            used: fmtInt(active.usedKcal ?? needs.tdeeKcal),
          })
        : t("settings:plan.needs.activity.body", { level: t(`energy:levels.${needs.level}.name`) }),
    ),
    maternal
      ? {
          key: "tdee",
          label: t("settings:plan.needs.tdee.label"),
          name: t("maternal:needs.baseName"),
          value: fmtInt(needs.tdeeKcal),
          body: t("maternal:needs.baseBody"),
        }
      : step("tdee", fmtInt(needs.tdeeKcal), t("settings:plan.needs.tdee.body")),
    ...(maternal
      ? [
          {
            key: "add",
            label: t(`maternal:needs.add.${maternal.stage}`),
            name: t("maternal:target.add"),
            value: `+ ${fmtInt(needs.addKcal)}`,
            body: t("maternal:needs.addBody"),
          },
        ]
      : gain
        ? [
            {
              key: "surplus",
              label: t("gain:plan.surplus.label"),
              name: t("gain:plan.surplus.name"),
              value: `+ ${fmtInt(needs.surplusKcal)}`,
              body: t("gain:plan.surplus.body", { min: MIN_SURPLUS_KCAL, max: MAX_SURPLUS_KCAL }),
            },
          ]
        : [
            step(
              cutKey,
              needs.cutKcal > 0 ? `− ${fmtInt(needs.cutKcal)}` : "0",
              t(`settings:plan.needs.${cutKey}.body`),
            ),
          ]),
    step("target", fmtInt(needs.targetKcal), t("settings:plan.needs.target.body")),
    ...(hasExtra
      ? [
          {
            key: "extra",
            label: t(calibrated ? "energy:needs.extra.labelCalibrated" : "energy:needs.extra.label"),
            name: t("energy:needs.extra.name"),
            value: `+ ${fmtInt(needs.exerciseKcal)}`,
            body: calibrated
              ? t("energy:needs.extra.bodyCalibrated", { pct: storedAddBackSettings().pct })
              : t("energy:needs.extra.body", { pct: storedAddBackSettings().pct }),
          },
          {
            key: "budget",
            label: t("settings:plan.needs.target.label"),
            name: t("home:explain.sum.target"),
            value: fmtInt(needs.budgetKcal),
            body: t("settings:plan.needs.target.body"),
          },
        ]
      : []),
  ];
  const finalKey = steps.at(-1)?.key;

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("settings:plan.needs.title")}
      description={t("settings:plan.needs.intro")}
    >
      <div className="mb-3 rounded-2xl bg-makan-soft p-4">
        <p className="text-[0.9375rem] leading-snug font-extrabold text-makan-ink tabular-nums">
          {calibrated
            ? t("energy:needs.formulaCalibrated", {
                bmr: fmtInt(needs.bmrKcal),
                move: fmtInt(needs.tdeeKcal - needs.bmrKcal),
                tdee: fmtInt(needs.tdeeKcal),
              })
            : t("energy:needs.formula", {
                bmr: fmtInt(needs.bmrKcal),
                factor: fmtFactor(needs.factor),
                tdee: fmtInt(needs.tdeeKcal),
              })}
        </p>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground tabular-nums">
          {calibrated
            ? t("energy:needs.includedCalibrated", { kcal: fmtInt(needs.includedKcal) })
            : t("energy:needs.included", { factor: fmtFactor(needs.factor), kcal: fmtInt(needs.includedKcal) })}
        </p>
        {calibration && !maternal && (
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground tabular-nums">
            {calibration.status === "off"
              ? t("energy:auto.status.off", { formula: fmtInt(calibration.formulaKcal) })
              : calibration.status === "waiting"
                ? t("energy:auto.status.waiting", { date: fmtDateLong(calibration.nextDate) })
                : calibration.status === "collecting"
                  ? t("energy:auto.status.collecting", {
                      logged: calibration.loggedDays,
                      loggedNeeded: calibration.loggedDaysNeeded,
                      count: calibration.weighIns,
                      needed: calibration.weighInsNeeded,
                      span: calibration.spanDays,
                      spanNeeded: calibration.spanDaysNeeded,
                    })
                  : null}{" "}
            <Link
              to="/panduan/kalori"
              hash="calibration"
              className="font-semibold text-primary underline underline-offset-4 hover:text-primary/80"
            >
              {t("energy:auto.learn")}
            </Link>
          </p>
        )}
      </div>
      <ol className="space-y-2">
        {steps.map((step) => {
          const final = step.key === finalKey;
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
                    {step.label}
                  </p>
                  <p className="text-[0.9375rem] font-bold">{step.name}</p>
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
      <p className="mt-2 px-1 text-xs text-muted-foreground">{t("settings:plan.needs.unit")}</p>

      <div className="mt-3 space-y-3 text-sm leading-relaxed text-muted-foreground">
        {maternal && <p>{t("maternal:needs.noDeficit")}</p>}
        {gain && <p>{t("gain:plan.burnNote")}</p>}
        {!maternal && !gain && !needs.maintenance && needs.deficitKcal > 0 && (
          <p>{t("plan.needs.burnNote", { deficit: fmtInt(needs.deficitKcal) })}</p>
        )}
        {gain && <p>{t("gain:plan.estimate")}</p>}
        {gain && (
          <p>
            <span className="font-semibold">{t("gain:estimate.title")}.</span> {t("gain:estimate.body")}
          </p>
        )}
        {!hasExtra && <p>{t(calibrated ? "energy:needs.noneCalibrated" : "energy:needs.none")}</p>}
      </div>
      <EnergySources className="mt-6" />
    </Sheet>
  );
}
