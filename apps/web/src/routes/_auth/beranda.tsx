import { Button } from "@joyorogo/ui/components/button";
import { Input } from "@joyorogo/ui/components/input";
import { Sheet } from "@joyorogo/ui/components/sheet";
import { Skeleton } from "@joyorogo/ui/components/skeleton";
import { cn } from "@joyorogo/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, Navigate, useNavigate } from "@tanstack/react-router";
import { ChevronDown, Flame, Info, Mic, Moon, Plus, Sparkles, Trophy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { MACRO_META } from "@/lib/macro-icons";
import { Ring } from "@/components/kit/ring";
import { Card, Page, SectionTitle, StatTile } from "@/components/kit/surface";
import { MetaLine } from "@/components/meta-line";
import { Avatar } from "@/components/avatar";
import { DailyTipCard } from "@/components/tips/daily-tip-card";
import { FastingScheduleCard } from "@/components/fasting/schedule-card";
import MovementCard from "@/components/movement-card";
import { BelanjaCard } from "@/components/plate/belanja";
import { ScreenError } from "@/components/screen-state";
import { RecapCard } from "@/components/recap-card";
import { ShareStoryButton } from "@/components/story/share-story-button";
import { Sticker } from "@/components/sticker";
import { WaterCard } from "@/components/water-card";
import { WorkoutCard } from "@/components/workout/workout-card";
import { pickFact } from "@/lib/facts";
import { fmtDateIndo, fmtInt, fmtKg, fmtRatio, parseNum } from "@/lib/format";
import { useWaistCheckIn, useWeightCheckIn } from "@/lib/optimistic";
import { useAppConfig } from "@/lib/app-config";
import type { DaySummary } from "@/lib/api-types";
import { jakartaToday, relativeDayLabel } from "@joyorogo/api/lib/engine";
import { orpc } from "@/utils/orpc";

import { DaySwitcher } from "@/components/day-switcher";

const summaryOptions = (date: string) => orpc.day.summary.queryOptions({ input: { date } });
const profileOptions = orpc.profile.myProfile.queryOptions();

export const Route = createFileRoute("/_auth/beranda")({
  validateSearch: (search: Record<string, unknown>): { date?: string } => {
    const raw = typeof search.date === "string" ? search.date : undefined;
    return { date: raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : undefined };
  },
  loaderDeps: ({ search }) => ({ date: search.date }),
  loader: ({ context, deps }) =>
    context.queryClient.ensureQueryData(summaryOptions(deps.date ?? jakartaToday())),
  pendingComponent: BerandaSkeleton,
  component: BerandaPage,
});

type Summary = DaySummary;

function BerandaPage() {
  const { date: paramDate } = Route.useSearch();
  const navigate = Route.useNavigate();
  const date = paramDate ?? jakartaToday();
  const summary = useQuery(summaryOptions(date));
  if (summary.isPending) return <BerandaSkeleton />;
  if (summary.error) {
    return <ScreenError message={summary.error.message} onRetry={() => summary.refetch()} />;
  }
  if (summary.data.targets === null) {
    return <Navigate to="/onboarding" replace />;
  }
  return (
    <Dashboard
      summary={summary.data}
      date={date}
      onChange={(target) =>
        navigate({ search: { date: target === jakartaToday() ? undefined : target } })
      }
    />
  );
}

/** Always-visible nudge for free users while billing is on. Not dismissible:
 * the whole point is that free scans run out every day. */
function FounderBanner() {
  const navigate = useNavigate();
  const config = useAppConfig();
  const profile = useQuery(profileOptions);
  if (config.data?.billing !== true || profile.data?.tier !== "free") return null;
  const cap = config.data.founderDailyCap;
  return (
    <div className="mb-3 flex items-center justify-between gap-3 rounded-2xl bg-makan-soft px-4 py-2.5">
      <p className="min-w-0 text-[0.8125rem] font-semibold text-makan-ink tabular-nums">
        Scan AI {config.data.freeDailyScans}x/hari
        <span aria-hidden className="mx-1 text-muted-foreground">
          ·
        </span>
        <span className="font-normal">Founder {cap === null ? "tanpa batas" : `${cap}/hari`}</span>
      </p>
      <Button
        size="sm"
        className="shrink-0"
        onClick={() => navigate({ to: "/founder", search: { from: "banner", next: "/beranda" } })}
      >
        Upgrade
      </Button>
    </div>
  );
}

function greeting(): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      hour: "numeric",
      hour12: false,
      timeZone: "Asia/Jakarta",
    }).format(new Date()),
  );
  if (hour < 11) return "Selamat pagi";
  if (hour < 15) return "Selamat siang";
  if (hour < 18) return "Selamat sore";
  return "Selamat malam";
}

