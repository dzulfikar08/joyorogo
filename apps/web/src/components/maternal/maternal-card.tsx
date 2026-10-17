import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Baby, ChevronRight, Coffee, Scale } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { MaternalInfo } from "@joyorogo/api/lib/maternal";

import { Card } from "@/components/kit/surface";
import type { DaySummary } from "@/lib/api-types";
import { fmtInt, fmtKg } from "@/lib/format";
import { orpc } from "@/utils/orpc";
import { MaternalDisclaimer } from "./disclaimer";
import { MaternalFlagNotes } from "./flag-notes";
import { NutrientList } from "./nutrient-list";
import { useMaternalStageLine } from "./use-maternal";

/** Compact weight-gain line for pregnant users, linking to the chart on Berat. */
function GainMini() {
  const { t } = useTranslation("maternal");
  const chart = useQuery(orpc.weight.pregnancyChart.queryOptions());
  const current = chart.data?.current;
  return (
    <Link
      to="/berat"
      className="pressable flex min-h-14 items-center gap-3 rounded-2xl bg-muted/60 px-4 py-2.5 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
    >
      <Scale className="size-5 shrink-0 text-makan" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold">{t("home.weightTitle")}</span>
        <span className="block text-xs leading-snug text-muted-foreground tabular-nums">
          {current
            ? t("gain.current", {
                gain: fmtKg(current.gainKg),
                week: Math.floor(current.week),
                min: fmtKg(current.bandMinKg),
                max: fmtKg(current.bandMaxKg),
              })
            : t("gain.empty")}
        </span>
      </span>
      <span className="shrink-0 text-sm font-semibold text-primary">{t("home.seeAll")}</span>
    </Link>
  );
}

/** Beranda card for Hamil / Menyusui: stage, nutrients, caffeine, weight gain, notes. */
export function MaternalCard({ info, summary }: { info: MaternalInfo; summary: DaySummary }) {
  const { t } = useTranslation(["maternal", "common"]);
  const stageLine = useMaternalStageLine();
  const caffeine = summary.maternal?.caffeine;
  const stage =
    info.mode === "pregnant" && info.gestation
      ? t("maternal:home.pregnant", { week: info.gestation.weeks, trimester: info.gestation.trimester })
      : info.mode === "breastfeeding"
        ? t("maternal:home.breastfeeding", { months: info.babyMonths ?? 0 })
        : stageLine(info);

  return (
    <section aria-label={t("maternal:home.card")}>
      <Card className="p-4">
        <div className="flex items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-makan-soft">
            <Baby className="size-5 text-makan-ink" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-base leading-tight font-bold tracking-tight">{stage}</h2>
            <p className="text-xs text-muted-foreground tabular-nums">
              {t("maternal:target.base")} {fmtInt(info.baseKcal)} + {t("maternal:target.add")}{" "}
              {fmtInt(info.addKcal)} {t("maternal:target.kcal")}
            </p>
          </div>
          <Link
            to="/profil"
            search={{ maternal: true }}
            aria-label={t("maternal:home.seeAll")}
            className="-mr-2 flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
          >
            <ChevronRight className="size-5" aria-hidden />
          </Link>
        </div>

        <NutrientList info={info} date={summary.date} protein={summary.protein} className="mt-4" />

        {caffeine && caffeine.mg > 0 && (
          <p className="mt-4 flex items-start gap-2 text-sm leading-snug font-semibold tabular-nums">
            <Coffee className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            {caffeine.over
              ? t("maternal:flags.caffeineOver", { mg: fmtInt(caffeine.mg), limit: fmtInt(caffeine.limitMg) })
              : t("maternal:flags.caffeineDay", { mg: fmtInt(caffeine.mg), limit: fmtInt(caffeine.limitMg) })}
          </p>
        )}

        {info.mode === "pregnant" && (
          <div className="mt-4">
            <GainMini />
          </div>
        )}

        <MaternalFlagNotes info={info} className="mt-4" />
        <MaternalDisclaimer short className="mt-4" />
      </Card>
    </section>
  );
}
