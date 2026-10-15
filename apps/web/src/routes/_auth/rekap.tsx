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
        title="Rekap mingguan"
        subtitle={
          recap.complete
            ? weekRangeLabel(recap.weekStart)
            : `${weekRangeLabel(recap.weekStart)} · masih berjalan`
        }
        action={
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Minggu sebelumnya"
              onClick={() => go(shiftDate(recap.weekStart, -7))}
            >
              <ChevronLeft aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Minggu berikutnya"
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
          title={recap.empty ? "Belum ada catatan di minggu ini" : "Belum ada makanan yang dicatat"}
        >
          {recap.evaluatedDays === 0
            ? "Rekap dihitung dari hari yang sudah lewat. Cek lagi besok."
            : "Catat makananmu beberapa hari, nanti rekapnya muncul di sini."}
        </EmptyHint>
      ) : (
        <div className="space-y-3">
          <Card className="p-6">
            <p className="text-sm font-semibold text-muted-foreground">Rata-rata per hari</p>
            <p className="mt-1 text-[3rem] leading-none font-extrabold tracking-tighter tabular-nums">
              {fmtInt(recap.avgKcal)}
              <span className="ml-1.5 text-lg font-semibold tracking-normal text-muted-foreground">
                kcal
              </span>
            </p>
            <ProgressBar
              className="mt-4"
              value={recap.avgKcal}
              max={recap.targetKcal}
              ariaLabel={`Rata-rata ${fmtInt(recap.avgKcal)} dari target ${fmtInt(recap.targetKcal)} kcal`}
            />
            <p className="mt-2 text-sm text-muted-foreground tabular-nums">
              Targetmu {fmtInt(recap.targetKcal)} kcal. Dihitung dari {recap.loggedDays} hari
              yang kamu catat.
            </p>
          </Card>

          <Card>
            <SectionTitle className="mb-4 px-0">Harian</SectionTitle>
            <RecapChart days={recap.days} targetKcal={recap.targetKcal} />
          </Card>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <StatTile
              metric="makan"
              icon={<CircleCheck className="size-[1.125rem]" aria-hidden />}
              label="Sesuai target"
              value={recap.daysOnTarget}
              unit="hari"
              sub={`dari ${recap.loggedDays} hari tercatat`}
            />
            <StatTile
              metric="makan"
              icon={<MACRO_META.protein.Icon className="size-[1.125rem]" aria-hidden />}
              label="Protein"
              value={recap.protein ? fmtInt(recap.protein.avgG) : "–"}
              unit={recap.protein ? "g" : undefined}
              sub={
                recap.protein
                  ? `rata-rata, target ${fmtInt(recap.protein.targetG)} g`
                  : "belum ada data protein"
              }
            />
            <StatTile
              metric="bakar"
              icon={<Flame className="size-[1.125rem]" aria-hidden />}
              label="Beruntun"
              value={recap.streakDays}
              unit="hari"
              sub="mencatat tanpa putus"
            />
            <StatTile
              metric="bakar"
              icon={<Dumbbell className="size-[1.125rem]" aria-hidden />}
              label="Olahraga"
              value={fmtInt(recap.exercise.kcal)}
              unit="kcal"
              sub={
                recap.exercise.sessions > 0
                  ? `${fmtInt(recap.exercise.minutes)} menit, ${recap.exercise.sessions} sesi`
                  : "belum ada sesi"
              }
            />
            <StatTile
              metric="tidur"
              icon={<Scale className="size-[1.125rem]" aria-hidden />}
              label="Berat (tren)"
              value={change === null ? "–" : `${change > 0 ? "+" : ""}${fmtKg(change)}`}
              unit={change === null ? undefined : "kg"}
              sub={
                change === null
                  ? "perlu 2 kali timbang"
                  : `${fmtKg(recap.weight!.startKg)} ke ${fmtKg(recap.weight!.endKg)} kg`
              }
            />
            <StatTile
              metric="tidur"
              icon={<Trophy className="size-[1.125rem]" aria-hidden />}
              label="Hari terbaik"
              value={recap.bestDay ? weekdayName(recap.bestDay.date) : "–"}
              sub={
                recap.bestDay
                  ? `${fmtInt(recap.bestDay.eatenKcal)} kcal, paling dekat target`
                  : "belum ada hari sesuai target"
              }
            />
          </div>

          {share ? (
            <ShareStoryButton
              className="w-full"
              variant="secondary"
              label="Bagikan rekap ke Story"
              story={{
                kind: "recap",
                ...share,
                date: new Date(`${recap.weekEnd}T12:00:00+07:00`),
              }}
            />
          ) : null}

          <p className="px-1 pt-2 text-xs leading-relaxed text-muted-foreground">
            Hitungan dari catatanmu sendiri, bukan penilaian medis. Sesuai target berarti asupan
            sehari tidak lebih dari 5% di atas targetmu dan tidak kurang dari separuhnya. Berat
            memakai tren (rata-rata bergerak), jadi tidak ikut naik turun timbangan harian.
            {recap.complete
              ? ""
              : " Minggu ini dihitung sampai kemarin; hari ini belum ikut dinilai."}
          </p>
        </div>
      )}
    </Page>
  );
}

function RekapSkeleton() {
  return (
    <Page className="max-w-xl lg:max-w-3xl" aria-busy="true" aria-label="Memuat rekap mingguan">
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