const SLOT_LABEL: Record<string, string> = {
  sarapan: "Sarapan",
  makan_siang: "Makan siang",
  makan_malam: "Makan malam",
  snack: "Camilan",
  sahur: "Sahur",
  berbuka: "Berbuka",
};
const DEFAULT_SLOTS = ["sarapan", "makan_siang", "makan_malam", "snack"];

function Dashboard({
  summary,
  date,
  onChange,
}: {
  summary: Summary;
  date: string;
  onChange: (date: string) => void;
}) {
  const { session } = Route.useRouteContext();
  const targets = summary.targets;
  const firstName = session.user.name?.split(" ")[0];
  const isToday = date === jakartaToday();

  const foods = useQuery(orpc.food.listByDate.queryOptions({ input: { date: summary.date } }));
  const stickers = (foods.data?.items ?? []).filter(
    (item): item is typeof item & { scanId: string } => item.scanId !== null,
  );

  return (
    <Page className="max-w-xl lg:max-w-5xl">
      <header className="flex items-center justify-between gap-4 px-1 pt-2 pb-5">
        <div className="min-w-0">
          <p className="text-sm font-medium text-muted-foreground">
            {greeting()}
            {firstName ? `, ${firstName}` : ""}
          </p>
          <h1 className="mt-0.5 text-[1.75rem] leading-tight font-extrabold tracking-tight">
            {fmtDateIndo(summary.date).replace(/^\w+, /, "")}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {summary.streakDays > 0 && (
            <span
              className="inline-flex h-10 items-center gap-1.5 rounded-full bg-bakar-soft px-3 text-sm font-bold text-bakar-ink tabular-nums"
              title="Hari berturut-turut kamu mencatat"
            >
              <Flame className="size-4" aria-hidden />
              {summary.streakDays}
              <span className="sr-only"> hari beruntun</span>
            </span>
          )}
          <Link
            to="/profil"
            aria-label="Profil"
            className="rounded-full focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none md:hidden"
          >
            <Avatar
              name={firstName ?? session.user.email ?? "?"}
              image={session.user.image ?? null}
            />
          </Link>
        </div>
      </header>

      <FounderBanner />

      {/* Day switcher */}
      <div className="mb-3 flex justify-center lg:justify-start">
        <DaySwitcher date={date} onChange={onChange} />
      </div>

      {isToday ? (
        <div className="mb-3 empty:hidden">
          <RecapCard />
        </div>
      ) : null}

      {/* minmax(0, …) tracks: the scrollable ideas row inside EatHero must
          scroll, not widen its column past the phone screen. Rows are pinned
          per column on lg so Lingkar perut fills the empty slot next to the
          Berat badan cards; on phones the DOM order keeps Berat first. */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-5">
        <div className="min-w-0 space-y-3 lg:col-start-1 lg:row-start-1">
          <EatHero summary={summary} />
          <div className="grid grid-cols-3 gap-3">
            <StatTile
              metric="bakar"
              to="/olahraga"
              icon={<Flame className="size-[1.125rem]" aria-hidden />}
              label="Bakar"
              value={fmtInt(summary.burnedKcal)}
              sub={`dari ${fmtInt(targets.burnKcal)} kcal`}
            />
            <StatTile
              metric="tidur"
              to="/tidur"
              icon={<Moon className="size-[1.125rem]" aria-hidden />}
              label="Tidur"
              value={
                summary.sleepHoursLastNight === null ? "–" : fmtKg(summary.sleepHoursLastNight)
              }
              unit={summary.sleepHoursLastNight === null ? undefined : "jam"}
              sub={
                summary.sleepHoursLastNight === null
                  ? "belum dicatat"
                  : `butuh ${fmtInt(targets.sleepHours)} jam`
              }
            />
            <StatTile
              metric="makan"
              to="/makan"
              icon={<MACRO_META.protein.Icon className="size-[1.125rem]" aria-hidden />}
              label="Protein"
              value={fmtInt(summary.protein?.eatenG ?? 0)}
              unit="g"
              sub={`dari ${fmtInt(summary.protein?.targetG ?? 0)} g`}
            />
          </div>
        </div>

        <div className="min-w-0 space-y-3 lg:col-start-2 lg:row-start-1">
          <TodayMeals summary={summary} isToday={isToday} />
          {isToday ? <FastingScheduleCard /> : null}
        </div>

        <div className="min-w-0 space-y-3 lg:col-start-2 lg:row-start-2 lg:space-y-5">
          <WeightCard summary={summary} date={date} isToday={isToday} />
          <WorkoutCard />
        </div>

        <div className="min-w-0 lg:col-start-1 lg:row-start-2">
          <WaistCard date={date} isToday={isToday} />
        </div>
      </div>

      {stickers.length > 0 && (
        <section aria-label="Diari piring" className="mt-7">
          <SectionTitle>Diari piring</SectionTitle>
          <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1 no-scrollbar">
            {stickers.map((item) => (
              <figure key={item.id} className="w-28 shrink-0 rounded-2xl bg-card p-3 text-center">
                <Sticker
                  scanId={item.scanId}
                  photoId={item.photoId}
                  name={item.name}
                  kcal={item.kcal}
                  className="mx-auto block size-20"
                />
                <figcaption className="mt-2 truncate text-xs font-semibold">{item.name}</figcaption>
                <p className="text-xs text-muted-foreground tabular-nums">
                  {fmtInt(item.kcal)} kcal
                </p>
              </figure>
            ))}
          </div>
        </section>
      )}

      {isToday ? <DailyTipCard /> : null}

      <MoreSection summary={summary} date={date} isToday={isToday} />
    </Page>
  );
}

function EatHero({ summary }: { summary: Summary }) {
  const targets = summary.targets;
  const remaining = targets.eatKcal - summary.eatenKcal;
  const over = remaining < 0;
  const [adaptiveOpen, setAdaptiveOpen] = useState(false);
  const deficit = summary.deficit;

  return (
    <Card className="p-6">
      <div className="flex flex-col items-center">
        <Ring
          metric="makan"
          value={summary.eatenKcal}
          max={targets.eatKcal}
          size={216}
          stroke={16}
          label={`Dimakan ${fmtInt(summary.eatenKcal)} dari ${fmtInt(targets.eatKcal)} kcal`}
        >
          <div>
            <p className="text-sm font-semibold text-muted-foreground">
              {over ? "Kelebihan" : "Masih boleh"}
            </p>
            <p
              className={cn(
                "text-[3.5rem] leading-none font-extrabold tracking-tighter tabular-nums",
                over && "text-bakar-ink",
              )}
            >
              {fmtInt(Math.abs(remaining))}
            </p>
            <p className="mt-1 text-sm font-semibold text-muted-foreground">kcal</p>
          </div>
        </Ring>

        <dl className="mt-5 grid w-full grid-cols-3 divide-x divide-border text-center">
          <div>
            <dt className="text-xs font-semibold text-muted-foreground">Target</dt>
            <dd className="mt-0.5 text-lg font-extrabold tabular-nums">
              {fmtInt(targets.eatKcal)}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-muted-foreground">Dimakan</dt>
            <dd className="mt-0.5 text-lg font-extrabold tabular-nums">
              {fmtInt(summary.eatenKcal)}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-muted-foreground">Defisit</dt>
            <dd
              className={cn(
                "mt-0.5 text-lg font-extrabold tabular-nums",
                deficit && deficit.deficitKcal >= 0 && "text-makan-ink",
              )}
            >
              {deficit ? fmtInt(deficit.deficitKcal) : "–"}
            </dd>
          </div>
        </dl>
      </div>

      {summary.ideas.length > 0 && (
        <div className="mt-6 border-t pt-5">
          <p className="flex items-center gap-1.5 text-sm font-bold">
            <Sparkles className="size-4 text-makan" aria-hidden />
            Masih muat
          </p>
          <ul className="-mx-6 mt-3 flex gap-2 overflow-x-auto px-6 no-scrollbar">
            {summary.ideas.map((idea) => (
              <li key={idea.name} className="w-44 shrink-0 rounded-2xl bg-makan-soft px-3.5 py-3">
                <p className="line-clamp-2 text-sm leading-snug font-semibold">{idea.name}</p>
                <p className="mt-1.5 text-xs font-semibold text-makan-ink tabular-nums">
                  <MetaLine
                    items={[`${fmtInt(idea.kcal)} kcal`, `${fmtInt(idea.proteinG)} g protein`]}
                  />
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {targets.notes.includes("ADAPTIVE") && (
        <>
          <button
            type="button"
            onClick={() => setAdaptiveOpen(true)}
            className="mt-4 inline-flex min-h-11 items-center gap-1.5 rounded-full text-xs font-semibold text-muted-foreground hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
          >
            <Info className="size-3.5" aria-hidden />
            Target menyesuaikan datamu
          </button>
          <Sheet open={adaptiveOpen} onOpenChange={setAdaptiveOpen} title="Target adaptif">
            <div className="space-y-3 text-[0.9375rem] leading-relaxed">
              <p>
                Rumus standar memperkirakan tubuhmu membakar{" "}
                <strong className="tabular-nums">{fmtInt(targets.formulaTdee)} kcal</strong> sehari.
              </p>
              <p>
                Dari catatan makan dan timbanganmu 4 minggu terakhir, pembakaran nyatamu sekitar{" "}
                <strong className="tabular-nums">{fmtInt(targets.tdee)} kcal</strong>. Target makan
                memakai angka ini supaya pas dengan tubuhmu, bukan rata-rata orang.
              </p>
              <p className="text-sm text-muted-foreground">
                Penyesuaian dibatasi 15% dari rumus, dan hari yang lupa dicatat tidak ikut dihitung.
              </p>
            </div>
          </Sheet>
        </>
      )}
    </Card>
  );
}

function TodayMeals({ summary, isToday }: { summary: Summary; isToday: boolean }) {
  const slots = [
    ...DEFAULT_SLOTS,
    ...Object.keys(summary.eatenByMeal).filter(
      (slot) =>
        !DEFAULT_SLOTS.includes(slot) &&
        summary.eatenByMeal[slot as keyof typeof summary.eatenByMeal] > 0,
    ),
  ];
  return (
    <section aria-label="Makan hari ini">
      <SectionTitle
        action={
          <span className="flex items-center gap-3">
            <Link
              to="/makan"
              search={{ cerita: true }}
              className="inline-flex min-h-11 items-center gap-1 px-1 text-sm font-semibold text-primary hover:underline"
            >
              <Mic className="size-4" aria-hidden />
              Ceritakan
            </Link>
            <Link
              to="/makan"
              className="inline-flex min-h-11 items-center px-1 text-sm font-semibold text-muted-foreground hover:underline"
            >
              Lihat semua
            </Link>
          </span>
        }
      >
        {isToday ? "Makan hari ini" : `Makan ${relativeDayLabel(summary.date, jakartaToday())}`}
      </SectionTitle>
      <ul className="overflow-hidden rounded-3xl bg-card">
        {slots.map((slot, index) => {
          const kcal = summary.eatenByMeal[slot as keyof typeof summary.eatenByMeal] ?? 0;
          return (
            <li key={slot} className={cn("relative", index > 0 && "border-t border-border/70")}>
              <Link
                to="/makan"
                className="flex min-h-14 items-center gap-3 px-5 py-3 transition-colors hover:bg-muted/60 active:bg-muted focus-visible:bg-muted focus-visible:outline-none"
              >
                <span className="flex-1 text-[0.9375rem] font-semibold">
                  {SLOT_LABEL[slot] ?? slot}
                </span>
                {kcal > 0 ? (
                  <span className="text-[0.9375rem] font-bold tabular-nums">
                    {fmtInt(kcal)}{" "}
                    <span className="text-xs font-semibold text-muted-foreground">kcal</span>
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-sm font-semibold text-primary">
                    <Plus className="size-4" aria-hidden />
                    Catat
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Sparkline({ values, tone = "makan" }: { values: number[]; tone?: "makan" | "primary" }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(0.5, max - min);
  const w = 300;
  const h = 64;
  const path = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = 6 + ((max - v) / span) * (h - 12);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-16 w-full" aria-hidden>
      <path
        d={`${path} L${w},${h} L0,${h} Z`}
        className={tone === "makan" ? "fill-makan-soft" : "fill-primary/10"}
      />
      <path
        d={path}
        fill="none"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        className={tone === "makan" ? "stroke-makan" : "stroke-primary"}
      />
    </svg>
  );
}

function WeightCard({
  summary,
  date,
  isToday,
}: {
  summary: Summary;
  date: string;
  isToday: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const trend = summary.trend;
  const checkIn = useWeightCheckIn();
  const rate = trend?.weeklyRateKg ?? null;
  const flat = rate !== null && Math.abs(rate) <= 0.05;

  return (
    <section aria-label="Berat badan">
      <SectionTitle
        action={
          <Link
            to="/berat"
            className="inline-flex min-h-11 items-center px-1 text-sm font-semibold text-primary hover:underline"
          >
            Grafik
          </Link>
        }
      >
        Berat badan
      </SectionTitle>
      <Card>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold text-muted-foreground">Berat tren</p>
            <p className="text-[2rem] leading-tight font-extrabold tracking-tight tabular-nums">
              {trend
                ? fmtKg(trend.weightKg)
                : summary.latestWeightKg !== null
                  ? fmtKg(summary.latestWeightKg)
                  : "–"}
              <span className="ml-1 text-base font-semibold text-muted-foreground">kg</span>
            </p>
            {rate !== null && (
              <p
                className={cn(
                  "mt-0.5 text-sm font-semibold",
                  !flat && rate < 0 ? "text-makan-ink" : "text-muted-foreground",
                )}
              >
                {flat
                  ? "Stabil minggu ini"
                  : `${rate < 0 ? "Turun" : "Naik"} ${fmtKg(Math.abs(rate))} kg/minggu`}
              </p>
            )}
          </div>
          <Button
            variant={isToday && summary.weightLoggedToday ? "secondary" : "default"}
            size="sm"
            onClick={() => {
              setValue(summary.latestWeightKg !== null ? String(summary.latestWeightKg) : "");
              setOpen(true);
            }}
          >
            {isToday && summary.weightLoggedToday ? "Ubah" : "Timbang"}
          </Button>
        </div>
        {trend && (
          <>
            <div className="mt-4">
              <Sparkline values={trend.points.map((p) => p.trendKg)} />
            </div>
            {trend.projectedDate && (
              <p className="mt-3 text-sm text-muted-foreground">
                Dengan ritme ini, target tercapai sekitar{" "}
                <strong className="font-semibold text-foreground">
                  {fmtDateIndo(trend.projectedDate).replace(/^\w+, /, "")}
                </strong>
                .
              </p>
            )}
          </>
        )}
      </Card>

      <Sheet
        open={open}
        onOpenChange={setOpen}
        title={isToday ? "Timbang hari ini" : `Timbang ${relativeDayLabel(date, jakartaToday())}`}
        description="Satu catatan per hari. Menyimpan lagi menimpa angka tadi."
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const kg = parseNum(value);
            if (kg === null || kg < 25 || kg > 400) {
              toast.error("Isi berat antara 25 dan 400 kg.");
              return;
            }
            checkIn.mutate({ weightKg: kg, ...(isToday ? {} : { date }) });
            setOpen(false);
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
              value={value}
              onChange={(event) => setValue(event.target.value)}
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
    </section>
  );
}

const waistHistoryOptions = orpc.waist.history.queryOptions({ input: { limit: 30 } });

/** Compact Lingkar perut summary mirroring the Berat card; full section lives on /berat. */
function WaistCard({ date, isToday }: { date: string; isToday: boolean }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const history = useQuery(waistHistoryOptions);
  const checkIn = useWaistCheckIn((row) => `Tercatat ${fmtKg(row.waistCm)} cm`);

  const entries = history.data?.entries ?? [];
  const latest = entries.length > 0 ? entries[entries.length - 1].waistCm : null;
  const loggedToday = history.data?.loggedToday ?? false;
  const assessment = history.data?.assessment ?? null;

  const status =
    assessment === null
      ? null
      : assessment.band === "high"
        ? {
            text:
              assessment.ratio !== null
                ? `Rasio ${fmtRatio(assessment.ratio)} · risiko tinggi`
                : "Di atas batas sehat",
            tone: "text-destructive",
          }
        : assessment.band === "raised" || assessment.overCutoff
          ? {
              text:
                assessment.ratio !== null
                  ? `Rasio ${fmtRatio(assessment.ratio)} · di atas batas`
                  : "Di atas batas sehat",
              tone: "text-amber-600 dark:text-amber-400",
            }
          : {
              text:
                assessment.ratio !== null
                  ? `Rasio ${fmtRatio(assessment.ratio)} · di bawah batas sehat`
                  : "Di bawah batas sehat",
              tone: "text-makan-ink",
            };

  return (
    <section aria-label="Lingkar perut">
      <SectionTitle
        action={
          <Link
            to="/berat"
            className="inline-flex min-h-11 items-center px-1 text-sm font-semibold text-primary hover:underline"
          >
            Detail
          </Link>
        }
      >
        Lingkar perut
      </SectionTitle>
      <Card>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold text-muted-foreground">Lingkar perut terbaru</p>
            <p className="text-[2rem] leading-tight font-extrabold tracking-tight tabular-nums">
              {latest !== null ? fmtKg(latest) : "–"}
              <span className="ml-1 text-base font-semibold text-muted-foreground">cm</span>
            </p>
            {status !== null ? (
              <p className={cn("mt-0.5 text-sm font-semibold", status.tone)}>{status.text}</p>
            ) : (
              <p className="mt-0.5 text-sm text-muted-foreground">
                {latest !== null
                  ? "Lengkapi tinggi di profil untuk status risiko"
                  : "Belum ada catatan"}
              </p>
            )}
          </div>
          <Button
            variant={isToday && loggedToday ? "secondary" : "default"}
            size="sm"
            onClick={() => {
              setValue(latest !== null ? String(latest) : "");
              setOpen(true);
            }}
          >
            {isToday && loggedToday ? "Ubah" : "Ukur"}
          </Button>
        </div>
        <div className="mt-4">
          <Sparkline values={entries.slice(-30).map((entry) => entry.waistCm)} tone="primary" />
        </div>
      </Card>

      <Sheet
        open={open}
        onOpenChange={setOpen}
        title="Ukur lingkar perut"
        description="Satu catatan per hari. Menyimpan lagi menimpa angka tadi."
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const cm = parseNum(value);
            if (cm === null || cm < 40 || cm > 250) {
              toast.error("Isi lingkar perut antara 40 dan 250 cm.");
              return;
            }
            checkIn.mutate({ waistCm: cm, ...(isToday ? {} : { date }) });
            setOpen(false);
          }}
          className="space-y-4"
        >
          <div className="relative">
            <Input
              aria-label="Lingkar perut (cm)"
              autoFocus
              type="number"
              step="0.5"
              min="40"
              max="250"
              inputMode="decimal"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              className="h-16 pr-14 text-center text-3xl font-extrabold"
            />
            <span className="pointer-events-none absolute top-1/2 right-5 -translate-y-1/2 text-base font-semibold text-muted-foreground">
              cm
            </span>
          </div>
          <Button type="submit" className="w-full" disabled={checkIn.isPending}>
            {checkIn.isPending ? "Menyimpan..." : "Simpan"}
          </Button>
        </form>
      </Sheet>
    </section>
  );
}

function MoreSection({
  summary,
  date,
  isToday,
}: {
  summary: Summary;
  date: string;
  isToday: boolean;
}) {
  const fact = pickFact(summary.date);
  return (
    <details className="group mt-7 rounded-3xl bg-card">
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between rounded-3xl px-5 select-none focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none [&::-webkit-details-marker]:hidden">
        <span className="text-[0.9375rem] font-bold">Air minum, gerak, dan lainnya</span>
        <ChevronDown
          className="size-5 text-muted-foreground transition-transform duration-200 group-open:rotate-180"
          aria-hidden
        />
      </summary>
      <div className="space-y-5 px-5 pb-5">
        {isToday ? <BelanjaCard variant="line" /> : null}
        <WaterCard date={date} />
        <MovementCard date={date} />
        {fact && (
          <div className="rounded-2xl bg-muted p-4">
            <p className="text-xs font-semibold text-muted-foreground">Fakta kalori hari ini</p>
            <p className="mt-1 text-sm font-semibold">
              {fact.text} = {fmtInt(fact.kcal)} kcal, setara {fact.move}
            </p>
          </div>
        )}
        {summary.milestones.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {summary.milestones.map((badge) => (
              <span
                key={badge}
                className="inline-flex h-9 items-center gap-1.5 rounded-full bg-makan-soft px-3 text-xs font-bold text-makan-ink"
              >
                <Trophy className="size-3.5" aria-hidden />
                {badge}
              </span>
            ))}
          </div>
        )}
        <div className="flex items-center justify-between gap-3 rounded-2xl bg-muted p-4">
          <div>
            <p className="text-sm font-bold">Bagikan progres</p>
            <p className="text-xs text-muted-foreground">Kartu siap posting dari angka hari ini.</p>
          </div>
          <ShareStoryButton
            size="sm"
            story={{
              kind: "progress",
              eatenKcal: summary.eatenKcal,
              targetKcal: summary.targets.eatKcal,
              proteinG: summary.protein.eatenG,
              proteinTargetG: summary.protein.targetG,
              streakDays: summary.streakDays,
              weightLostKg: summary.weightLostKg,
              weekTrend: summary.weekTrend,
            }}
          />
        </div>
      </div>
    </details>
  );
}

function BerandaSkeleton() {
  return (
    <Page className="max-w-xl" aria-busy="true" aria-label="Memuat ringkasan hari ini">
      <div className="px-1 pt-2 pb-5">
        <Skeleton className="h-4 w-32 rounded-full" />
        <Skeleton className="mt-2 h-8 w-48 rounded-full" />
      </div>
      <div className="flex flex-col items-center rounded-3xl bg-card p-6">
        <Skeleton className="size-[216px] rounded-full" />
        <Skeleton className="mt-5 h-10 w-full rounded-2xl" />
      </div>
      <div className="mt-3 grid grid-cols-3 gap-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-32 rounded-2xl" />
        ))}
      </div>
      <Skeleton className="mt-7 h-56 rounded-3xl" />
    </Page>
  );
}
