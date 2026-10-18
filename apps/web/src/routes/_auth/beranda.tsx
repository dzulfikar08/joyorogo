import { Button } from "@joyorogo/ui/components/button";
import { Input } from "@joyorogo/ui/components/input";
import { Sheet } from "@joyorogo/ui/components/sheet";
import { Skeleton } from "@joyorogo/ui/components/skeleton";
import { cn } from "@joyorogo/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, Navigate, useNavigate } from "@tanstack/react-router";
import {
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Flame,
  Info,
  Mic,
  Moon,
  Plus,
  Scale,
  Sparkles,
  Trophy,
} from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { toast } from "sonner";

import { MACRO_META } from "@/lib/macro-icons";
import { CountUp } from "@/components/kit/count-up";
import { Ring } from "@/components/kit/ring";
import { Card, Page, SectionTitle } from "@/components/kit/surface";
import { MetaLine } from "@/components/meta-line";
import { Avatar } from "@/components/avatar";
import { DailyTipCard } from "@/components/tips/daily-tip-card";
import { FastingScheduleCard } from "@/components/fasting/schedule-card";
import MovementCard from "@/components/movement-card";
import { BelanjaCard } from "@/components/plate/belanja";
import { ScreenError } from "@/components/screen-state";
import { RecapCard } from "@/components/recap-card";
import { StravaRetentionNotice } from "@/components/strava-retention-notice";
import { AddBackNotice } from "@/components/add-back-notice";
import { ShareStoryButton } from "@/components/story/share-story-button";
import type { StorySpec } from "@/components/story/story-spec";
import { Sticker } from "@/components/sticker";
import { MaternalCard } from "@/components/maternal/maternal-card";
import { MaternalEatHero } from "@/components/maternal/eat-hero";
import { TargetPaceNotice } from "@/components/target-pace-notice";
import {
  GainDailyTip,
  GainIntakeNote,
  GainPlanCard,
  useGainIntake,
} from "@/components/gain/gain-today";
import { WaterCard, WaterTile } from "@/components/water-card";
import { JoyoFitCard } from "@/components/workout/joyofit-card";
import { pickFact } from "@/lib/facts";
import { fmtDateLong, fmtInt, fmtKg, fmtRatio, parseNum } from "@/lib/format";
import { useFirstVisit } from "@/lib/motion";
import { useWaistCheckIn, useWeightCheckIn } from "@/lib/optimistic";
import { useAppConfig } from "@/lib/app-config";
import type { DaySummary } from "@/lib/api-types";
import { DEFAULT_ADD_BACK_SETTINGS } from "@joyorogo/api/lib/exercise-credit";
import { datePaceExplainKey, jakartaToday, relativeDayLabel, remainingKcal } from "@joyorogo/api/lib/engine";
import type { Meal } from "@joyorogo/api/lib/engine";
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
  const { t } = useTranslation("home");
  const navigate = useNavigate();
  const config = useAppConfig();
  const profile = useQuery(profileOptions);
  if (config.data?.billing !== true || profile.data?.tier !== "free") return null;
  const cap = config.data.founderDailyCap;
  return (
    <div className="mb-3 flex items-center justify-between gap-3 rounded-2xl bg-makan-soft px-4 py-2">
      <p className="min-w-0 text-[0.8125rem] font-semibold text-makan-ink tabular-nums">
        {t("banner.scans", { n: config.data.freeDailyScans })}
        <span aria-hidden className="mx-1 text-muted-foreground">
          ·
        </span>
        <span className="font-normal">
          {cap === null ? t("banner.proUnlimited") : t("banner.proCapped", { n: cap })}
        </span>
      </p>
      <Button
        size="sm"
        className="shrink-0"
        onClick={() => navigate({ to: "/pro", search: { from: "banner", next: "/beranda" } })}
      >
        {t("banner.upgrade")}
      </Button>
    </div>
  );
}

function greetingKey(): "morning" | "noon" | "afternoon" | "evening" {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      hour: "numeric",
      hour12: false,
      timeZone: "Asia/Jakarta",
    }).format(new Date()),
  );
  if (hour < 11) return "morning";
  if (hour < 15) return "noon";
  if (hour < 18) return "afternoon";
  return "evening";
}

const DEFAULT_SLOTS: Meal[] = ["sarapan", "makan_siang", "makan_malam", "snack"];

