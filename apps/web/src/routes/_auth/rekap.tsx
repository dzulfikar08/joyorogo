import { kcalUnit } from "@joyorogo/i18n";
import { Button } from "@joyorogo/ui/components/button";
import { Skeleton } from "@joyorogo/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Navigate } from "@tanstack/react-router";
import {
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Dumbbell,
  Flame,
  Scale,
  Trophy,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { jakartaToday, shiftDate } from "@joyorogo/api/lib/engine";
import {
  defaultRecapWeek,
  recapShare,
  weekdayName,
  weekRangeLabel,
  weekStartOf,
} from "@joyorogo/api/lib/recap";

import { Card, Page, PageHeader, SectionTitle, StatTile } from "@/components/kit/surface";
import { ProgressBar } from "@/components/progress-bar";
import { RecapChart } from "@/components/recap-chart";
import { RecapReflection } from "@/components/recap-reflection";
import { GainRecapNote } from "@/components/gain/gain-today";
import { EmptyHint, ScreenError } from "@/components/screen-state";
import { ShareStoryButton } from "@/components/story/share-story-button";
import { fmtInt, fmtKg } from "@/lib/format";
import { MACRO_META } from "@/lib/macro-icons";
import { orpc } from "@/utils/orpc";

const recapOptions = (weekStart: string) =>
  orpc.stats.weekRecap.queryOptions({ input: { weekStart } });

export const Route = createFileRoute("/_auth/rekap")({
  validateSearch: (search: Record<string, unknown>): { week?: string } => {
    const raw = typeof search.week === "string" ? search.week : undefined;
    return { week: raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? weekStartOf(raw) : undefined };
  },
  loaderDeps: ({ search }) => ({ week: search.week }),
  loader: ({ context, deps }) =>
    context.queryClient.ensureQueryData(
      recapOptions(deps.week ?? defaultRecapWeek(jakartaToday())),
    ),
  pendingComponent: RekapSkeleton,
  component: RekapPage,
});

function RekapPage() {
  const { t } = useTranslation(["misc", "common", "gain"]);
  const { week } = Route.useSearch();
  const navigate = Route.useNavigate();
  const today = jakartaToday();
  const thisWeek = weekStartOf(today);
  const weekStart = week && week <= thisWeek ? week : defaultRecapWeek(today);
  const query = useQuery(recapOptions(weekStart));

  if (query.isPending) return <RekapSkeleton />;
  if (query.error) {
    return <ScreenError message={query.error.message} onRetry={() => query.refetch()} />;
  }
  const recap = query.data;
  if (recap === null) return <Navigate to="/onboarding" replace />;

  const go = (target: string) => navigate({ search: { week: target } });
  const share = recapShare(recap);
  const change = recap.weight?.changeKg ?? null;

  return (
    <Page className="max-w-xl lg:max-w-3xl">
      <PageHeader
        title={t("recap.title")}
        subtitle={
          recap.complete
            ? weekRangeLabel(recap.weekStart)
            : t("recap.subtitleOngoing", { range: weekRangeLabel(recap.weekStart) })
        }
        action={
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("recap.prevWeek")}
              onClick={() => go(shiftDate(recap.weekStart, -7))}
            >
              <ChevronLeft aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("recap.nextWeek")}
              disabled={recap.weekStart >= thisWeek}
              onClick={() => go(shiftDate(recap.weekStart, 7))}
            >
              <ChevronRight aria-hidden />
            </Button>
          </div>
        }
      />

      {recap.avgKcal === null ? (
        <EmptyHint
          pose="determined"
          title={recap.empty ? t("recap.empty.titleNone") : t("recap.empty.titleNoFood")}
        >
          {recap.evaluatedDays === 0 ? t("recap.empty.bodyPast") : t("recap.empty.bodyLog")}
        </EmptyHint>
      ) : (
        <div className="space-y-3">
          <Card className="p-5">
            <p className="text-sm font-semibold text-muted-foreground">{t("recap.avg.label")}</p>
            <p className="mt-1 text-[3rem] leading-none font-extrabold tracking-tighter tabular-nums">
              {fmtInt(recap.avgKcal)}
              <span className="ml-1.5 text-lg font-semibold tracking-normal text-muted-foreground">
                {kcalUnit()}
              </span>
            </p>
            <ProgressBar
              className="mt-4"
              value={recap.avgKcal}
              max={recap.targetKcal}
              ariaLabel={t("recap.avg.aria", { avg: fmtInt(recap.avgKcal), target: fmtInt(recap.targetKcal) })}
            />
            <p className="mt-2 text-sm text-muted-foreground tabular-nums">
              {t("recap.avg.note", { count: recap.loggedDays, target: fmtInt(recap.targetKcal) })}
            </p>
          </Card>

          <Card>
            <SectionTitle className="mb-4 px-0">{t("recap.daily")}</SectionTitle>
            <RecapChart days={recap.days} targetKcal={recap.targetKcal} gain={recap.gain} />
          </Card>

          {recap.gain && <GainRecapNote recap={recap} />}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <StatTile
              metric="makan"
              icon={<CircleCheck className="size-[1.125rem]" aria-hidden />}
              label={t("recap.stat.onTarget.label")}
              value={recap.daysOnTarget}
              unit={t("recap.unit.day", { count: recap.daysOnTarget })}
              sub={t("recap.stat.onTarget.sub", { count: recap.loggedDays })}
            />
            <StatTile
              metric="makan"
              icon={<MACRO_META.protein.Icon className="size-[1.125rem]" aria-hidden />}
              label={MACRO_META.protein.label}
              value={recap.protein ? fmtInt(recap.protein.avgG) : "–"}
              unit={recap.protein ? "g" : undefined}
              sub={
                recap.protein
                  ? t("recap.stat.protein.sub", { target: fmtInt(recap.protein.targetG) })
                  : t("recap.stat.protein.none")
              }
            />
            <StatTile
              metric="bakar"
              icon={<Flame className="size-[1.125rem]" aria-hidden />}
              label={t("recap.stat.streak.label")}
              value={recap.streakDays}
              unit={t("recap.unit.day", { count: recap.streakDays })}
              sub={recap.gain ? t("gain:today.streakRule") : t("recap.stat.streak.sub")}
            />
            <StatTile
              metric="bakar"
              icon={<Dumbbell className="size-[1.125rem]" aria-hidden />}
              label={t("common:nav.exercise")}
              value={fmtInt(recap.exercise.kcal)}
              unit={kcalUnit()}
              sub={
                recap.exercise.sessions > 0
                  ? t("recap.stat.exercise.sub", {
                      count: recap.exercise.sessions,
                      minutes: fmtInt(recap.exercise.minutes),
                    })
                  : t("recap.stat.exercise.none")
              }
            />
            <StatTile
              metric="tidur"
              icon={<Scale className="size-[1.125rem]" aria-hidden />}
              label={t("recap.stat.weight.label")}
              value={change === null ? "–" : `${change > 0 ? "+" : ""}${fmtKg(change)}`}
              unit={change === null ? undefined : "kg"}
              sub={
                change === null
                  ? t("recap.stat.weight.none")
                  : t("recap.stat.weight.range", {
                      from: fmtKg(recap.weight!.startKg),
                      to: fmtKg(recap.weight!.endKg),
                    })
              }
            />
            <StatTile
              metric="tidur"
              icon={<Trophy className="size-[1.125rem]" aria-hidden />}
              label={t("recap.stat.bestDay.label")}
              value={recap.bestDay ? weekdayName(recap.bestDay.date) : "–"}
              sub={
                recap.bestDay
                  ? t("recap.stat.bestDay.sub", { kcal: fmtInt(recap.bestDay.eatenKcal) })
                  : t("recap.stat.bestDay.none")
              }
            />
          </div>

          <RecapReflection weekStart={recap.weekStart} />

          {share ? (
            <ShareStoryButton
              className="w-full"
              variant="secondary"
              label={t("recap.share")}
              story={{
                kind: "recap",
                ...share,
                date: new Date(`${recap.weekEnd}T12:00:00+07:00`),
              }}
            />
          ) : null}

          <details className="group px-1 pt-1 text-xs text-muted-foreground">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 font-semibold select-none [&::-webkit-details-marker]:hidden">
              <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" aria-hidden />
              {t("recap.note.title")}
            </summary>
            <p className="mt-1.5 pl-5 leading-relaxed">
              {recap.gain ? t("gain:today.streakRule") : t("recap.note.body")}
              {recap.complete ? "" : ` ${t("recap.note.ongoing")}`}
            </p>
          </details>
        </div>
      )}
    </Page>
  );
}

function RekapSkeleton() {
  const { t } = useTranslation("misc");
  return (
    <Page className="max-w-xl lg:max-w-3xl" aria-busy="true" aria-label={t("recap.loading")}>
      <div className="px-1 pt-2 pb-5">
        <Skeleton className="h-8 w-44 rounded-full" />
        <Skeleton className="mt-2 h-4 w-28 rounded-full" />
      </div>
      <Skeleton className="h-44 rounded-3xl" />
      <Skeleton className="mt-3 h-56 rounded-3xl" />
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-28 rounded-2xl" />
        ))}
      </div>
    </Page>
  );
}
