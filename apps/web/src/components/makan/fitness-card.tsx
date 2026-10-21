import { jakartaToday } from "@joyorogo/api/lib/engine";
import {
  FOOD_GUIDANCE_TEASER,
  fitnessFigures,
  fitnessHints,
  fitnessVerdict,
  hasFitnessData,
} from "@joyorogo/api/lib/fitness-hint";
import type { FitnessDay, FitnessFigure } from "@joyorogo/api/lib/fitness-hint";
import type { FoodPick, ReadinessGuidance } from "@joyorogo/api/lib/readiness-food";
import type { TFunction } from "@joyorogo/i18n";
import { JOYOFIT_SITE_URL } from "@joyorogo/i18n/joyofit-links";
import { Button } from "@joyorogo/ui/components/button";
import { Sheet } from "@joyorogo/ui/components/sheet";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ChevronRight, Lock } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Card } from "@/components/kit/surface";
import { useAppConfig } from "@/lib/app-config";
import { fmtGramsLabel, fmtInt, fmtKcalLabel, timeAgo } from "@/lib/format";
import { orpc } from "@/utils/orpc";

function Figure({ figure }: { figure: FitnessFigure }) {
  return (
    <span className="block min-w-0 flex-1">
      <span className="block truncate text-xl leading-tight font-extrabold tabular-nums">
        {figure.value}
        {figure.unit ? <span className="text-sm font-semibold text-muted-foreground">{figure.unit}</span> : null}
      </span>
      <span className="block truncate text-xs text-muted-foreground">{figure.label}</span>
    </span>
  );
}

