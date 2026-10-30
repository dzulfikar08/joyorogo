import "@/unistyles";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link, Redirect, router } from "expo-router";
import { Dimensions, Platform, Pressable, Share, ScrollView, View } from "react-native";
import { Fragment, useEffect, useState, type ReactNode } from "react";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Circle, Polyline, Svg } from "react-native-svg";

import {
  eatTone,
  effectiveRamadan,
  jakartaToday,
  MEAL_LABELS,
  needsBreakdown,
  relativeDayLabel,
  remainingKcal,
  slotsFor,
  datePaceExplainKey,
} from "@joyorogo/api/lib/engine";
import type { Meal } from "@joyorogo/api/lib/engine";
import { pickFact } from "@joyorogo/api/lib/facts";
import { gainEatTone, gainRemaining } from "@joyorogo/api/lib/gain";
import { DEFAULT_ADD_BACK_SETTINGS } from "@joyorogo/api/lib/exercise-credit";
import { clockHourIn, fmtNumber, instantIn } from "@joyorogo/i18n";

import { useBadges } from "@/components/badges/use-badges";
import { CalibrationChip } from "@/components/calibration-chip";
import { AskJoyoHeaderButton } from "@/components/joyo/ask-button";
import { CalibrationNotice } from "@/components/calibration-notice";
import { SetupChecklist, useSetupChecklist } from "@/components/setup-checklist";
import { ManualTdeeSuggestionCard } from "@/components/manual-tdee";
import { EnergyNotice } from "@/components/energy-notice";
import { FastLossNote } from "@/components/makan/fast-loss-note";
import { BelanjaCompact } from "@/components/plate/belanja";
import { MealPlanEntry } from "@/components/meal-plan/entry-card";
import {
  GainCard,
  GainDailyTip,
  gainRemainingLabel,
  gainTipLabel,
} from "@/components/gain/gain-today";
import { DaySwitcher } from "@/components/day-switcher";
import { MacroTargetsExplain } from "@/components/macro-targets-explain";
import { RecapCard } from "@/components/recap-card";
import { MaternalCard } from "@/components/maternal/maternal-card";
import { StravaRetentionNotice } from "@/components/strava-retention-notice";
import { useAppConfig } from "@/components/billing";
import { FoodSticker, StickerViewer, stickerUrl } from "@/components/sticker";
import { mealStickerTarget } from "@joyorogo/api/lib/meal-sticker";
import type { StickerViewerTarget } from "@/components/sticker";
import { ShareStoryButton, StoryShareSheet } from "@/components/story/share-story-button";
import type { StorySpec } from "@/components/story/types";
import { defaultRecapWeek, recapShare } from "@joyorogo/api/lib/recap";
import { weightGoalProgress } from "@joyorogo/sticker";
import { shareUrl } from "@/src/lib/share-links";

import {
  Avatar,
  BootLoader,
  Button,
  Card,
  CountNum,
  ErrorState,
  ListGroup,
  ListRow,
  Num,
  Ring,
  Screen,
  SectionTitle,
  Sheet,
  Skeleton,
  Text,
} from "@/components/ui";
import { MetaLine } from "@/components/meta-line";
import { PressableScale, Reveal } from "@/components/motion";
import { ProChip } from "@/components/pro/pro-chip";
import { StreakNudge } from "@/components/pro/streak-nudge";
import { WaterCard, useWater } from "@/components/water-card";
import { FastingScheduleCard } from "@/components/fasting/schedule-card";
import { DailyTipCard } from "@/components/tips/daily-tip-card";
import { WeighInSheet } from "@/components/weigh-in-sheet";
import { JoyoFitCard } from "@/components/workout/joyofit-card";
import { authClient } from "@/lib/auth-client";
import { useSessionGate } from "@/lib/use-session-gate";
import { pushDaySnapshot, pushSignedOutSnapshot } from "@/src/lib/widgets/push";
import { useJakartaClock } from "@/src/lib/use-jakarta-clock";
import { useSelectedDay } from "@/src/lib/selected-day";
import { useHealthAutoSync } from "@/src/lib/use-health-sync";
import { TargetPaceNotice } from "@/components/target-pace-notice";
import { errorMessage, fmtDateMedium, fmtInt, fmtKg, kcalUnit, weeklyRateLabel } from "@/utils/format";
import { visibleHomeCards, type HomeCardId } from "@joyorogo/api/lib/home-cards";
import { trendChange, weightSecondary } from "@joyorogo/api/lib/home-stats";
import { StatList, StatRow } from "@/components/day-stats";
import { useHomeCards } from "@/src/lib/home-cards-store";
import { MACRO_META, MacroIcon, type MacroKey } from "@/utils/macro-icons";
import { orpc } from "@/utils/orpc";

type SumRow = { key: string; label: string; value: string | null; sub?: string; strong?: boolean };

/** "−0,4" / "+0,3" / "0,0": the sign is always explicit except at zero. */
function signedKg(kg: number): string {
  const rounded = Math.round(kg * 10) / 10;
  if (rounded === 0) return fmtKg(0);
  return `${rounded < 0 ? "−" : "+"}${fmtKg(Math.abs(rounded))}`;
}

type TrendPoint = { date: string; weightKg: number; trendKg: number };

type PlateItem = {
  id: string;
  name: string;
  kcal: number;
  scanId: string | null;
  plateScanId?: string | null;
  photoId?: string | null;
  protein?: number | null;
  carbs?: number | null;
  fat?: number | null;
};

/** Day total of one macro from the diary rows, or null when no row carries it. */
function sumMacro(
  items: ReadonlyArray<{ protein?: number | null; carbs?: number | null; fat?: number | null }> | undefined,
  key: "carbs" | "fat",
): number | null {
  const values = (items ?? []).map((item) => item[key]).filter((v): v is number => typeof v === "number");
  return values.length ? Math.round(values.reduce((sum, v) => sum + v, 0)) : null;
}

function greetingKey(date: Date): "morning" | "noon" | "afternoon" | "evening" {
  const h = Math.floor(clockHourIn(undefined, date));
  if (h >= 4 && h < 11) return "morning";
  if (h >= 11 && h < 15) return "noon";
  if (h >= 15 && h < 18) return "afternoon";
  return "evening";
}

