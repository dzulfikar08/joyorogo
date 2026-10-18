import { useQuery } from "@tanstack/react-query";
import { Lightbulb, TrendingUp } from "lucide-react";
import { useTranslation } from "react-i18next";

import { gainEatTone, gainRemaining, type GainInfo } from "@joyorogo/api/lib/gain";
import type { WeekRecap } from "@joyorogo/api/lib/recap";

import { Card } from "@/components/kit/surface";
import type { DaySummary } from "@/lib/api-types";
import { fmtDateLong, fmtInt, fmtKg } from "@/lib/format";
import { orpc } from "@/utils/orpc";
import { GainDisclaimer, GainNotes } from "./gain-notes";

/**
 * "Sisa" under a gain plan: what is still to eat. Returns the state, the kcal, the ring
 * tone (never red) and the one-line copy for it.
 */
export function useGainIntake(targetKcal: number, eatenKcal: number) {
  const { t } = useTranslation("gain");
  const { state, kcal } = gainRemaining(targetKcal, eatenKcal);
  const line =
    state === "short"
      ? t("today.short", { kcal: fmtInt(kcal) })
      : state === "reached"
        ? t("today.reached")
        : t("today.over", { kcal: fmtInt(kcal) });
  return { state, kcal, tone: gainEatTone(eatenKcal, targetKcal), line };
}

/** The gentle line under the Beranda ring: short, reached or over, with its tip. */
export function GainIntakeNote({ targetKcal, eatenKcal }: { targetKcal: number; eatenKcal: number }) {
  const { t } = useTranslation("gain");
  const { state, line } = useGainIntake(targetKcal, eatenKcal);
  return (
    <div className="mt-2 space-y-0.5">
      <p
        className={`text-sm leading-snug font-semibold ${state === "over" ? "text-amber-600 dark:text-amber-400" : "text-makan-ink"}`}
      >
        {line}
      </p>
      <p className="text-xs leading-snug text-muted-foreground">
        {state === "short"
          ? t("today.tipShort")
          : state === "reached"
            ? t("today.tipReached")
            : `${t("today.overHint")} ${t("today.tipOver")}`}
      </p>
    </div>
  );
}

/** "Naik X kg dari Y kg" and "Z kg lagi ke target". */
export function GainProgressLines({ summary, gain }: { summary: DaySummary; gain: GainInfo }) {
  const { t } = useTranslation("gain");
  const profile = useQuery(orpc.profile.myProfile.queryOptions());
  const start =
    profile.data?.profile?.goalStartKg ??
    (summary.latestWeightKg !== null ? summary.latestWeightKg - summary.weightGainedKg : null);
  return (
    <div className="space-y-0.5 text-sm tabular-nums">
      {summary.weightGainedKg > 0 && start !== null && (
        <p className="font-semibold text-makan-ink">
          {t("today.progress", { kg: fmtKg(summary.weightGainedKg), start: fmtKg(start) })}
        </p>
      )}
      <p className="text-muted-foreground">{t("today.toGo", { kg: fmtKg(gain.gapKg) })}</p>
    </div>
  );
}

/** Beranda plan card for Naikin BB, in the place the Hamil card takes. */
export function GainPlanCard({ gain, summary }: { gain: GainInfo; summary: DaySummary }) {
  const { t } = useTranslation("gain");
  const targets = summary.targets;
  const proteinTarget = summary.protein?.targetG ?? gain.protein.targetG;
  return (
    <section aria-label={t("today.cardTitle")}>
      <Card className="p-4">
        <div className="flex items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-makan-soft">
            <TrendingUp className="size-5 text-makan-ink" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-base leading-tight font-bold tracking-tight">{t("today.cardTitle")}</h2>
            <p className="text-xs text-muted-foreground tabular-nums">
              {t("today.cardSummary", {
                target: fmtInt(targets.eatKcal),
                tdee: fmtInt(targets.tdee),
                surplus: `+${fmtInt(gain.surplusKcal)}`,
              })}
            </p>
          </div>
        </div>

        <div className="mt-4 space-y-3 text-sm">
          <GainProgressLines summary={summary} gain={gain} />
          <p className="text-muted-foreground tabular-nums">
            {t("plan.pace", { kg: fmtKg(gain.paceKgPerWeek), pct: fmtKg(gain.pacePct) })}
            {" "}
            {t("plan.reach", { date: fmtDateLong(gain.reachDate).replace(/^\w+, /, "") })}
          </p>
          <p className="font-semibold tabular-nums">
            {t("today.protein")}{" "}
            <span className="font-normal text-muted-foreground">
              {t("today.proteinOf", {
                eaten: fmtInt(summary.protein?.eatenG ?? 0),
                target: fmtInt(proteinTarget),
              })}
            </span>
          </p>
          {summary.streakDays > 0 && (
            <p className="text-muted-foreground">
              {t("today.streak", { count: summary.streakDays })}. {t("today.streakRule")}
            </p>
          )}
        </div>

        <GainNotes gain={gain} className="mt-4" />
        <p className="mt-4 text-xs leading-snug text-muted-foreground">{t("estimate.body")}</p>
        <GainDisclaimer short className="mt-3" />
      </Card>
    </section>
  );
}

/** Daily tip card under gain (the fat-loss tip is not shown). */
export function GainDailyTip() {
  const { t } = useTranslation("gain");
  return (
    <section className="mt-7" aria-label={t("coach.scanTitle")}>
      <div className="flex items-start gap-3 rounded-2xl bg-muted p-3.5">
        <span
          aria-hidden
          className="grid size-10 shrink-0 place-items-center rounded-full bg-makan-soft text-makan-ink"
        >
          <Lightbulb className="size-5" />
        </span>
        <p className="min-w-0 flex-1 self-center text-sm leading-snug font-semibold">
          {t("coach.dailyTip")}
        </p>
      </div>
    </section>
  );
}

/** Naikin BB week recap: the weight line (a gain is celebrated, a drop is neutral), days on target, one celebrate line. */
export function GainRecapNote({ recap }: { recap: WeekRecap }) {
  const { t } = useTranslation("gain");
  const change = recap.weight?.changeKg ?? null;
  const weightLine =
    change === null
      ? null
      : change >= 0.05
        ? t("recap.weightUp", { kg: fmtKg(change) })
        : change <= -0.05
          ? t("recap.weightDown", { kg: fmtKg(Math.abs(change)) })
          : t("recap.weightSteady");
  const celebrate =
    recap.daysOnTarget >= 5 ? "great" : recap.daysOnTarget >= 3 ? "some" : "low";
  return (
    <Card className="space-y-2 p-5">
      {weightLine && <p className="text-sm font-semibold">{weightLine}</p>}
      <p className="text-sm tabular-nums text-muted-foreground">
        {t("recap.daysOnTarget", { on: recap.daysOnTarget, total: recap.loggedDays })}
      </p>
      <p className="text-sm leading-snug">{t(`recap.celebrate.${celebrate}`)}</p>
    </Card>
  );
}
