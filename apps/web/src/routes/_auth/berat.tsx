import { Button } from "@joyorogo/ui/components/button";
import { Input } from "@joyorogo/ui/components/input";
import { Sheet } from "@joyorogo/ui/components/sheet";
import { Skeleton } from "@joyorogo/ui/components/skeleton";
import { cn } from "@joyorogo/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { CalendarClock, Medal, Scale, TrendingDown, TrendingUp } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { daysBetween, jakartaToday } from "@joyorogo/api/lib/engine";

import { ScreenError } from "@/components/screen-state";
import {
  Card,
  ListGroup,
  ListRow,
  Page,
  PageHeader,
  SectionTitle,
  Segmented,
} from "@/components/kit/surface";
import { fmtKg, jakartaDatePlusDays, parseNum } from "@/lib/format";
import type { WeightHistory } from "@/lib/api-types";
import { orpc } from "@/utils/orpc";

const historyOptions = orpc.weight.history.queryOptions({ input: { limit: 90 } });
// The authoritative trend (28-day smoothed EMA + pace + projection) comes
// from day.summary; the history only supplies the raw scale dots.
const summaryOptions = orpc.day.summary.queryOptions({ input: {} });
const profileOptions = orpc.profile.myProfile.queryOptions();

export const Route = createFileRoute("/_auth/berat")({
  loader: ({ context }) => context.queryClient.ensureQueryData(historyOptions),
  pendingComponent: BeratSkeleton,
  component: BeratPage,
});

const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "Mei",
  "Jun",
  "Jul",
  "Agu",
  "Sep",
  "Okt",
  "Nov",
  "Des",
] as const;

/** 'YYYY-MM-DD' -> "14 Okt" */
function shortDate(date: string): string {
  const [, m, d] = date.split("-");
  return `${Number(d)} ${MONTHS_SHORT[Number(m) - 1]}`;
}

const PAD = { top: 18, right: 14, bottom: 26, left: 38 };

/** Measures the chart container so the SVG renders 1:1 and 11px text stays 11px. */
function useChartSize() {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const w = el.clientWidth;
      if (w > 0) setSize({ w, h: w < 480 ? 180 : 240 });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return { ref, size };
}