/** Trend line (smoothed) over raw scale dots — answers "where am I heading?". */
function TrendSpark({ points }: { points: TrendPoint[] }) {
  const { theme } = useUnistyles();
  if (points.length === 0) return null;
  const w = Math.min(300, Dimensions.get("window").width - 120);
  const h = 56;
  const pad = 5;
  const values = points.flatMap((p) => [p.weightKg, p.trendKg]);
  const min = Math.min(...values) - 0.4;
  const max = Math.max(...values) + 0.4;
  const x = (i: number) =>
    points.length === 1 ? w / 2 : pad + (i / (points.length - 1)) * (w - 2 * pad);
  const y = (v: number) => h - pad - ((v - min) / (max - min)) * (h - 2 * pad);
  return (
    <View style={styles.sparkBox}>
      <Svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`}>
        {points.length > 1 ? (
          <Polyline
            points={points.map((p, i) => `${x(i)},${y(p.trendKg)}`).join(" ")}
            stroke={theme.colors.makan}
            strokeWidth={2.5}
            strokeLinejoin="round"
            strokeLinecap="round"
            fill="none"
          />
        ) : null}
        {points.map((p, i) => (
          <Circle
            key={p.date}
            cx={x(i)}
            cy={y(p.weightKg)}
            r={2.6}
            fill={theme.colors.mutedForeground}
          />
        ))}
      </Svg>
    </View>
  );
}

/**
 * One macro in the calorie card: icon and label, the day's value with its unit inline, and a thin bar when it has a
 * target. Past the target the bar and value turn terracotta (bakar), like Makan's MacroBar; Naikin BB never does.
 */
function MacroStat({
  macro,
  label,
  value,
  progress,
  neutral = false,
}: {
  macro: MacroKey;
  label: string;
  value: string;
  progress?: number;
  neutral?: boolean;
}) {
  const { theme } = useUnistyles();
  const over = !neutral && progress !== undefined && progress > 1;
  return (
    <View style={styles.macroStat} accessible accessibilityLabel={`${label}, ${value}`}>
      <View style={styles.macroStatLabel}>
        <MacroIcon macro={macro} size={14} />
        <Text style={styles.macroStatName} numberOfLines={1}>
          {label}
        </Text>
      </View>
      <Num
        style={[styles.macroStatValue, over && { color: theme.colors.bakarText }]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.8}
      >
        {value}
      </Num>
      {progress !== undefined ? (
        <View style={styles.macroStatTrack}>
          <View
            style={[
              styles.macroStatFill,
              { width: `${Math.round(Math.min(1, Math.max(0, progress)) * 100)}%` },
              over && { backgroundColor: theme.colors.bakar },
            ]}
          />
        </View>
      ) : null}
    </View>
  );
}

export default function Dashboard() {
  const { theme } = useUnistyles();
  const { t } = useTranslation(["home", "common", "berat", "maternal", "gain", "scan", "badges"]);
  const gate = useSessionGate();
  const { today, now } = useJakartaClock();
  const [date, setDate] = useSelectedDay(today);
  const isToday = date === today;
  const badges = useBadges();
  const badgesEarned = badges.data?.enabled ? badges.data.badges.filter((b) => b.tier > 0).length : null;
  const summary = useQuery({
    ...orpc.day.summary.queryOptions({ input: { date } }),
    placeholderData: (prev) => prev,
  });
  const profileQuery = useQuery(orpc.profile.myProfile.queryOptions());
  // Shared cache with FastingScheduleCard below; also feeds the widget line.
  const fastingToday = useQuery(orpc.fasting.today.queryOptions({ input: {} }));
  const config = useAppConfig();
  const water = useWater(date === today ? undefined : date);
  const { data: sessionData } = authClient.useSession();
  // Diari piring: today's scanned items with their sticker cutouts.
  const foods = useQuery(
    orpc.food.listByDate.queryOptions({ input: { date: summary.data?.date ?? date } }),
  );

  // US-013: health data is the primary activity source (Health Connect on
  // Android, Apple Health on iOS) — once reads are granted (first import
  // from Profil), every app open syncs silently.
  useHealthAutoSync(
    profileQuery.data?.latestWeightKg ?? null,
    gate === "authed" && summary.data?.hasProfile === true,
  );

  // Home-screen widgets render from a stored snapshot; feed it every time
  // the day summary query resolves (load, refetch, log mutations invalidate).
  const summaryData = summary.data;
  const fastingData = fastingToday.data;
  useEffect(() => {
    // An expired session leaves the last person's numbers on the home screen: flip the widgets to signed out.
    if (gate === "anon") void pushSignedOutSnapshot();
    // Widgets describe the live day; skip while a past day is on screen.
    if (gate !== "authed" || !summaryData?.hasProfile || !summaryData.targets) return;
    if (summaryData.date !== today) return;
    void pushDaySnapshot(
      {
        date: summaryData.date,
        zone: summaryData.zone,
        eatenKcal: summaryData.eatenKcal,
        eatKcal: summaryData.targets.eatKcal,
        proteinEatenG: summaryData.protein?.eatenG ?? null,
        proteinTargetG: summaryData.protein?.targetG ?? null,
        streakDays: summaryData.streakDays,
        streak: summaryData.streak
          ? { days: summaryData.streak.days, lastLoggedDate: summaryData.streak.lastLoggedDate }
          : null,
        maternal: summaryData.targets.maternal != null,
        gain: summaryData.targets.maternal == null && summaryData.targets.gain != null,
      },
      // undefined (query pending) keeps the snapshot's current IF line so it
      // doesn't flicker off; null clears it when IF is off or Ramadan owns the day.
      fastingData?.active && fastingData.state && fastingData.windowOpen && fastingData.windowClose
        ? {
            state: fastingData.state,
            windowOpen: fastingData.windowOpen,
            windowClose: fastingData.windowClose,
          }
        : fastingData === undefined
          ? undefined
          : null,
    );
  }, [gate, summaryData, fastingData, today]);

  const [weighOpen, setWeighOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [explainOpen, setExplainOpen] = useState(false);
  // Share entry points. Hooks live above the early returns below: Dashboard renders loading, then loaded.
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const refreshAll = async () => {
    setRefreshing(true);
    try {
      // Everything mounted on Beranda (summary, water, fasting, diary, cards) refetches, not just the day summary.
      await queryClient.refetchQueries({ type: "active" });
    } finally {
      setRefreshing(false);
    }
  };
  const [streakOpen, setStreakOpen] = useState(false);
  const [weightOpen, setWeightOpen] = useState(false);
  const [recapStory, setRecapStory] = useState<StorySpec | null>(null);
  const [viewer, setViewer] = useState<StickerViewerTarget | null>(null);
  const { prefs: cardPrefs } = useHomeCards();
  // New-account steps (first meal, a second weigh-in, an activity source), detected from the data; today's view only.
  const checklist = useSetupChecklist({
    userId: sessionData?.user.id ?? null,
    accountCreatedAt: sessionData?.user.createdAt ?? null,
    enabled: gate === "authed" && summary.data?.hasProfile === true && isToday,
    eatenToday: (summary.data?.eatenKcal ?? 0) > 0,
  });

  if (gate === "loading") {
    return <BootLoader />;
  }
  if (gate === "anon") {
    return <Redirect href="/login" />;
  }
  if (summary.isPending) {
    return (
      <Screen>
        <Skeleton width="55%" height={28} />
        <Skeleton width="100%" height={280} radius={24} />
        <View style={styles.tileRow}>
          <Skeleton width="100%" height={96} radius={18} />
          <Skeleton width="100%" height={96} radius={18} />
          <Skeleton width="100%" height={96} radius={18} />
        </View>
        <Skeleton width="40%" height={20} />
        <Skeleton width="100%" height={160} radius={24} />
      </Screen>
    );
  }
  if (summary.isError) {
    return (
      <Screen>
        <ErrorState message={errorMessage(summary.error)} onRetry={() => summary.refetch()} />
      </Screen>
    );
  }
  const data = summary.data;
  if (!data.hasProfile || !data.targets) {
    return <Redirect href="/onboarding" />;
  }

  const maternal = data.targets.maternal ?? null;
  // Naikin BB: under-eating is the problem, so Sisa flips to what is still to eat.
  const gain = maternal ? null : (data.targets.gain ?? null);
  const gainLeft = gain ? gainRemaining(data.targets.eatKcal, data.eatenKcal) : null;
  // Hamil / Menyusui: a need to meet, never a budget to stay under.
  const { kcal: leftKcal, over: overBudget } = remainingKcal(data.targets.eatKcal, data.eatenKcal);
  const over = maternal || gain ? false : overBudget;
  const credit = data.exerciseCredit;
  const needs = needsBreakdown(data.targets);
  // "Cara baca angka ini": the day's budget step by step, every number from needsBreakdown.
  const sumRows: SumRow[] = [
    {
      key: "tdee",
      label: t("explain.sum.tdee", { bmr: fmtInt(needs.bmrKcal), factor: fmtNumber(needs.factor, 3) }),
      value: fmtInt(needs.tdeeKcal),
    },
    ...(needs.cutKcal > 0
      ? [{ key: "cut", label: t("explain.sum.cut"), value: `−${fmtInt(needs.cutKcal)}` }]
      : []),
    ...(needs.surplusKcal > 0
      ? [{ key: "surplus", label: t("explain.sum.surplus"), value: `+${fmtInt(needs.surplusKcal)}` }]
      : []),
    ...(needs.addKcal > 0 ? [{ key: "add", label: t("explain.sum.add"), value: `+${fmtInt(needs.addKcal)}` }] : []),
    ...(data.targets.notes.includes("PLAN_CLAMPED") && needs.cutKcal < needs.deficitKcal
      ? [{ key: "floor", label: t("explain.sum.floor"), value: null }]
      : []),
    ...(needs.exerciseKcal > 0
      ? [
          {
            key: "activity",
            label: t("explain.sum.activity"),
            sub: credit ? t("explain.sum.activityOf", { pct: credit.pct, kcal: fmtInt(credit.extraKcal) }) : undefined,
            value: `+${fmtInt(needs.exerciseKcal)}`,
          },
        ]
      : []),
    { key: "target", label: t("explain.sum.target"), value: fmtInt(needs.budgetKcal), strong: true },
    { key: "eaten", label: t("explain.sum.eaten"), value: `−${fmtInt(data.eatenKcal)}` },
    { key: "left", label: t("explain.sum.left"), value: `${over ? "−" : ""}${fmtInt(leftKcal)}`, strong: true },
  ];
  const tone = maternal
    ? "ok"
    : gain
      ? gainEatTone(data.eatenKcal, data.targets.eatKcal)
      : eatTone(data.eatenKcal, data.targets.eatKcal);
  const ringColor = {
    ok: theme.colors.makan,
    near: theme.colors.eatNear,
    over: theme.colors.destructive,
  }[tone];
  const profileRow = profileQuery.data?.profile ?? null;
  const gainStartKg = profileRow ? (profileRow.goalStartKg ?? profileRow.startWeightKg) : null;
  const maintenance = data.targets.notes?.includes("MAINTENANCE") || data.targets.deficitKcal === 0;
  const plates = (foods.data?.items ?? []).filter((item) => item.scanId != null) as Array<
    PlateItem & { scanId: string }
  >;
  const fact = pickFact(data.date);
  const displayName = sessionData?.user.name ?? t("header.fallbackName");
  const firstName = displayName.split(" ")[0];
  const slots = slotsFor(effectiveRamadan(profileQuery.data?.profile?.ramadanMode)) as Meal[];
  const trendPoints = data.trend?.points ?? [];

  // Compact always-on Founder banner: free tier with billing on, shown only
  // once the profile query confirms tier (founders never see a flash).
  const ios = Platform.OS === "ios";
  const configData = config.data;
  const showFounderBanner =
    configData !== undefined &&
    (ios ? configData.appleBilling === true : configData.billing === true) &&
    profileQuery.data?.tier === "free" &&
    configData.freeDailyScans !== null;

  // One progress story feeds the header icon, the streak pill and (as the weekly fallback) nothing else.
  const weightNowKg = data.latestWeightKg;
  const weight =
    !maternal && profileRow && weightNowKg !== null && weightNowKg !== undefined
      ? { startKg: profileRow.startWeightKg, nowKg: weightNowKg, goalKg: profileRow.targetWeightKg }
      : null;
  const progressStory: StorySpec = {
    kind: "progress",
    eatenKcal: data.eatenKcal,
    targetKcal: data.targets.eatKcal,
    proteinG: data.protein?.eatenG ?? null,
    proteinTargetG: data.protein?.targetG ?? null,
    streakDays: data.streakDays,
    weightLostKg: data.weightLostKg,
    weightGainedKg: data.weightGainedKg,
    gain: gain != null,
    weekTrend: data.weekTrend,
    // The server fields come with a backend deploy; the client derives the same numbers so the stickers never depend on it.
    carbsG: data.carbsEatenG ?? sumMacro(foods.data?.items, "carbs"),
    fatG: data.fatEatenG ?? sumMacro(foods.data?.items, "fat"),
    weightGoalProgress: data.weightGoalProgress ?? (weight ? weightGoalProgress(weight.startKg, weight.nowKg, weight.goalKg) : null),
    weight: weight ?? (data.weightStartKg != null && data.weightNowKg != null
      ? { startKg: data.weightStartKg, nowKg: data.weightNowKg, goalKg: data.weightGoalKg }
      : null),
  };

  /** The last finished week as a sticker; the plain text share stays as the fallback when nothing was logged. */
  const openRecapSticker = async () => {
    try {
      const weekStart = defaultRecapWeek(today);
      const recap = await queryClient.fetchQuery(orpc.stats.weekRecap.queryOptions({ input: { weekStart } }));
      const share = recap ? recapShare(recap) : null;
      if (share) {
        setRecapStory({ kind: "recap", ...share, date: new Date(instantIn(recap!.weekEnd, 12, 0)) });
        return;
      }
    } catch {
      // Offline or failed: fall through to the text share.
    }
    shareRecap();
  };

  const shareRecap = () => {
    const pts = (data.weekTrend ?? []).filter((t) => t.weightKg != null) as Array<{
      date: string;
      weightKg: number;
    }>;
    const txt = [
      t("recapShare.title"),
      t("recapShare.streak", { count: data.streakDays }),
      t("recapShare.average", { kcal: fmtInt(Math.round(data.weekEatenKcal / 7)) }),
      t("recapShare.trend", { points: pts.map((p) => fmtKg(p.weightKg) + "kg").join(" → ") }),
      t("recapShare.madeWith", { url: shareUrl("/", "recap") }),
    ].join("\n");
    Share.share({ message: txt }).catch(() => {
      // User dismissed the share sheet; nothing to surface.
    });
  };

  // Daily report numbers. Each figure is shown once, where it reads best: the calorie card owns kcal and the macros, the
  // stats list owns activity, sleep, water and the last weight, the weight card owns the trend.
  const carbsG = data.carbsEatenG ?? sumMacro(foods.data?.items, "carbs");
  const fatG = data.fatEatenG ?? sumMacro(foods.data?.items, "fat");
  const macroValue = (eaten: number | null, target: number | undefined) =>
    eaten === null
      ? "–"
      : target
        ? t("macros.ofTarget", { eaten: fmtInt(eaten), target: fmtInt(target) })
        : t("macros.grams", { g: fmtInt(eaten) });
  const weightKg = data.latestWeightKg ?? data.trend?.weightKg ?? null;
  const change = trendChange(trendPoints);
  const changeLabel = change
    ? t("weight.trendChange", { delta: signedKg(change.deltaKg), days: change.days })
    : "";
  const weightLine = weightSecondary({
    weightKg,
    latestWeightDate: data.latestWeightDate,
    today,
    loggedToday: isToday && data.weightLoggedToday,
  });
  const weightSub =
    weightLine.kind === "today"
      ? t("tile.weightToday")
      : weightLine.kind === "last"
        ? t("tile.weightLast", { when: relativeDayLabel(weightLine.when, today).toLowerCase() })
        : weightLine.kind === "lastUnknown"
          ? t("tile.weightLastUnknown")
          : t("tile.weightNone");
  // Nothing eaten yet: Sisa would equal the target, so the ring carries the target once and the side offers the first log.
  const dayStarted = data.eatenKcal > 0;
  const showFirstLog = !maternal && !gainLeft && !dayStarted;
  // While the checklist is up, its first-meal row is the one "Catat": the ring keeps the target and drops its own button.
  const checklistOffersLog =
    checklist.list?.rows.some((row) => row.id === "meal" && !row.done) ?? false;

  const cards: Record<HomeCardId, ReactNode> = {
    calorie: (
      <Reveal index={0}>
        <Card style={styles.heroCard}>
          {maternal ? <Text style={styles.heroLabel}>{t("maternal:target.title")}</Text> : null}
          <View style={styles.heroRow}>
            <Ring
              size={136}
              stroke={12}
              value={data.eatenKcal}
              max={data.targets.eatKcal}
              color={ringColor}
              track={theme.colors.makanSoft}
            >
              <Text style={styles.heroLabel}>
                {maternal
                  ? t("maternal:target.eaten")
                  : gainLeft
                    ? gainLeft.state === "short"
                      ? t("gain:today.shortLabel")
                      : t("gain:today.ringLabel")
                    : showFirstLog
                      ? t("eat.targetShort")
                      : over
                        ? t("eat.over")
                        : t("eat.left")}
              </Text>
              <CountNum
                value={
                  maternal
                    ? data.eatenKcal
                    : gainLeft
                      ? gainLeft.state === "short"
                        ? gainLeft.kcal
                        : data.eatenKcal
                      : showFirstLog
                        ? data.targets.eatKcal
                        : leftKcal
                }
                style={[styles.heroNumber, over && { color: theme.colors.bakarText }]}
                adjustsFontSizeToFit
                numberOfLines={1}
              />
              <Text style={styles.heroLabel}>{kcalUnit()}</Text>
            </Ring>
            <View style={styles.heroStats}>
              {showFirstLog ? (
                checklistOffersLog ? null : (
                  <Button
                    size="sm"
                    icon="add"
                    label={t("meals.log")}
                    onPress={() => router.navigate("/makan")}
                  />
                )
              ) : (
                <>
                  <View style={styles.heroStat}>
                    <Text style={styles.heroStatLabel}>{maternal ? t("maternal:target.total") : t("eat.target")}</Text>
                    <CountNum value={data.targets.eatKcal} style={styles.heroStatValue} adjustsFontSizeToFit numberOfLines={1} />
                  </View>
                  {maternal ? (
                    <Text style={styles.helpText}>
                      {t("maternal:target.progress", {
                        pct: Math.round((data.eatenKcal / Math.max(data.targets.eatKcal, 1)) * 100),
                      })}
                    </Text>
                  ) : (
                    <View style={[styles.heroStat, styles.heroStatMid]}>
                      <Text style={styles.heroStatLabel}>{t("eat.eaten")}</Text>
                      <CountNum value={data.eatenKcal} style={styles.heroStatValue} adjustsFontSizeToFit numberOfLines={1} />
                    </View>
                  )}
                </>
              )}
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={t("eat.help")}
                onPress={() =>
                  maternal
                    ? router.push({ pathname: "/profil", params: { needs: "1" } })
                    : setExplainOpen(true)
                }
                scaleTo={1}
                dimTo={0.7}
                style={styles.helpButton}
              >
                <Ionicons
                  name="help-circle-outline"
                  size={20}
                  color={theme.colors.mutedForeground}
                />
                <Text style={styles.helpText} numberOfLines={1}>
                  {t("eat.help")}
                </Text>
              </PressableScale>
            </View>
          </View>
          {over ? <Text style={styles.heroNote}>{t("eat.overNote")}</Text> : null}
          {maternal && data.eatenKcal >= data.targets.eatKcal ? (
            <Text style={styles.heroNote}>{t("maternal:target.reached")}</Text>
          ) : null}
          {gainLeft ? (
            <View style={styles.gainNote}>
              <Text style={styles.gainStatus}>{gainRemainingLabel(gainLeft)}</Text>
              <Text style={styles.gainHint}>{gainTipLabel(gainLeft)}</Text>
              {gainLeft.state === "over" ? (
                <Text style={styles.gainHint}>{t("gain:today.overHint")}</Text>
              ) : null}
            </View>
          ) : null}
          {maternal ? null : (
            <View style={styles.macroRow}>
              <MacroStat
                macro="protein"
                label={gain ? t("gain:today.protein") : MACRO_META.protein.label}
                value={data.protein ? t("macros.ofTarget", { eaten: fmtInt(data.protein.eatenG), target: fmtInt(data.protein.targetG) }) : "–"}
                progress={data.protein && data.protein.targetG > 0 ? data.protein.eatenG / data.protein.targetG : 0}
                neutral={gain !== null}
              />
              <MacroStat
                macro="carbs"
                label={MACRO_META.carbs.label}
                value={macroValue(carbsG, data.macros?.carbsTargetG)}
                progress={data.macros?.carbsTargetG && carbsG !== null ? carbsG / data.macros.carbsTargetG : undefined}
                neutral={gain !== null}
              />
              <MacroStat
                macro="fat"
                label={MACRO_META.fat.label}
                value={macroValue(fatG, data.macros?.fatTargetG)}
                progress={data.macros?.fatTargetG && fatG !== null ? fatG / data.macros.fatTargetG : undefined}
                neutral={gain !== null}
              />
            </View>
          )}
        </Card>
      </Reveal>
    ),

    stats: (
      <Reveal index={1}>
        <StatList>
          {maternal ? null : (
            <StatRow
              icon="flame"
              tint="bakar"
              label={t("tile.burn")}
              value={`${fmtInt(credit?.activeKcal ?? 0)} ${kcalUnit()}`}
              secondary={
                credit?.allDaySource
                  ? t(`tile.activeFrom.${credit.allDaySource}`)
                  : data.exerciseSources.length > 0
                    ? t("tile.burnSub", {
                        sources: data.exerciseSources.map((source) => t(`tile.source.${source}`)).join(", "),
                      })
                    : t("tile.burnNone")
              }
              onPress={() => router.navigate("/olahraga")}
            />
          )}
          <StatRow
            icon="moon"
            tint="tidur"
            label={t("tile.sleep")}
            value={data.sleepHoursLastNight !== null ? t("tile.sleepValue", { hours: fmtKg(data.sleepHoursLastNight) }) : "–"}
            secondary={
              data.sleepHoursLastNight !== null
                ? t("tile.sleepNeed", { hours: fmtKg(data.targets.sleepHours) })
                : t("tile.sleepNone")
            }
            onPress={() => router.navigate("/tidur")}
          />
          {maternal ? null : (
            <StatRow
              icon="water"
              tint="tidur"
              label={t("tile.water")}
              value={t("tile.waterValue", { count: water.glasses, goal: water.goal })}
              progress={water.goal > 0 ? water.glasses / water.goal : 0}
              onPress={() =>
                router.navigate(date === today ? "/air" : { pathname: "/air", params: { date } })
              }
              right={
                <PressableScale
                  accessibilityRole="button"
                  accessibilityLabel={t("water.more")}
                  onPress={water.add}
                  disabled={water.busy}
                  hitSlop={14}
                  scaleTo={0.88}
                  style={styles.addWater}
                >
                  <Ionicons name="add" size={16} color={theme.colors.mutedForeground} />
                </PressableScale>
              }
            />
          )}
          <StatRow
            icon="scale-outline"
            tint="makan"
            label={t("tile.weight")}
            value={weightKg === null ? "–" : `${fmtKg(weightKg)} kg`}
            secondary={weightSub}
            onPress={() => router.navigate("/berat")}
          />
        </StatList>
      </Reveal>
    ),

    meals: (
      <>
        <SectionTitle
          title={isToday ? t("meals.title") : t("meals.titleDay", { day: relativeDayLabel(date, today) })}
          action={{ label: t("meals.all"), onPress: () => router.navigate("/makan") }}
        />
        <Reveal index={2}>
          <ListGroup>
            {slots.map((slot) => {
              const kcal = data.eatenByMeal[slot] ?? 0;
              return (
                <ListRow
                  key={slot}
                  title={MEAL_LABELS[slot]}
                  subtitle={kcal > 0 ? undefined : t("meals.empty")}
                  value={kcal > 0 ? `${fmtInt(kcal)} ${kcalUnit()}` : undefined}
                  chevron
                  onPress={() => router.navigate("/makan")}
                />
              );
            })}
          </ListGroup>
        </Reveal>
        {/* Diari piring: stiker hasil pindai hari ini */}
        {plates.length > 0 ? (
          <View style={styles.platesWrap}>
            <Text style={styles.ideasTitle}>{t("plates.title")}</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.platesRow}
            >
              {plates.map((item, index) => (
                <Reveal key={item.id} index={index} style={styles.plateCard}>
                  <FoodSticker
                    scanId={item.scanId}
                    name={item.name}
                    size={72}
                    onPress={() => {
                      const target = mealStickerTarget(item, plates, (first, count) =>
                        t("scan:result.names.more", { first, count }),
                      );
                      if (!target) return;
                      setViewer({
                        uri: stickerUrl(target.scanId),
                        fallbackUri: target.fallbackScanId ? stickerUrl(target.fallbackScanId) : undefined,
                        name: target.name,
                        kcal: target.kcal,
                        photoId: target.photoId,
                        protein: target.protein,
                        carbs: target.carbs,
                        fat: target.fat,
                      });
                    }}
                  />
                  <Text style={styles.plateName} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Text style={styles.plateKcal}>{fmtInt(item.kcal)} {kcalUnit()}</Text>
                </Reveal>
              ))}
            </ScrollView>
          </View>
        ) : null}
      </>
    ),

    mode: maternal ? (
      <MaternalCard
        info={maternal}
        proteinG={data.protein?.eatenG ?? null}
        fiberG={foods.data?.totals.fiber ?? null}
        waterGlasses={water.glasses}
        waterGoal={water.goal}
        caffeine={data.maternal?.caffeine ?? null}
      />
    ) : gain ? (
      <GainCard
        gain={gain}
        targetKcal={needs.targetKcal}
        tdee={data.targets.tdee}
        streakDays={data.streakDays}
        gainedKg={data.weightGainedKg}
        startKg={gainStartKg}
      />
    ) : null,

    // Explanatory notes, each one collapsed to a line until opened.
    notices: (
      <>
        {!maternal && isToday ? <TargetPaceNotice pace={data.targets.datePace} /> : null}
        {!maternal && isToday ? <FastLossNote note={data.fastLoss} today={data.date} /> : null}
        <StravaRetentionNotice />
        <EnergyNotice notice={data.energyNotice} />
        <CalibrationNotice notice={data.calibrationNotice} />
        <ManualTdeeSuggestionCard info={data.targets.manualTdee} />
      </>
    ),

    // Trend only: the last weight itself lives in the stats list.
    weight: data.trend ? (
      <Card>
        <View
          style={styles.trendHead}
          accessible
          accessibilityLabel={`${t("weight.trendHeader", { kg: fmtKg(data.trend.weightKg) })}${
            change ? `, ${changeLabel}` : ""
          }`}
        >
          <View>
            <Text style={styles.trendLabel}>{t("weight.trend")}</Text>
            <View style={styles.trendValueRow}>
              <Num style={styles.trendValue}>{fmtKg(data.trend.weightKg)}</Num>
              <Text style={styles.trendUnit}>kg</Text>
            </View>
          </View>
          {change || data.trend.projectedDate ? (
            <View style={styles.trendRate}>
              {change ? <Text style={styles.trendRateValue}>{changeLabel}</Text> : null}
              {data.trend.projectedDate ? (
                <Text style={styles.trendRateSub}>
                  {t("weight.projectedShort", { date: fmtDateMedium(data.trend.projectedDate) })}
                </Text>
              ) : null}
            </View>
          ) : null}
        </View>
        {trendPoints.length > 1 ? <TrendSpark points={trendPoints} /> : null}
        {trendPoints.length > 1 ? (
          <Text style={styles.trendRange}>
            {t("weight.trendRange", {
              from: fmtDateMedium(trendPoints[0]!.date),
              to: fmtDateMedium(trendPoints[trendPoints.length - 1]!.date),
            })}
          </Text>
        ) : null}
        {isToday ? (
          data.weightLoggedToday ? (
            <Text style={styles.trendNote}>{t("weight.doneToday")}</Text>
          ) : (
            <>
              <Text style={styles.trendNote}>
                {trendPoints.length === 0 ? t("weight.startPrompt") : t("weight.missedToday")}
              </Text>
              <View>
                <Button
                  variant="ghost"
                  size="sm"
                  label={t("weight.weighNow")}
                  icon="scale-outline"
                  onPress={() => setWeighOpen(true)}
                />
              </View>
            </>
          )
        ) : null}
      </Card>
    ) : null,

    waist: null,

    fasting: isToday && !maternal ? <FastingScheduleCard /> : null,

    mealplan: isToday ? <MealPlanEntry /> : null,

    ideas:
      data.ideas.length > 0 && !maternal ? (
        <View style={styles.ideasWrap}>
          <Text style={styles.ideasTitle}>{gain ? t("gain:today.ideasTitle") : t("ideas.title")}</Text>
          {gain ? <Text style={styles.mutedNote}>{t("gain:today.ideasHint")}</Text> : null}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.ideasRow}
          >
            {data.ideas.map((idea) => (
              <View key={idea.name} style={styles.ideaChip}>
                <Text style={styles.ideaChipName} numberOfLines={2}>
                  {idea.name}
                </Text>
                <MetaLine
                  items={[`${fmtInt(idea.kcal)} ${kcalUnit()}`, t("ideas.protein", { g: fmtInt(idea.proteinG) })]}
                  itemStyle={styles.ideaChipMeta}
                />
              </View>
            ))}
          </ScrollView>
        </View>
      ) : null,

    belanja: isToday ? <BelanjaCompact /> : null,

    joyofit: <JoyoFitCard />,

    tips: isToday && !maternal ? gain ? <GainDailyTip /> : <DailyTipCard /> : null,

    recap: isToday && !maternal ? <RecapCard /> : null,

    // Fact, share and badges (collapsed by default). Hamil / Menyusui has no water row in the stats list: its counter lives here.
    extras: maternal ? (
      <WaterCard date={date} />
    ) : (
      <>
        <SectionTitle
          title={t("more.sectionTitle")}
          action={{
            label: moreOpen ? t("more.hide") : t("more.show"),
            onPress: () => setMoreOpen((v) => !v),
          }}
        />
        {moreOpen ? (
          <>
            <ListGroup>
              <View style={styles.factBox}>
                <Text style={styles.factLabel}>{t("more.factLabel")}</Text>
                <Text style={styles.factText}>
                  {t("more.fact", { text: fact.text, kcal: fmtInt(fact.kcal), move: fact.move })}
                </Text>
              </View>
              <ListRow
                icon="share-social"
                iconTint="makan"
                title={t("more.shareRecap")}
                chevron
                onPress={() => void openRecapSticker()}
              />
            </ListGroup>
            {/* The streak count is the header chip; its badge would repeat the number. */}
            {data.milestones.some((badge) => badge.kind !== "streak") ? (
              <Card>
                <Text style={styles.milestoneTitle}>{t("more.badges")}</Text>
                <View style={styles.milestoneRow}>
                  {data.milestones
                    .filter((badge) => badge.kind !== "streak")
                    .map((badge) => (
                      <Pressable
                        key={`${badge.kind}-${badge.value}`}
                        accessibilityRole="button"
                        style={({ pressed }) => [styles.milestoneBadge, pressed && styles.pressedSoft]}
                        onPress={() => setWeightOpen(true)}
                      >
                        <Ionicons name="trophy" size={13} color={theme.colors.makanText} />
                        <Text style={styles.milestoneText}>
                          {badge.kind === "gained"
                            ? t("gain:milestone.gained", { kg: badge.value })
                            : t("milestone.lost", { kg: badge.value })}
                        </Text>
                      </Pressable>
                    ))}
                </View>
              </Card>
            ) : null}
          </>
        ) : (
          <Text style={styles.moreHint}>{t("more.hint")}</Text>
        )}
      </>
    ),

    promo:
      showFounderBanner && configData ? (
        <Card style={styles.founderBanner}>
          <Text style={styles.founderBannerText} numberOfLines={1}>
            {t("banner.scans", { n: configData.freeDailyScans })} ·{" "}
            {configData.founderDailyCap === null
              ? t("banner.proUnlimited")
              : t("banner.proCapped", { n: configData.founderDailyCap })}
          </Text>
          <Button
            size="sm"
            label={t("banner.upgrade")}
            onPress={() =>
              router.push({ pathname: "/founder", params: { from: "banner", next: "/" } })
            }
          />
        </Card>
      ) : null,
  };

  return (
    <Screen decorated refreshing={refreshing} onRefresh={() => void refreshAll()}>
      {/* Greeting + avatar → /profil */}
      <View style={styles.greetRow}>
        <View style={styles.greetText}>
          <Text style={styles.greetLead} numberOfLines={1}>
            {t("greeting.lead", { greeting: t(`greeting.${greetingKey(now)}`) })}
          </Text>
          <Text style={styles.greetTitle} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
            {firstName}
          </Text>
          <View style={styles.greetCaptionRow}>
            <Text style={styles.greetCaption}>{fmtDateMedium(today)}</Text>
            <ProChip />
          </View>
        </View>
        {maternal ? null : (
          <ShareStoryButton
            iconOnly
            label={t("header.share")}
            story={progressStory}
          />
        )}
        <AskJoyoHeaderButton />
        <Link href="/profil" asChild>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("header.openProfile", { name: displayName })}
            style={({ pressed }) => [pressed && styles.pressedSoft]}
          >
            <Avatar name={displayName} image={sessionData?.user.image ?? null} />
          </Pressable>
        </Link>
      </View>

      {/* Status chips under the greeting, so the name keeps the full width above. */}
      <View style={styles.chipRow}>
        {/* One streak, as the home-screen widget shows it: a lit flame with the run (hollow while today is still blank), or, once it broke, a cold flame with the days since the last log that opens the scan camera. */}
        {!maternal && data.streak && data.streak.status === "broken" ? (
          <Link href="/makan-ai" asChild>
            <Pressable
              accessibilityRole="button"
              style={({ pressed }) => [styles.streakChip, styles.streakChipCold, pressed && styles.pressedSoft]}
              accessibilityLabel={t(gain ? "header.streakLapseGainLabel" : "header.streakLapseLabel", {
                count: data.streak.lapseDays,
              })}
            >
              <Ionicons name="flame-outline" size={14} color={theme.colors.mutedForeground} />
              <Num style={[styles.streakChipText, styles.streakChipColdText]}>{data.streak.lapseDays}</Num>
            </Pressable>
          </Link>
        ) : !maternal && data.streakDays > 0 ? (
          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [styles.streakChip, pressed && styles.pressedSoft]}
            accessibilityLabel={
              data.streak?.status === "at_risk"
                ? t(gain ? "header.streakAtRiskGainLabel" : "header.streakAtRiskLabel", { count: data.streakDays })
                : gain
                  ? t("gain:today.streak", { count: data.streakDays })
                  : t("header.streakLabel", { count: data.streakDays })
            }
            onPress={() => setStreakOpen(true)}
          >
            <Ionicons
              name={data.streak?.status === "at_risk" ? "flame-outline" : "flame"}
              size={14}
              color={theme.colors.bakarText}
            />
            <Num style={styles.streakChipText}>{data.streakDays}</Num>
          </Pressable>
        ) : null}
        {badgesEarned === null ? null : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${t("badges:board.badgesTitle")}: ${t("badges:shelf.count", {
              earned: badgesEarned,
              total: badges.data?.badges.length ?? 0,
            })}`}
            style={({ pressed }) => [styles.badgeChip, pressed && styles.pressedSoft]}
            onPress={() => router.push("/profil/lencana")}
          >
            <Ionicons name="medal" size={14} color={theme.colors.makanText} />
            <Num style={styles.badgeChipText}>{badgesEarned}</Num>
          </Pressable>
        )}
        {/* While the calibration is still collecting: its short chip here instead of a line of its own. */}
        <CalibrationChip compact enabled={isToday && !maternal && checklist.settled && checklist.list === null} />
      </View>

      {/* Day switcher */}
      <DaySwitcher date={date} today={today} onChange={setDate} />

      {/* Free account that just hit a streak milestone: one Pro card, once per milestone */}
      {maternal ? null : <StreakNudge userId={sessionData?.user.id ?? null} streakDays={data.streakDays} />}

      {/* New account: the setup checklist. */}
      {isToday && checklist.list ? (
        <SetupChecklist
          list={checklist.list}
          dismiss={checklist.dismiss}
          weighedToday={data.weightLoggedToday}
          onWeigh={() => setWeighOpen(true)}
        />
      ) : null}

      {/* The cards, in the order this person arranged them (daily report first by default) */}
      {visibleHomeCards(cardPrefs).map((id) => (
        <Fragment key={id}>{cards[id]}</Fragment>
      ))}

      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={t("cards.link")}
        onPress={() => router.push("/profil/kartu-beranda")}
        scaleTo={1}
        dimTo={0.7}
        style={styles.arrangeLink}
      >
        <Ionicons name="options-outline" size={18} color={theme.colors.mutedForeground} />
        <Text style={styles.helpText}>{t("cards.link")}</Text>
      </PressableScale>

      <WeighInSheet visible={weighOpen} onClose={() => setWeighOpen(false)} date={date} />

      {/* Cara baca angka hari ini */}
      <Sheet visible={explainOpen} onClose={() => setExplainOpen(false)} title={t("explain.title")}>
        <View style={styles.explainBody}>
          <View style={styles.explainFormula}>
            <Text style={styles.explainFormulaText}>
              {gainLeft ? t("gain:nativeToday.explain.formula") : t("explain.formula")}
            </Text>
            <Num style={styles.explainExample}>
              {gainLeft
                ? gainLeft.state === "short"
                  ? t("gain:nativeToday.explain.example", {
                      target: fmtInt(data.targets.eatKcal),
                      eaten: fmtInt(data.eatenKcal),
                      left: fmtInt(gainLeft.kcal),
                    })
                  : t("gain:nativeToday.explain.exampleDone", {
                      target: fmtInt(data.targets.eatKcal),
                      eaten: fmtInt(data.eatenKcal),
                    })
                : data.targets.exerciseKcal > 0
                  ? over
                    ? t("explain.exampleAddOver", {
                        target: fmtInt(needs.targetKcal),
                        exercise: fmtInt(data.targets.exerciseKcal),
                        eaten: fmtInt(data.eatenKcal),
                        over: fmtInt(leftKcal),
                      })
                    : t("explain.exampleAdd", {
                        target: fmtInt(needs.targetKcal),
                        exercise: fmtInt(data.targets.exerciseKcal),
                        eaten: fmtInt(data.eatenKcal),
                        left: fmtInt(leftKcal),
                      })
                  : over
                    ? t("explain.exampleOver", {
                        target: fmtInt(data.targets.eatKcal),
                        eaten: fmtInt(data.eatenKcal),
                        over: fmtInt(leftKcal),
                      })
                    : t("explain.example", {
                        target: fmtInt(data.targets.eatKcal),
                        eaten: fmtInt(data.eatenKcal),
                        left: fmtInt(leftKcal),
                      })}
            </Num>
          </View>
          <View style={styles.explainItem}>
            <Text style={styles.explainTitle}>{t("explain.sum.title")}</Text>
            {sumRows.map((row) =>
              row.value === null ? (
                <Text key={row.key} style={styles.mutedNote}>
                  {row.label}
                </Text>
              ) : (
                <View key={row.key} style={styles.sumRow}>
                  <View style={styles.sumLabel}>
                    <Text style={row.strong ? styles.sumLabelStrong : styles.mutedNote}>{row.label}</Text>
                    {row.sub ? <Text style={styles.sumSub}>{row.sub}</Text> : null}
                  </View>
                  <Num style={row.strong ? styles.sumValueStrong : styles.sumValue}>{row.value}</Num>
                </View>
              ),
            )}
          </View>
          {(["target", "eaten", "left"] as const).map((key) => (
            <View key={key} style={styles.explainItem}>
              <Text style={styles.explainTitle}>
                {gainLeft && key === "left"
                  ? t("gain:nativeToday.explain.leftTitle")
                  : t(`explain.${key}.title`)}
              </Text>
              <Text style={styles.mutedNote}>
                {gainLeft && key === "left"
                  ? t("gain:nativeToday.explain.leftBody")
                  : t(`explain.${key}.body`)}
              </Text>
              {key === "target" && data.targets.datePace ? (
                <Text style={styles.mutedNote}>
                  {t(`explain.clamped.${datePaceExplainKey(data.targets.datePace)}`, {
                    date: fmtDateMedium(data.targets.datePace.reachDate),
                  })}
                </Text>
              ) : null}
            </View>
          ))}
          <MacroTargetsExplain
            gain={gain !== null}
            targets={{
              proteinG: data.protein?.targetG ?? null,
              carbsG: data.macros?.carbsTargetG ?? null,
              fatG: data.macros?.fatTargetG ?? null,
              fiberG: data.macros?.fiberTargetG ?? null,
            }}
          />
          <View style={styles.explainItem}>
            <Text style={styles.explainTitle}>{t("explain.burn.title")}</Text>
            <Text style={styles.mutedNote}>{t("explain.burn.body", { pct: credit?.pct ?? DEFAULT_ADD_BACK_SETTINGS.pct })}</Text>
          </View>
          {credit ? (
            <View style={styles.explainItem}>
              <Text style={styles.explainTitle}>{t("explain.addBack.title")}</Text>
              {!credit.enabled ? <Text style={styles.mutedNote}>{t("explain.addBack.off")}</Text> : null}
              {credit.activeKcal === 0 ? (
                <Text style={styles.mutedNote}>{t("explain.addBack.none")}</Text>
              ) : null}
              {credit.countedKcal > 0 ? (
                <Text style={styles.mutedNote}>
                  {t("explain.addBack.body", {
                    active: fmtInt(credit.activeKcal),
                    included: fmtInt(credit.includedKcal),
                    extra: fmtInt(credit.extraKcal),
                    pct: credit.pct,
                    kcal: fmtInt(credit.countedKcal),
                  })}
                </Text>
              ) : null}
              {credit.enabled && credit.activeKcal > 0 && credit.extraKcal === 0 ? (
                <Text style={styles.mutedNote}>
                  {t("explain.addBack.below", {
                    active: fmtInt(credit.activeKcal),
                    included: fmtInt(credit.includedKcal),
                  })}
                </Text>
              ) : null}
              {credit.allDaySource === "joyofit" ? (
                <Text style={styles.mutedNote}>
                  {t("explain.addBack.watch", { kcal: fmtInt(credit.allDayKcal ?? 0) })}
                </Text>
              ) : null}
              {credit.allDaySource === "health_connect" || credit.allDaySource === "apple_health" ? (
                <Text style={styles.mutedNote}>
                  {t("explain.addBack.healthStore", {
                    source: t(`tile.source.${credit.allDaySource}`),
                    kcal: fmtInt(credit.allDayKcal ?? 0),
                  })}
                </Text>
              ) : null}
              {credit.otherWorkoutKcal > 0 ? (
                <Text style={styles.mutedNote}>
                  {t("explain.addBack.other", { kcal: fmtInt(credit.otherWorkoutKcal) })}
                </Text>
              ) : null}
              {credit.capped ? (
                <Text style={styles.mutedNote}>
                  {t("explain.addBack.capped", { cap: credit.cap === "none" ? "" : fmtInt(credit.cap) })}
                </Text>
              ) : null}
            </View>
          ) : null}
          <View style={styles.explainItem}>
            <Text style={styles.explainTitle}>
              {gain ? t("gain:coach.surplusExplainer.title") : t("explain.deficit.title")}
            </Text>
            <Text style={styles.mutedNote}>
              {gain
                ? t("gain:coach.surplusExplainer.body")
                : maintenance
                  ? t("explain.deficit.bodyMaintenance")
                  : t("explain.deficit.body", { kcal: fmtInt(data.targets.deficitKcal) })}
            </Text>
          </View>
          <ListGroup>
            <ListRow
              icon="flame"
              iconTint="bakar"
              title={t("explain.addBack.setting")}
              wrapTitle
              chevron
              onPress={() => {
                setExplainOpen(false);
                router.push("/profil/target");
              }}
            />
          </ListGroup>
          <ListGroup>
            <ListRow
              icon="flash"
              iconTint="makan"
              title={t("explain.needs")}
              wrapTitle
              chevron
              onPress={() => {
                setExplainOpen(false);
                router.push({ pathname: "/profil", params: { needs: "1" } });
              }}
            />
          </ListGroup>
        </View>
      </Sheet>

      {/* Stiker penuh dari Diari piring */}
      <StickerViewer viewer={viewer} onClose={() => setViewer(null)} />

      {/* Streak dan rekap mingguan: lembar bagikan terbuka langsung di jenis yang dituju */}
      <StoryShareSheet story={progressStory} open={streakOpen} onClose={() => setStreakOpen(false)} initialKind="streak" />
      <StoryShareSheet story={progressStory} open={weightOpen} onClose={() => setWeightOpen(false)} initialKind="weight" />
      {recapStory ? (
        <StoryShareSheet story={recapStory} open onClose={() => setRecapStory(null)} initialKind="week" />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create((theme) => ({
  pressedSoft: {
    opacity: 0.7,
  },
  greetRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    marginTop: theme.spacing.sm,
  },
  chipRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
  },
  founderBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: theme.colors.makanSoft,
  },
  founderBannerText: {
    flex: 1,
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    color: theme.colors.makanText,
  },
  greetText: {
    flex: 1,
    gap: 2,
  },
  greetLead: {
    fontSize: theme.fontSize.base,
    fontWeight: "600",
    color: theme.colors.mutedForeground,
  },
  greetTitle: {
    fontSize: theme.fontSize["2xl"],
    fontWeight: "800",
    letterSpacing: -0.5,
    color: theme.colors.foreground,
  },
  greetCaptionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
  },
  greetCaption: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
  },
  heroCard: {
    paddingVertical: theme.spacing.lg,
  },
  macroRow: {
    flexDirection: "row",
    gap: theme.spacing.md,
    paddingTop: theme.spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.hairline,
  },
  macroStat: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  macroStatLabel: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  macroStatName: {
    flexShrink: 1,
    fontSize: theme.fontSize.xs,
    fontWeight: "600",
    color: theme.colors.mutedForeground,
  },
  macroStatValue: {
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  macroStatTrack: {
    height: 4,
    borderRadius: 2,
    overflow: "hidden",
    backgroundColor: theme.colors.muted,
  },
  macroStatFill: {
    height: "100%",
    borderRadius: 2,
    backgroundColor: theme.colors.makan,
  },
  // Same footprint as the chevron on the other rows; hitSlop makes the touch target 44px.
  addWater: {
    width: 16,
    height: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  arrangeLink: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    minHeight: 44,
  },
  heroRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.lg,
  },
  heroLabel: {
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    color: theme.colors.mutedForeground,
  },
  heroNumber: {
    fontSize: 36,
    fontWeight: "800",
    letterSpacing: -1,
    color: theme.colors.foreground,
  },
  heroStats: {
    flex: 1,
    minWidth: 0,
    gap: theme.spacing.sm,
  },
  heroStat: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: theme.spacing.sm,
  },
  heroStatMid: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.muted,
    paddingVertical: theme.spacing.sm,
  },
  heroStatLabel: {
    flexShrink: 1,
    fontSize: theme.fontSize.xs,
    fontWeight: "600",
    color: theme.colors.mutedForeground,
  },
  heroStatValue: {
    flexShrink: 1,
    fontSize: theme.fontSize.title,
    fontWeight: "800",
    color: theme.colors.foreground,
  },
  helpButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 44,
  },
  explainFormula: {
    gap: theme.spacing.xs,
    padding: theme.spacing.md,
    borderRadius: theme.radius.tile,
    backgroundColor: theme.colors.makanSoft,
  },
  explainFormulaText: {
    fontSize: theme.fontSize.base,
    fontWeight: "800",
    color: theme.colors.makanText,
  },
  explainExample: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.makanText,
  },
  explainItem: {
    gap: 2,
  },
  explainTitle: {
    fontSize: theme.fontSize.base,
    fontWeight: "700",
  },
  sumRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: theme.spacing.md,
    paddingVertical: 3,
  },
  sumLabel: {
    flex: 1,
    gap: 1,
  },
  sumLabelStrong: {
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  sumSub: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.mutedForeground,
  },
  sumValue: {
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    color: theme.colors.foreground,
  },
  sumValueStrong: {
    fontSize: theme.fontSize.base,
    fontWeight: "800",
    color: theme.colors.foreground,
  },
  helpText: {
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    color: theme.colors.mutedForeground,
  },
  streakChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: theme.colors.bakarSoft,
    borderRadius: theme.radius.pill,
    paddingHorizontal: 12,
    height: 40,
  },
  badgeChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: theme.colors.makanSoft,
    borderRadius: theme.radius.pill,
    paddingHorizontal: 12,
    height: 40,
  },
  badgeChipText: {
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
    color: theme.colors.makanText,
  },
  streakChipText: {
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
    color: theme.colors.bakarText,
  },
  streakChipCold: {
    backgroundColor: theme.colors.muted,
  },
  streakChipColdText: {
    color: theme.colors.mutedForeground,
  },
  heroNote: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.bakarText,
    textAlign: "center",
    lineHeight: 20,
  },
  gainNote: {
    alignItems: "center",
    gap: 2,
  },
  gainStatus: {
    fontSize: theme.fontSize.base,
    fontWeight: "700",
    color: theme.colors.foreground,
    textAlign: "center",
  },
  gainHint: {
    fontSize: theme.fontSize.sm,
    lineHeight: 19,
    color: theme.colors.mutedForeground,
    textAlign: "center",
  },
  tileRow: {
    flexDirection: "row",
    gap: theme.spacing.md,
  },
  ideasWrap: {
    gap: theme.spacing.sm,
  },
  ideasTitle: {
    fontSize: theme.fontSize.md,
    fontWeight: "700",
    color: theme.colors.foreground,
    marginTop: theme.spacing.sm,
  },
  ideasRow: {
    gap: theme.spacing.sm,
    paddingRight: theme.spacing.lg,
  },
  ideaChip: {
    backgroundColor: theme.colors.makanSoft,
    borderRadius: theme.radius.tile,
    paddingHorizontal: 14,
    paddingVertical: 10,
    width: 176,
    justifyContent: "center",
  },
  ideaChipName: {
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    lineHeight: 18,
    color: theme.colors.foreground,
  },
  ideaChipMeta: {
    fontSize: theme.fontSize.xs,
    fontWeight: "600",
    marginTop: 4,
    color: theme.colors.makanText,
  },
  platesWrap: {
    gap: theme.spacing.sm,
  },
  platesRow: {
    gap: theme.spacing.md,
    paddingRight: theme.spacing.lg,
  },
  plateCard: {
    width: 112,
    alignItems: "center",
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.tile,
    padding: theme.spacing.sm,
    gap: 4,
  },
  plateName: {
    fontSize: theme.fontSize.xs,
    fontWeight: "600",
    color: theme.colors.foreground,
    maxWidth: "100%",
  },
  plateKcal: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.mutedForeground,
  },
  factBox: {
    backgroundColor: theme.colors.muted,
    borderRadius: theme.radius.tile,
    padding: theme.spacing.md,
    gap: 4,
  },
  factLabel: {
    fontSize: theme.fontSize.xs,
    fontWeight: "600",
    color: theme.colors.mutedForeground,
  },
  factText: {
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    lineHeight: 20,
    color: theme.colors.foreground,
  },
  explainBody: {
    gap: theme.spacing.md,
  },
  mutedNote: {
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
    color: theme.colors.mutedForeground,
  },
  trendHead: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: theme.spacing.md,
  },
  trendLabel: {
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    color: theme.colors.mutedForeground,
  },
  trendValueRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 4,
  },
  trendValue: {
    fontSize: 34,
    fontWeight: "800",
    letterSpacing: -0.5,
    color: theme.colors.foreground,
  },
  trendUnit: {
    fontSize: theme.fontSize.base,
    color: theme.colors.mutedForeground,
  },
  trendRate: {
    alignItems: "flex-end",
    gap: 2,
    backgroundColor: theme.colors.makanSoft,
    borderRadius: theme.radius.tile,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  trendRateValue: {
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
    color: theme.colors.makanText,
  },
  trendRange: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.mutedForeground,
    textAlign: "center",
  },
  trendRateSub: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.makanText,
  },
  sparkBox: {
    maxWidth: 300,
    width: "100%",
    alignSelf: "center",
  },
  trendNote: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
    lineHeight: 20,
  },
  milestoneTitle: {
    fontSize: theme.fontSize.base,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  milestoneRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing.sm,
  },
  milestoneBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: theme.colors.makanSoft,
    borderRadius: theme.radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  milestoneText: {
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    color: theme.colors.makanText,
  },
  moreHint: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
  },
}));