const TILE_TINT = {
  makan: "bg-makan-soft text-makan-ink",
  bakar: "bg-bakar-soft text-bakar-ink",
  tidur: "bg-tidur-soft text-tidur-ink",
} as const;

/** Dense glance tile: icon + label on one line, value, one-line context. */
function GlanceTile({
  tint,
  to,
  icon,
  label,
  value,
  unit,
  sub,
}: {
  tint: keyof typeof TILE_TINT;
  to: "/olahraga" | "/tidur" | "/makan" | "/berat";
  icon: ReactNode;
  label: string;
  value: ReactNode;
  unit?: string;
  sub?: ReactNode;
}) {
  return (
    <Link
      to={to}
      className={cn(
        "pressable block min-w-0 rounded-2xl p-3 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none",
        TILE_TINT[tint],
      )}
    >
      <span className="flex items-center gap-1.5 text-[0.8125rem] font-semibold">
        {icon}
        <span className="truncate">{label}</span>
      </span>
      <span className="mt-1 block text-xl leading-tight font-extrabold tracking-tight text-foreground tabular-nums">
        {value}
        {unit && <span className="ml-1 text-xs font-semibold text-muted-foreground">{unit}</span>}
      </span>
      {sub && (
        <span className="block truncate text-[0.6875rem] text-muted-foreground tabular-nums">
          {sub}
        </span>
      )}
    </Link>
  );
}