function WeightChart({
  width,
  height,
  entries,
  trendPoints,
  targetKg,
  rangeDays,
}: {
  width: number;
  height: number;
  entries: Array<{ date: string; weightKg: number }>;
  trendPoints: Array<{ date: string; trendKg: number }>;
  targetKg: number | null;
  rangeDays: number;
}) {
  const CHART_W = width;
  const CHART_H = height;
  const innerW = CHART_W - PAD.left - PAD.right;
  const innerH = CHART_H - PAD.top - PAD.bottom;
  const weights = entries.map((e) => e.weightKg);
  let lo = Math.min(...weights);
  let hi = Math.max(...weights);
  const span = Math.max(hi - lo, 1);
  // The target line joins the view only when near the data — a goal 20 kg
  // away would flatten the whole trend line.
  const target =
    targetKg !== null && targetKg >= lo - span && targetKg <= hi + span ? targetKg : null;
  if (target !== null) {
    lo = Math.min(lo, target);
    hi = Math.max(hi, target);
  }
  lo -= 0.5;
  hi += 0.5;

  const firstDate = entries[0].date;
  const last = entries.at(-1);
  if (!last) return null;
  const spanDays = entries.length > 1 ? Math.max(daysBetween(firstDate, last.date), 1) : 0;
  const x = (date: string) =>
    spanDays === 0
      ? PAD.left + innerW / 2
      : PAD.left + (daysBetween(firstDate, date) / spanDays) * innerW;
  const y = (kg: number) => PAD.top + (1 - (kg - lo) / (hi - lo)) * innerH;
  const trendPath =
    trendPoints.length > 1
      ? trendPoints
          .map((p, i) => `${i === 0 ? "M" : "L"}${x(p.date).toFixed(1)} ${y(p.trendKg).toFixed(1)}`)
          .join(" ")
      : null;
  const mid = entries[Math.floor((entries.length - 1) / 2)];
  const xTicks = [entries[0], mid, last].filter(
    (e, i, all) => all.findIndex((other) => other.date === e.date) === i,
  );

  return (
    <svg
      viewBox={`0 0 ${CHART_W} ${CHART_H}`}
      width={CHART_W}
      height={CHART_H}
      className="h-auto max-w-full"
      role="img"
      aria-label={`Grafik berat badan ${rangeDays} hari terakhir`}
    >
      {target !== null && (
        <g>
          <line
            x1={PAD.left}
            x2={CHART_W - PAD.right}
            y1={y(target)}
            y2={y(target)}
            strokeDasharray="4 5"
            strokeWidth={1.5}
            className="stroke-makan/45"
          />
          <text
            x={CHART_W - PAD.right}
            y={y(target) - 6}
            textAnchor="end"
            fontSize={11}
            fontWeight={600}
            className="fill-makan-ink"
          >
            Target {fmtKg(target)}
          </text>
        </g>
      )}
      {/* The smoothed trend is the number to believe; scale dots stay faint
          underneath so daily water noise reads as noise. */}
      {entries.map((e) => (
        <circle
          key={e.date}
          cx={x(e.date)}
          cy={y(e.weightKg)}
          r={2.5}
          className="fill-primary/35"
        />
      ))}
      {trendPath && (
        <path
          d={trendPath}
          fill="none"
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          className="stroke-primary"
        />
      )}
      <g fontSize={11} fontWeight={600} className="fill-muted-foreground">
        <text x={PAD.left - 8} y={PAD.top + 4} textAnchor="end">
          {fmtKg(hi)}
        </text>
        <text x={PAD.left - 8} y={PAD.top + innerH + 4} textAnchor="end">
          {fmtKg(lo)}
        </text>
      </g>
      <g fontSize={11} fontWeight={500} className="fill-muted-foreground">
        {xTicks.map((t, i) => (
          <text
            key={t.date}
            x={x(t.date)}
            y={CHART_H - 8}
            textAnchor={i === 0 ? "start" : i === xTicks.length - 1 ? "end" : "middle"}
          >
            {shortDate(t.date)}
          </text>
        ))}
      </g>
    </svg>
  );
}

function BeratPage() {
  const history = useQuery(historyOptions);
  if (history.isPending) return <BeratSkeleton />;
  if (history.error) {
    return <ScreenError message={history.error.message} onRetry={() => history.refetch()} />;
  }
  return <BeratScreen history={history.data} />;
}