function Metric({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="min-w-0 flex-1">
      <p className="text-xl leading-tight font-extrabold tabular-nums">{value ?? "-"}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

/** Remaining figures that matter for the day's focus; a steady day shows none. */
function remaining(
  guidance: ReadinessGuidance,
  t: TFunction<"makan">,
): Array<{ label: string; value: string }> {
  const { numbers, focus } = guidance;
  if (!numbers || focus === "steady") return [];
  const rows = [{ label: t("fitnessCard.left.kcal"), value: fmtInt(numbers.roomKcal) }];
  if (focus !== "fuel") {
    rows.push({ label: t("fitnessCard.left.protein"), value: fmtGramsLabel(numbers.protein.remainingG) });
  }
  if (focus !== "recover") {
    rows.push({ label: t("fitnessCard.left.carbs"), value: fmtGramsLabel(numbers.carbs.remainingG) });
  }
  return rows;
}

function pickDetail(pick: FoodPick, t: TFunction<"makan">): string {
  const parts = [fmtKcalLabel(pick.kcal)];
  if (pick.proteinG !== null) parts.push(t("fitnessCard.pick.protein", { g: fmtGramsLabel(pick.proteinG) }));
  if (pick.carbsG !== null) parts.push(t("fitnessCard.pick.carbs", { g: fmtGramsLabel(pick.carbsG) }));
  parts.push(
    pick.source === "riwayat"
      ? t("fitnessCard.pick.history", { count: pick.days ?? 0, n: fmtInt(pick.days ?? 0) })
      : t("fitnessCard.pick.database"),
  );
  return parts.join(" · ");
}

function Guidance({ guidance }: { guidance: ReadinessGuidance }) {
  const { t } = useTranslation("makan");
  const stats = remaining(guidance, t);
  return (
    <div className="space-y-2.5 border-t border-border pt-3">
      <p className="text-sm font-semibold">{guidance.headline}</p>
      {guidance.lines.map((line) => (
        <p key={line} className="text-sm">
          {line}
        </p>
      ))}
      {stats.length > 0 ? (
        <div className="flex gap-3">
          {stats.map((stat) => (
            <Metric key={stat.label} label={stat.label} value={stat.value} />
          ))}
        </div>
      ) : null}
      {guidance.foods.length > 0 ? (
        <div>
          <p className="text-xs font-semibold text-muted-foreground">{t("fitnessCard.picksTitle")}</p>
          <ul className="mt-1 space-y-1.5">
            {guidance.foods.map((pick) => (
              <li key={pick.name}>
                <p className="text-sm font-medium">
                  {pick.name}
                  {pick.portion ? ` (${pick.portion})` : ""}
                </p>
                <p className="text-xs text-muted-foreground">{pickDetail(pick, t)}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {guidance.basis ? <p className="text-xs text-muted-foreground">{guidance.basis}</p> : null}
    </div>
  );
}

function Teaser() {
  return (
    <div className="space-y-2 border-t border-border pt-3">
      <p className="flex items-center gap-1.5 text-sm font-semibold">
        <Lock className="size-3.5 text-muted-foreground" aria-hidden />
        {FOOD_GUIDANCE_TEASER.title}
      </p>
      <p className="text-sm text-muted-foreground">{FOOD_GUIDANCE_TEASER.body}</p>
      <Button
        size="sm"
        render={<Link to="/pro" search={{ from: "fitness", next: "/makan" }} />}
      >
        {FOOD_GUIDANCE_TEASER.action}
      </Button>
    </div>
  );
}

/** Everything that was too long for the card: how to read the numbers, food hints or guidance, the way into JoyoFit. */
function DetailSheet({
  date,
  day,
  figures,
  onClose,
}: {
  date: string;
  day: FitnessDay;
  figures: FitnessFigure[];
  onClose: () => void;
}) {
  const { t } = useTranslation("makan");
  const config = useAppConfig();
  // Guidance is about what is left to eat today; a past day only has the hints.
  const guidance = useQuery({
    ...orpc.day.readinessGuidance.queryOptions(),
    enabled: date === jakartaToday(),
  });
  const ready = guidance.data?.status === "ready" ? guidance.data.guidance : null;
  const showTeaser = guidance.data?.status === "locked" && config.data?.billing === true;
  const hints = ready ? [] : fitnessHints(day);

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t("fitnessCard.sheet.title")}
    >
      <div className="space-y-3">
        {hints.map((hint) => (
          <p key={hint} className="text-sm">
            {hint}
          </p>
        ))}
        {ready ? <Guidance guidance={ready} /> : null}
        {showTeaser ? <Teaser /> : null}
        <div className="space-y-1.5 border-t border-border pt-3">
          <p className="text-sm font-semibold">{t("fitnessCard.sheet.explainTitle")}</p>
          {figures.map((figure) => (
            <p key={figure.id} className="text-xs text-muted-foreground">
              <span className="font-bold text-foreground">{figure.label}: </span>
              {t(`fitnessCard.explain.${figure.id}`)}
            </p>
          ))}
        </div>
        <Button className="min-h-11 w-full" render={<a href={JOYOFIT_SITE_URL} target="_blank" rel="noreferrer" />}>
          {t("fitnessCard.sheet.open")}
        </Button>
      </div>
    </Sheet>
  );
}

/**
 * JoyoFit's recovery, strain and readiness of the day (the Huawei watch app) as one compact card: title row,
 * at most three figures, one verdict line. Clicking it opens the detail sheet, which holds everything longer: how
 * to read the numbers, the food hints, Founder's personalised guidance (server-checked) or the locked teaser (only
 * when the server can actually sell Founder) and the way into JoyoFit. Renders nothing for a day JoyoFit pushed
 * no scores for, and nothing while loading or when the request fails.
 */
export function FitnessCard({ date }: { date: string }) {
  const { t } = useTranslation("makan");
  const [open, setOpen] = useState(false);
  const { data } = useQuery(orpc.fitness.byDate.queryOptions({ input: { date } }));
  if (!hasFitnessData(data)) return null;

  const figures = fitnessFigures(data);
  const verdict = fitnessVerdict(data);
  const summary = [...figures.map((f) => `${f.label} ${f.value}${f.unit ?? ""}`), verdict].filter(Boolean).join(", ");

  return (
    <>
      <Card className="mt-3 p-0">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={t("fitnessCard.aria", { summary })}
          className="block min-h-11 w-full space-y-2 rounded-3xl px-5 py-4 text-left transition-opacity hover:opacity-80 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
        >
          <span className="flex items-center gap-2">
            <span className="flex-1 text-sm font-semibold text-muted-foreground">{t("fitnessCard.title")}</span>
            {date === jakartaToday() ? (
              <span className="text-xs text-muted-foreground">{timeAgo(data.updatedAt)}</span>
            ) : null}
            <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
          </span>
          <span className="flex gap-3">
            {figures.map((figure) => (
              <Figure key={figure.id} figure={figure} />
            ))}
          </span>
          {verdict ? <span className="block truncate text-sm">{verdict}</span> : null}
        </button>
      </Card>
      {open ? <DetailSheet date={date} day={data} figures={figures} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