function Dashboard({
  summary,
  date,
  onChange,
}: {
  summary: Summary;
  date: string;
  onChange: (date: string) => void;
}) {
  const { t } = useTranslation(["home", "berat", "gain"]);
  const { session } = Route.useRouteContext();
  const targets = summary.targets;
  const maternal = targets.maternal;
  const gain = targets.gain ?? null;
  const progressStory: StorySpec = {
    kind: "progress",
    eatenKcal: summary.eatenKcal,
    targetKcal: summary.targets.eatKcal,
    proteinG: summary.protein.eatenG,
    proteinTargetG: summary.protein.targetG,
    streakDays: summary.streakDays,
    weightLostKg: summary.weightLostKg,
    gain: gain !== null,
    weightGainedKg: summary.weightGainedKg,
    weekTrend: summary.weekTrend,
    carbsG: summary.carbsEatenG,
    fatG: summary.fatEatenG,
    weightGoalProgress: summary.weightGoalProgress,
    weight:
      summary.weightStartKg != null && summary.weightNowKg != null
        ? {
            startKg: summary.weightStartKg,
            nowKg: summary.weightNowKg,
            goalKg: summary.weightGoalKg,
          }
        : null,
  };
  const firstName = session.user.name?.split(" ")[0];
  const isToday = date === jakartaToday();
  const firstVisit = useFirstVisit("beranda");

  const foods = useQuery(orpc.food.listByDate.queryOptions({ input: { date: summary.date } }));
  const stickers = (foods.data?.items ?? []).filter(
    (item): item is typeof item & { scanId: string } => item.scanId !== null,
  );

  const trend = summary.trend;
  const weightKg = trend?.weightKg ?? summary.latestWeightKg;
  const rate = trend?.weeklyRateKg ?? null;
  const weightSub =
    rate === null
      ? t("tile.weightNone")
      : Math.abs(rate) <= 0.05
        ? t("berat:trend.stable")
        : t(rate < 0 ? "berat:trend.down" : "berat:trend.up", { kg: fmtKg(Math.abs(rate)) });

  return (
    <Page className="max-w-xl lg:max-w-5xl">
      <header className="flex items-center justify-between gap-3 px-1 pt-1 pb-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-muted-foreground">
            {firstName
              ? t("greeting.named", { greeting: t(`greeting.${greetingKey()}`), name: firstName })
              : t(`greeting.${greetingKey()}`)}
          </p>
          <h1 className="mt-0.5 text-xl leading-tight font-extrabold tracking-tight min-[420px]:text-2xl">
            {fmtDateLong(summary.date).replace(/^\w+, /, "")}
          </h1>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {!maternal && (
            <ShareStoryButton
              label=""
              ariaLabel={t("header.share")}
              variant="secondary"
              size="icon"
              story={progressStory}
            />
          )}
          {summary.streakDays > 0 && (
            <ShareStoryButton
              story={progressStory}
              initialKind="streak"
              renderTrigger={(open) => (
                <button
                  type="button"
                  onClick={open}
                  className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full bg-bakar-soft px-3 text-sm font-bold text-bakar-ink tabular-nums outline-none transition-transform active:scale-95 focus-visible:ring-[3px] focus-visible:ring-ring/40 motion-reduce:transition-none"
                  title={gain ? t("gain:today.streakRule") : t("header.streakTitle")}
                >
                  <Flame className="size-4" aria-hidden />
                  {summary.streakDays}
                  <span className="sr-only">
                    {" "}
                    {gain
                      ? t("gain:today.streak", { count: summary.streakDays })
                      : t("header.streakDays", { count: summary.streakDays })}
                  </span>
                </button>
              )}
            />
          )}
          <Link
            to="/profil"
            aria-label={t("header.profile")}
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

      <StravaRetentionNotice className="mb-3" />
      <AddBackNotice show={summary.addBackNotice} className="mb-3" />

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
      <div
        className={cn(
          "grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-5",
          firstVisit && "stagger-enter",
        )}
      >
        <div className="min-w-0 space-y-2 lg:col-start-1 lg:row-start-1">
          {maternal ? <MaternalEatHero summary={summary} /> : <EatHero summary={summary} />}
          {!maternal && isToday && <TargetPaceNotice pace={targets.datePace} />}
          <div className={cn("grid gap-2", maternal ? "grid-cols-2" : "grid-cols-3")}>
            {!maternal && (
              <GlanceTile
                tint="bakar"
                to="/olahraga"
                icon={<Flame className="size-4 shrink-0" aria-hidden />}
                label={t("tile.burn")}
                value={<CountUp value={summary.burnedKcal} />}
                unit="kcal"
                sub={
                  summary.exerciseSources.length === 0
                    ? t("tile.burnNone")
                    : t("tile.burnSub", {
                        sources: summary.exerciseSources.map((source) => t(`tile.source.${source}`)).join(", "),
                      })
                }
              />
            )}
            <GlanceTile
              tint="tidur"
              to="/tidur"
              icon={<Moon className="size-4 shrink-0" aria-hidden />}
              label={t("tile.sleep")}
              value={
                summary.sleepHoursLastNight === null ? (
                  "–"
                ) : (
                  <CountUp value={summary.sleepHoursLastNight} format={fmtKg} />
                )
              }
              unit={summary.sleepHoursLastNight === null ? undefined : t("tile.sleepUnit")}
              sub={
                summary.sleepHoursLastNight === null
                  ? t("tile.sleepNone")
                  : t("tile.sleepNeed", { hours: fmtInt(targets.sleepHours) })
              }
            />
            <GlanceTile
              tint="makan"
              to="/makan"
              icon={<MACRO_META.protein.Icon className="size-4 shrink-0" aria-hidden />}
              label={t("tile.protein")}
              value={<CountUp value={summary.protein?.eatenG ?? 0} />}
              unit="g"
              sub={t("tile.proteinOf", { g: fmtInt(summary.protein?.targetG ?? 0) })}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <WaterTile date={isToday ? undefined : date} />
            <GlanceTile
              tint="makan"
              to="/berat"
              icon={<Scale className="size-4 shrink-0" aria-hidden />}
              label={t("tile.weight")}
              value={weightKg === null ? "–" : <CountUp value={weightKg} format={fmtKg} />}
              unit={weightKg === null ? undefined : "kg"}
              sub={maternal ? undefined : weightSub}
            />
          </div>
        </div>

        <div className="min-w-0 space-y-3 lg:col-start-2 lg:row-start-1">
          <TodayMeals summary={summary} isToday={isToday} />
          {isToday && !maternal ? <FastingScheduleCard /> : null}
          {maternal && <MaternalCard info={maternal} summary={summary} />}
          {gain && <GainPlanCard gain={gain} summary={summary} />}
        </div>

        <div className="min-w-0 space-y-3 lg:col-start-2 lg:row-start-2 lg:space-y-5">
          <WeightCard summary={summary} date={date} isToday={isToday} />
          {!maternal && <JoyoFitCard />}
        </div>

        <div className="min-w-0 lg:col-start-1 lg:row-start-2">
          <WaistCard date={date} isToday={isToday} />
        </div>
      </div>

      {stickers.length > 0 && (
        <section aria-label={t("plates.title")} className="mt-6">
          <SectionTitle>{t("plates.title")}</SectionTitle>
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

      {isToday && !maternal ? gain ? <GainDailyTip /> : <DailyTipCard /> : null}

      <MoreSection summary={summary} date={date} isToday={isToday} />
    </Page>
  );
}

function EatHero({ summary }: { summary: Summary }) {
  const { t } = useTranslation(["home", "gain"]);
  const targets = summary.targets;
  const { kcal: leftKcal, over } = remainingKcal(targets.eatKcal, summary.eatenKcal);
  const gaining = targets.gain != null;
  const intake = useGainIntake(targets.eatKcal, summary.eatenKcal);
  const [adaptiveOpen, setAdaptiveOpen] = useState(false);
  const [explainOpen, setExplainOpen] = useState(false);
  const maintenance = targets.notes.includes("MAINTENANCE") || targets.deficitKcal <= 0;
  const credit = summary.exerciseCredit;
  const exercise = targets.exerciseKcal;
  const pct = credit?.pct ?? DEFAULT_ADD_BACK_SETTINGS.pct;

  return (
    <Card className="p-4">
      <div className="flex items-center gap-4">
        <Ring
          metric="makan"
          value={summary.eatenKcal}
          max={targets.eatKcal}
          size={132}
          stroke={12}
          tone={gaining ? intake.tone : "ok"}
          label={
            gaining
              ? t("gain:today.eatenOf", {
                  eaten: fmtInt(summary.eatenKcal),
                  target: fmtInt(targets.eatKcal),
                })
              : t("eat.ringLabel", {
                  eaten: fmtInt(summary.eatenKcal),
                  target: fmtInt(targets.eatKcal),
                })
          }
        >
          {gaining ? (
            <div>
              <p className="text-xs font-semibold text-muted-foreground">
                {intake.state === "short" ? t("gain:today.shortLabel") : t("gain:today.ringLabel")}
              </p>
              <p className="text-[2.25rem] leading-none font-extrabold tracking-tighter tabular-nums">
                <CountUp value={intake.state === "short" ? intake.kcal : summary.eatenKcal} />
              </p>
              <p className="mt-0.5 text-xs font-semibold text-muted-foreground">kcal</p>
            </div>
          ) : (
            <div>
              <p className="text-xs font-semibold text-muted-foreground">
                {over ? t("eat.over") : t("eat.left")}
              </p>
              <p
                className={cn(
                  "text-[2.25rem] leading-none font-extrabold tracking-tighter tabular-nums",
                  over && "text-bakar-ink",
                )}
              >
                <CountUp value={leftKcal} />
              </p>
              <p className="mt-0.5 text-xs font-semibold text-muted-foreground">kcal</p>
            </div>
          )}
        </Ring>

        <div className="min-w-0 flex-1">
          <dl className="divide-y divide-border">
            <div className="flex items-baseline justify-between gap-2 pb-2">
              <dt className="text-xs font-semibold text-muted-foreground">{t("eat.target")}</dt>
              <dd className="text-lg font-extrabold tabular-nums">
                <CountUp value={targets.eatKcal} />
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-2 pt-2">
              <dt className="text-xs font-semibold text-muted-foreground">{t("eat.eaten")}</dt>
              <dd className="text-lg font-extrabold tabular-nums">
                <CountUp value={summary.eatenKcal} />
              </dd>
            </div>
          </dl>
          <div className="-mr-2.5 -mb-2.5 mt-1 flex justify-end">
            <button
              type="button"
              onClick={() => setExplainOpen(true)}
              aria-label={t("eat.help")}
              className="flex size-11 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
            >
              <CircleHelp className="size-5" aria-hidden />
            </button>
          </div>
        </div>
      </div>

      {gaining ? (
        <GainIntakeNote targetKcal={targets.eatKcal} eatenKcal={summary.eatenKcal} />
      ) : (
        over && (
          <p className="mt-2 text-sm leading-snug font-semibold text-bakar-ink">
            {t("eat.overNote", { kcal: fmtInt(leftKcal) })}
          </p>
        )
      )}

      {exercise > 0 && (
        <p className="mt-2 text-xs font-semibold text-muted-foreground tabular-nums">
          {t("explain.added", { kcal: fmtInt(exercise), pct })}
        </p>
      )}

      <Sheet open={explainOpen} onOpenChange={setExplainOpen} title={t("explain.title")}>
        <div className="space-y-4">
          <div className="rounded-2xl bg-makan-soft p-4">
            <p className="text-[0.9375rem] font-extrabold text-makan-ink">
              {gaining ? t("gain:webToday.explain.formula") : t("explain.formula")}
            </p>
            <p className="mt-1 text-sm font-semibold tabular-nums">
              {gaining
                ? t("gain:webToday.explain.example", {
                    target: fmtInt(targets.eatKcal),
                    eaten: fmtInt(summary.eatenKcal),
                    left: fmtInt(intake.kcal),
                  })
                : exercise > 0
                  ? t(over ? "explain.exampleAddOver" : "explain.exampleAdd", {
                      target: fmtInt(targets.eatKcal - exercise),
                      exercise: fmtInt(exercise),
                      eaten: fmtInt(summary.eatenKcal),
                      ...(over ? { over: fmtInt(leftKcal) } : { left: fmtInt(leftKcal) }),
                    })
                  : over
                    ? t("explain.exampleOver", {
                        target: fmtInt(targets.eatKcal),
                        eaten: fmtInt(summary.eatenKcal),
                        over: fmtInt(leftKcal),
                      })
                    : t("explain.example", {
                        target: fmtInt(targets.eatKcal),
                        eaten: fmtInt(summary.eatenKcal),
                        left: fmtInt(leftKcal),
                      })}
            </p>
          </div>
          <dl className="space-y-3">
            {(["target", "eaten", "left", "burn", "deficit"] as const).map((key) => (
              <div key={key}>
                <dt className="text-sm font-bold">
                  {gaining && key === "left"
                    ? t("gain:today.shortLabel")
                    : gaining && key === "deficit"
                      ? t("gain:coach.surplusExplainer.title")
                      : t(`explain.${key}.title`)}
                </dt>
                <dd className="mt-0.5 text-sm leading-relaxed text-muted-foreground">
                  {gaining
                    ? key === "left"
                      ? t("gain:webToday.explain.left")
                      : key === "burn"
                        ? t("explain.burn.body", { pct })
                        : key === "deficit"
                          ? t("gain:coach.surplusExplainer.body")
                          : t(`explain.${key}.body`)
                    : key === "deficit"
                      ? maintenance
                        ? t("explain.deficit.bodyMaintenance")
                        : t("explain.deficit.body", { kcal: fmtInt(targets.deficitKcal) })
                      : key === "burn"
                        ? t("explain.burn.body", { pct })
                        : t(`explain.${key}.body`)}
                  {key === "target" && targets.datePace && (
                    <span className="mt-1.5 block">
                      {t(`explain.clamped.${datePaceExplainKey(targets.datePace)}`, {
                        date: fmtDateLong(targets.datePace.reachDate).replace(/^\w+, /, ""),
                      })}
                    </span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
          {credit && (
            <div className="rounded-2xl bg-bakar-soft p-4 text-sm leading-relaxed">
              <p className="font-bold text-bakar-ink">{t("explain.addBack.title")}</p>
              <div className="mt-1 space-y-1.5 text-muted-foreground">
                {!credit.enabled ? (
                  <p>{t("explain.addBack.off")}</p>
                ) : credit.workoutKcal === 0 && credit.countedSteps === 0 ? (
                  <p>{t("explain.addBack.none")}</p>
                ) : (
                  <>
                    <p>
                      {t("explain.addBack.body", {
                        workout: fmtInt(credit.workoutKcal),
                        pct: credit.pct,
                        kcal: fmtInt(credit.countedKcal),
                      })}
                    </p>
                    {credit.countedSteps > 0 && (
                      <p>
                        {t("explain.addBack.steps", {
                          steps: fmtInt(credit.countedSteps),
                          threshold: fmtInt(credit.stepThreshold),
                          stepKcal: fmtInt(credit.stepKcal),
                        })}
                      </p>
                    )}
                    {credit.capped && (
                      <p>
                        {t("explain.addBack.capped", {
                          cap: credit.cap === "none" ? "" : fmtInt(credit.cap),
                        })}
                      </p>
                    )}
                  </>
                )}
              </div>
              <Link
                to="/profil/target"
                search={{}}
                className="mt-2 inline-flex min-h-11 items-center gap-1 font-semibold text-foreground hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
              >
                {t("explain.addBack.setting")}
                <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
              </Link>
            </div>
          )}
          <Link
            to="/profil/target"
            search={{ needs: true }}
            className="flex min-h-11 items-center justify-between gap-2 rounded-2xl bg-muted px-4 text-sm font-semibold hover:bg-muted/70 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
          >
            {t("explain.needs")}
            <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
          </Link>
        </div>
      </Sheet>

      {targets.notes.includes("ADAPTIVE") && (
        <>
          <button
            type="button"
            onClick={() => setAdaptiveOpen(true)}
            className="mt-1 inline-flex min-h-11 items-center gap-1.5 rounded-full text-xs font-semibold text-muted-foreground hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
          >
            <Info className="size-3.5" aria-hidden />
            {t("adaptive.link")}
          </button>
          <Sheet open={adaptiveOpen} onOpenChange={setAdaptiveOpen} title={t("adaptive.title")}>
            <div className="space-y-3 text-[0.9375rem] leading-relaxed">
              <p>
                <Trans
                  ns="home"
                  i18nKey="adaptive.formula"
                  values={{ kcal: fmtInt(targets.formulaTdee) }}
                  components={{ b: <strong className="tabular-nums" /> }}
                />
              </p>
              <p>
                <Trans
                  ns="home"
                  i18nKey="adaptive.actual"
                  values={{ kcal: fmtInt(targets.tdee) }}
                  components={{ b: <strong className="tabular-nums" /> }}
                />
              </p>
              <p className="text-sm text-muted-foreground">{t("adaptive.limit")}</p>
            </div>
          </Sheet>
        </>
      )}

      {summary.ideas.length > 0 && (
        <div className="mt-3 border-t pt-3">
          <p className="flex items-center gap-1.5 text-sm font-bold">
            <Sparkles className="size-4 text-makan" aria-hidden />
            {gaining ? t("gain:today.ideasTitle") : t("ideas.title")}
          </p>
          {gaining && (
            <p className="mt-0.5 text-xs text-muted-foreground">{t("gain:today.ideasHint")}</p>
          )}
          <ul className="-mx-4 mt-2 flex gap-2 overflow-x-auto px-4 no-scrollbar">
            {summary.ideas.map((idea) => (
              <li key={idea.name} className="w-40 shrink-0 rounded-2xl bg-makan-soft px-3 py-2.5">
                <p className="line-clamp-2 text-sm leading-snug font-semibold">{idea.name}</p>
                <p className="mt-1 text-xs font-semibold text-makan-ink tabular-nums">
                  <MetaLine
                    items={[
                      `${fmtInt(idea.kcal)} kcal`,
                      t("ideas.protein", { g: fmtInt(idea.proteinG) }),
                    ]}
                  />
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

function TodayMeals({ summary, isToday }: { summary: Summary; isToday: boolean }) {
  const { t } = useTranslation(["home", "common"]);
  const slots: Meal[] = [
    ...DEFAULT_SLOTS,
    ...(Object.keys(summary.eatenByMeal) as Meal[]).filter(
      (slot) => !DEFAULT_SLOTS.includes(slot) && summary.eatenByMeal[slot] > 0,
    ),
  ];
  const title = isToday
    ? t("meals.title")
    : t("meals.titleDay", { day: relativeDayLabel(summary.date, jakartaToday()) });
  return (
    <section aria-label={title}>
      <SectionTitle
        className="mb-1"
        action={
          <span className="flex items-center gap-3">
            <Link
              to="/makan"
              search={{ cerita: true }}
              className="inline-flex min-h-11 items-center gap-1 px-1 text-sm font-semibold text-primary hover:underline"
            >
              <Mic className="size-4" aria-hidden />
              {t("meals.story")}
            </Link>
            <Link
              to="/makan"
              className="inline-flex min-h-11 items-center px-1 text-sm font-semibold text-muted-foreground hover:underline"
            >
              {t("meals.all")}
            </Link>
          </span>
        }
      >
        {title}
      </SectionTitle>
      <ul className="overflow-hidden rounded-3xl bg-card">
        {slots.map((slot, index) => {
          const kcal = summary.eatenByMeal[slot] ?? 0;
          return (
            <li key={slot} className={cn("relative", index > 0 && "border-t border-border/70")}>
              <Link
                to="/makan"
                className="flex min-h-11 items-center gap-3 px-5 py-2 transition-colors hover:bg-muted/60 active:bg-muted focus-visible:bg-muted focus-visible:outline-none"
              >
                <span className="flex-1 text-[0.9375rem] font-semibold">
                  {t(`common:meal.editLabel.${slot}`)}
                </span>
                {kcal > 0 ? (
                  <span className="text-[0.9375rem] font-bold tabular-nums">
                    <CountUp value={kcal} />{" "}
                    <span className="text-xs font-semibold text-muted-foreground">kcal</span>
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-sm font-semibold text-primary">
                    <Plus className="size-4" aria-hidden />
                    {t("meals.log")}
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
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-12 w-full" aria-hidden>
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
  const { t } = useTranslation(["home", "berat", "common"]);
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const trend = summary.trend;
  const checkIn = useWeightCheckIn();
  const rate = trend?.weeklyRateKg ?? null;
  const flat = rate !== null && Math.abs(rate) <= 0.05;
  // Under a gain plan weight going up is the point: never painted as a warning.
  const gaining = summary.targets.gain != null;

  return (
    <section aria-label={t("weight.title")}>
      <SectionTitle
        className="mb-1"
        action={
          <Link
            to="/berat"
            className="inline-flex min-h-11 items-center px-1 text-sm font-semibold text-primary hover:underline"
          >
            {t("weight.chart")}
          </Link>
        }
      >
        {t("weight.title")}
      </SectionTitle>
      <Card className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold text-muted-foreground">
              {summary.targets.maternal ? t("tile.weight") : t("weight.trend")}
            </p>
            <p className="text-[1.75rem] leading-tight font-extrabold tracking-tight tabular-nums">
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
                  flat
                    ? "text-muted-foreground"
                    : gaining
                      ? rate > 0
                        ? "text-makan-ink"
                        : "text-amber-600 dark:text-amber-400"
                      : rate < 0
                        ? "text-makan-ink"
                        : "text-muted-foreground",
                )}
              >
                {flat
                  ? t("berat:trend.stable")
                  : t(rate < 0 ? "berat:trend.down" : "berat:trend.up", {
                      kg: fmtKg(Math.abs(rate)),
                    })}
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
            {isToday && summary.weightLoggedToday ? t("common:actions.edit") : t("weight.weigh")}
          </Button>
        </div>
        {trend && (
          <>
            <div className="mt-3">
              <Sparkline values={trend.points.map((p) => p.trendKg)} />
            </div>
            {trend.projectedDate && (
              <p className="mt-2 text-sm text-muted-foreground">
                <Trans
                  ns="home"
                  i18nKey="weight.projected"
                  values={{ date: fmtDateLong(trend.projectedDate).replace(/^\w+, /, "") }}
                  components={{ b: <strong className="font-semibold text-foreground" /> }}
                />
              </p>
            )}
          </>
        )}
      </Card>

      <Sheet
        open={open}
        onOpenChange={setOpen}
        title={
          isToday
            ? t("weight.sheetToday")
            : t("weight.sheetDay", { day: relativeDayLabel(date, jakartaToday()) })
        }
        description={t("weight.sheetHint")}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const kg = parseNum(value);
            if (kg === null || kg < 25 || kg > 400) {
              toast.error(t("weight.range"));
              return;
            }
            checkIn.mutate({ weightKg: kg, ...(isToday ? {} : { date }) });
            setOpen(false);
          }}
          className="space-y-4"
        >
          <div className="relative">
            <Input
              aria-label={t("weight.inputLabel")}
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
            {checkIn.isPending ? t("weight.saving") : t("common:actions.save")}
          </Button>
        </form>
      </Sheet>
    </section>
  );
}

const waistHistoryOptions = orpc.waist.history.queryOptions({ input: { limit: 30 } });

/** Compact Lingkar perut summary mirroring the Berat card; full section lives on /berat. */
function WaistCard({ date, isToday }: { date: string; isToday: boolean }) {
  const { t } = useTranslation(["home", "common"]);
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const history = useQuery(waistHistoryOptions);
  const checkIn = useWaistCheckIn((row) => t("waist.logged", { cm: fmtKg(row.waistCm) }));

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
                ? t("waist.ratioHigh", { ratio: fmtRatio(assessment.ratio) })
                : t("waist.aboveSafe"),
            tone: "text-destructive",
          }
        : assessment.band === "raised" || assessment.overCutoff
          ? {
              text:
                assessment.ratio !== null
                  ? t("waist.ratioRaised", { ratio: fmtRatio(assessment.ratio) })
                  : t("waist.aboveSafe"),
              tone: "text-amber-600 dark:text-amber-400",
            }
          : {
              text:
                assessment.ratio !== null
                  ? t("waist.ratioBelow", { ratio: fmtRatio(assessment.ratio) })
                  : t("waist.belowSafe"),
              tone: "text-makan-ink",
            };

  return (
    <section aria-label={t("waist.title")}>
      <SectionTitle
        className="mb-1"
        action={
          <Link
            to="/berat"
            className="inline-flex min-h-11 items-center px-1 text-sm font-semibold text-primary hover:underline"
          >
            {t("waist.detail")}
          </Link>
        }
      >
        {t("waist.title")}
      </SectionTitle>
      <Card className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold text-muted-foreground">{t("waist.latest")}</p>
            <p className="text-[1.75rem] leading-tight font-extrabold tracking-tight tabular-nums">
              {latest !== null ? fmtKg(latest) : "–"}
              <span className="ml-1 text-base font-semibold text-muted-foreground">cm</span>
            </p>
            {status !== null ? (
              <p className={cn("mt-0.5 text-sm font-semibold", status.tone)}>{status.text}</p>
            ) : (
              <p className="mt-0.5 text-sm text-muted-foreground">
                {latest !== null ? t("waist.needHeight") : t("waist.none")}
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
            {isToday && loggedToday ? t("common:actions.edit") : t("waist.measure")}
          </Button>
        </div>
        <div className="mt-3">
          <Sparkline values={entries.slice(-30).map((entry) => entry.waistCm)} tone="primary" />
        </div>
      </Card>

      <Sheet
        open={open}
        onOpenChange={setOpen}
        title={t("waist.sheetTitle")}
        description={t("waist.sheetHint")}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const cm = parseNum(value);
            if (cm === null || cm < 40 || cm > 250) {
              toast.error(t("waist.range"));
              return;
            }
            checkIn.mutate({ waistCm: cm, ...(isToday ? {} : { date }) });
            setOpen(false);
          }}
          className="space-y-4"
        >
          <div className="relative">
            <Input
              aria-label={t("waist.inputLabel")}
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
            {checkIn.isPending ? t("weight.saving") : t("common:actions.save")}
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
  const { t } = useTranslation(["home", "gain"]);
  const fact = pickFact(summary.date);
  return (
    <details className="group mt-6 rounded-3xl bg-card">
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between rounded-3xl px-5 select-none focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none [&::-webkit-details-marker]:hidden">
        <span className="text-[0.9375rem] font-bold">{t("more.title")}</span>
        <ChevronDown
          className="size-5 text-muted-foreground transition-transform duration-200 group-open:rotate-180"
          aria-hidden
        />
      </summary>
      <div className="space-y-5 px-5 pb-5">
        {isToday ? <BelanjaCard variant="line" /> : null}
        <WaterCard date={date} />
        {!summary.targets.maternal && <MovementCard date={date} />}
        {fact && !summary.targets.maternal && !summary.targets.gain && (
          <div className="rounded-2xl bg-muted p-4">
            <p className="text-xs font-semibold text-muted-foreground">{t("more.factLabel")}</p>
            <p className="mt-1 text-sm font-semibold">
              {t("more.fact", { text: fact.text, kcal: fmtInt(fact.kcal), move: fact.move })}
            </p>
          </div>
        )}
        {summary.milestones.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {summary.milestones.map((badge) => (
              <span
                key={`${badge.kind}-${badge.value}`}
                className="inline-flex h-9 items-center gap-1.5 rounded-full bg-makan-soft px-3 text-xs font-bold text-makan-ink"
              >
                <Trophy className="size-3.5" aria-hidden />
                {badge.kind === "streak"
                  ? t("milestone.streak", { days: badge.value })
                  : badge.kind === "gained"
                    ? t("gain:milestone.gained", { kg: badge.value })
                    : t("milestone.lost", { kg: badge.value })}
              </span>
            ))}
          </div>
        )}
      </div>
    </details>
  );
}

function BerandaSkeleton() {
  const { t } = useTranslation("home");
  return (
    <Page className="max-w-xl" aria-busy="true" aria-label={t("skeleton.label")}>
      <div className="px-1 pt-1 pb-3">
        <Skeleton className="h-4 w-32 rounded-full" />
        <Skeleton className="mt-2 h-7 w-48 rounded-full" />
      </div>
      <div className="flex items-center gap-4 rounded-3xl bg-card p-4">
        <Skeleton className="size-[132px] shrink-0 rounded-full" />
        <Skeleton className="h-24 flex-1 rounded-2xl" />
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-20 rounded-2xl" />
        ))}
      </div>
      <Skeleton className="mt-6 h-56 rounded-3xl" />
    </Page>
  );
}