function BeratScreen({ history }: { history: WeightHistory }) {
  const queryClient = useQueryClient();
  const summary = useQuery(summaryOptions);
  const profile = useQuery(profileOptions);
  const { entries, summary: weightSummary } = history;
  const trend = summary.data?.trend ?? null;
  const today = jakartaToday();

  const [range, setRange] = useState<"30" | "90">("90");
  const [showAll, setShowAll] = useState(false);
  const [weighOpen, setWeighOpen] = useState(false);
  const [weighValue, setWeighValue] = useState("");
  const chart = useChartSize();

  const checkIn = useMutation(
    orpc.weight.checkIn.mutationOptions({
      onSuccess: (row) => {
        if (!row) return;
        toast.success(`Berat dicatat: ${fmtKg(row.weightKg)} kg.`);
        setWeighOpen(false);
        // Targets (and therefore the eat number) use the latest known weight.
        queryClient.invalidateQueries({ queryKey: orpc.weight.key() });
        queryClient.invalidateQueries({ queryKey: orpc.day.key() });
        queryClient.invalidateQueries({ queryKey: orpc.profile.key() });
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  const openWeigh = () => {
    setWeighValue(weightSummary.latestKg !== null ? String(weightSummary.latestKg) : "");
    setWeighOpen(true);
  };
  const submitWeigh = () => {
    const kg = parseNum(weighValue);
    if (kg === null || kg < 25 || kg > 400) {
      toast.error("Isi berat badan antara 25 dan 400 kg.");
      return;
    }
    checkIn.mutate({ weightKg: kg });
  };

  const trendKg = trend?.weightKg ?? weightSummary.latestKg;
  const rate = trend?.weeklyRateKg ?? null;
  const flat = rate !== null && Math.abs(rate) <= 0.05;
  const heightCm = profile.data?.profile?.heightCm ?? null;
  const bmi =
    weightSummary.latestKg !== null && heightCm
      ? weightSummary.latestKg / (heightCm / 100) ** 2
      : null;
  const bmiCategory =
    bmi === null
      ? null
      : bmi < 18.5
        ? "Kurang"
        : bmi < 25
          ? "Ideal"
          : bmi < 30
            ? "Overweight"
            : "Obesitas";
  const goalReached =
    trendKg !== null && weightSummary.targetKg !== null && trendKg <= weightSummary.targetKg;

  const rangeDays = range === "30" ? 30 : 90;
  const cutoff = jakartaDatePlusDays(-(rangeDays - 1));
  const rangeEntries = entries.filter((e) => e.date >= cutoff);
  const rangeTrend = (trend?.points ?? []).filter((p) => p.date >= cutoff);

  const newestFirst = [...entries].toReversed();
  const visibleHistory = showAll ? newestFirst : newestFirst.slice(0, 10);

  return (
    <Page className="max-w-xl lg:max-w-5xl">
      <PageHeader
        title="Berat badan"
        action={
          <Button onClick={openWeigh} disabled={checkIn.isPending}>
            Timbang
          </Button>
        }
      />

      {weightSummary.latestKg === null ? (
        <Card className="text-center">
          <p className="text-base font-bold">Belum ada catatan berat</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
            Timbang dirimu lalu simpan lewat tombol Timbang. Grafik, tren, dan riwayat muncul
            setelah catatan pertama.
          </p>
          <Button className="mt-4" variant="secondary" onClick={openWeigh}>
            Timbang sekarang
          </Button>
        </Card>
      ) : (
        <div className="grid items-start gap-3 lg:grid-cols-[1.15fr_1fr] lg:gap-5">
          <div className="space-y-3 lg:space-y-5">
            <Card className="p-6">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-[0.8125rem] font-semibold text-muted-foreground">Berat tren</p>
                  <p className="mt-1 text-[3.25rem] leading-none font-extrabold tracking-tighter tabular-nums">
                    {fmtKg(trendKg ?? 0)}
                    <span className="ml-1.5 text-lg font-bold text-muted-foreground">kg</span>
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2">
                  {bmi !== null && bmiCategory !== null && (
                    <span
                      className={cn(
                        "inline-flex min-h-8 items-center rounded-full px-3 text-xs font-bold tabular-nums",
                        bmiCategory === "Ideal"
                          ? "bg-makan-soft text-makan-ink"
                          : "bg-bakar-soft text-bakar-ink",
                      )}
                    >
                      BMI {fmtKg(bmi)} · {bmiCategory}
                    </span>
                  )}
                  <span className="inline-flex min-h-8 items-center gap-1.5 rounded-full bg-muted px-3 text-xs font-semibold text-muted-foreground tabular-nums">
                    <Scale className="size-3.5" aria-hidden />
                    Timbangan {fmtKg(weightSummary.latestKg)} kg
                  </span>
                </div>
              </div>

              {rate !== null && (
                <p
                  className={cn(
                    "mt-3 flex items-center gap-1.5 text-sm font-bold",
                    flat ? "text-muted-foreground" : rate < 0 ? "text-makan-ink" : "text-bakar-ink",
                  )}
                >
                  {!flat &&
                    (rate < 0 ? (
                      <TrendingDown className="size-4" aria-hidden />
                    ) : (
                      <TrendingUp className="size-4" aria-hidden />
                    ))}
                  {flat
                    ? "Stabil minggu ini"
                    : `${rate < 0 ? "Turun" : "Naik"} ${fmtKg(Math.abs(rate))} kg/minggu`}
                </p>
              )}

              {goalReached ? (
                <p className="mt-5 flex items-center gap-2 rounded-2xl bg-makan-soft px-4 py-3 text-sm font-bold text-makan-ink">
                  <Medal className="size-4 shrink-0" aria-hidden />
                  Target berat sudah tercapai. Jaga ritmenya.
                </p>
              ) : (
                trend?.projectedDate &&
                weightSummary.targetKg !== null && (
                  <p className="mt-5 flex items-start gap-2 border-t border-border/60 pt-4 text-sm text-muted-foreground">
                    <CalendarClock className="mt-0.5 size-4 shrink-0" aria-hidden />
                    <span>
                      Dengan ritme ini, target{" "}
                      <strong className="font-semibold text-foreground tabular-nums">
                        {fmtKg(weightSummary.targetKg)} kg
                      </strong>{" "}
                      tercapai sekitar{" "}
                      <strong className="font-semibold text-foreground">
                        {new Intl.DateTimeFormat("id-ID", {
                          day: "numeric",
                          month: "long",
                          year: "numeric",
                          timeZone: "Asia/Jakarta",
                        }).format(new Date(`${trend.projectedDate}T00:00:00Z`))}
                      </strong>
                      .
                    </span>
                  </p>
                )
              )}
            </Card>

            <Card aria-label="Grafik tren berat">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-base font-bold tracking-tight">Grafik tren</h2>
                <Segmented
                  label="Rentang grafik"
                  value={range}
                  onChange={setRange}
                  options={[
                    { value: "30", label: "30 hari" },
                    { value: "90", label: "90 hari" },
                  ]}
                />
              </div>
              {rangeEntries.length > 1 ? (
                <div ref={chart.ref} className={cn("mt-4", !chart.size && "h-44")}>
                  {chart.size && (
                    <WeightChart
                      width={chart.size.w}
                      height={chart.size.h}
                      entries={rangeEntries}
                      trendPoints={rangeTrend}
                      targetKg={weightSummary.targetKg}
                      rangeDays={rangeDays}
                    />
                  )}
                </div>
              ) : (
                <p className="py-12 text-center text-sm text-muted-foreground">
                  Belum cukup catatan dalam {rangeDays} hari terakhir untuk menggambar grafik.
                </p>
              )}
              <p className="mt-2 text-xs text-muted-foreground">
                Titik tipis angka timbangan, garis tebal berat tren yang lebih tenang.
              </p>
            </Card>
          </div>

          <div className="space-y-3 lg:space-y-5">
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-2xl bg-card p-3.5">
                <p className="text-[0.8125rem] font-semibold text-muted-foreground">Mulai</p>
                <p className="mt-1 text-xl leading-tight font-extrabold tabular-nums">
                  {fmtKg(weightSummary.startKg ?? 0)}
                  <span className="ml-1 text-xs font-semibold text-muted-foreground">kg</span>
                </p>
              </div>
              <div className="rounded-2xl bg-card p-3.5">
                <p className="text-[0.8125rem] font-semibold text-muted-foreground">Turun</p>
                <p
                  className={cn(
                    "mt-1 text-xl leading-tight font-extrabold tabular-nums",
                    (weightSummary.deltaKg ?? 0) < 0 && "text-makan-ink",
                    (weightSummary.deltaKg ?? 0) > 0 && "text-bakar-ink",
                  )}
                >
                  {weightSummary.deltaKg !== null ? fmtKg(Math.abs(weightSummary.deltaKg)) : "–"}
                  <span className="ml-1 text-xs font-semibold text-muted-foreground">kg</span>
                </p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {weightSummary.deltaKg === null
                    ? "belum ada data"
                    : weightSummary.deltaKg < 0
                      ? "dari berat awal"
                      : weightSummary.deltaKg > 0
                        ? "naik dari awal"
                        : "masih sama"}
                </p>
              </div>
              <div className="rounded-2xl bg-card p-3.5">
                <p className="text-[0.8125rem] font-semibold text-muted-foreground">Sisa</p>
                <p className="mt-1 text-xl leading-tight font-extrabold tabular-nums">
                  {weightSummary.remainingKg !== null ? fmtKg(weightSummary.remainingKg) : "–"}
                  <span className="ml-1 text-xs font-semibold text-muted-foreground">kg</span>
                </p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {weightSummary.targetKg !== null
                    ? `Target ${fmtKg(weightSummary.targetKg)} kg`
                    : "atur target di Profil"}
                </p>
              </div>
            </div>

            <section aria-label="Riwayat timbangan">
              <SectionTitle>Riwayat</SectionTitle>
              <ListGroup>
                {visibleHistory.map((entry) => {
                  const index = newestFirst.indexOf(entry);
                  const prev = newestFirst[index + 1];
                  const delta = prev ? entry.weightKg - prev.weightKg : null;
                  return (
                    <ListRow
                      key={entry.id}
                      title={entry.date === today ? "Hari ini" : shortDate(entry.date)}
                      subtitle={
                        delta === null
                          ? "catatan pertama"
                          : delta !== 0
                            ? `${delta < 0 ? "−" : "+"}${fmtKg(Math.abs(delta))} kg dari sebelumnya`
                            : "sama seperti sebelumnya"
                      }
                      value={`${fmtKg(entry.weightKg)} kg`}
                    />
                  );
                })}
              </ListGroup>
              {entries.length > 10 && (
                <button
                  type="button"
                  onClick={() => setShowAll((v) => !v)}
                  className="pressable mt-2 min-h-11 w-full rounded-3xl bg-card text-sm font-semibold text-primary focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
                >
                  {showAll ? "Tampilkan lebih sedikit" : `Tampilkan semua (${entries.length})`}
                </button>
              )}
            </section>
          </div>
        </div>
      )}

      <Sheet
        open={weighOpen}
        onOpenChange={setWeighOpen}
        title="Timbang hari ini"
        description="Satu catatan per hari. Menyimpan lagi menimpa angka tadi."
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submitWeigh();
          }}
          className="space-y-4"
        >
          <div className="relative">
            <Input
              aria-label="Berat badan (kg)"
              autoFocus
              type="number"
              step="0.1"
              min="25"
              max="400"
              inputMode="decimal"
              value={weighValue}
              onChange={(event) => setWeighValue(event.target.value)}
              className="h-16 pr-14 text-center text-3xl font-extrabold"
            />
            <span className="pointer-events-none absolute top-1/2 right-5 -translate-y-1/2 text-base font-semibold text-muted-foreground">
              kg
            </span>
          </div>
          <Button type="submit" className="w-full" disabled={checkIn.isPending}>
            {checkIn.isPending ? "Menyimpan..." : "Simpan"}
          </Button>
        </form>
      </Sheet>
    </Page>
  );
}

function BeratSkeleton() {
  return (
    <Page className="max-w-xl lg:max-w-5xl" aria-busy="true" aria-label="Memuat riwayat berat">
      <div className="flex items-center justify-between gap-3 px-1 pt-2 pb-5">
        <Skeleton className="h-9 w-44 rounded-full" />
        <Skeleton className="h-12 w-28 rounded-full" />
      </div>
      <Skeleton className="h-40 rounded-3xl" />
      <Skeleton className="mt-3 h-72 rounded-3xl" />
      <div className="mt-3 grid grid-cols-3 gap-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-24 rounded-2xl" />
        ))}
      </div>
      <Skeleton className="mt-7 h-80 rounded-3xl" />
    </Page>
  );
}
