import "@/unistyles";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { Trans, useTranslation } from "react-i18next";
import { Link, Redirect, router } from "expo-router";
import { Dimensions, Platform, Pressable, Share, ScrollView, View } from "react-native";
import { useEffect, useState } from "react";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Circle, Polyline, Svg } from "react-native-svg";

import {
  eatTone,
  effectiveRamadan,
  jakartaToday,
  MEAL_LABELS,
  relativeDayLabel,
  remainingKcal,
  slotsFor,
} from "@joyorogo/api/lib/engine";
import type { Meal } from "@joyorogo/api/lib/engine";
import { pickFact } from "@joyorogo/api/lib/facts";

import { BelanjaCompact } from "@/components/plate/belanja";
import { DaySwitcher } from "@/components/day-switcher";
import { RecapCard } from "@/components/recap-card";
import { MaternalCard } from "@/components/maternal/maternal-card";
import { StravaRetentionNotice } from "@/components/strava-retention-notice";
import { useAppConfig } from "@/components/billing";
import { FoodSticker, StickerViewer, stickerUrl } from "@/components/sticker";
import type { StickerViewerTarget } from "@/components/sticker";
import { ShareStoryButton } from "@/components/story/share-story-button";
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
  StatTile,
  Text,
} from "@/components/ui";
import { MetaLine } from "@/components/meta-line";
import { PressableScale, Reveal } from "@/components/motion";
import { WaterCard, useWater } from "@/components/water-card";
import { FastingScheduleCard } from "@/components/fasting/schedule-card";
import { DailyTipCard } from "@/components/tips/daily-tip-card";
import { WeighInSheet } from "@/components/weigh-in-sheet";
import { WorkoutCard } from "@/components/workout/workout-card";
import { authClient } from "@/lib/auth-client";
import { useSessionGate } from "@/lib/use-session-gate";
import { pushDaySnapshot } from "@/src/lib/widgets/push";
import { useHealthAutoSync } from "@/src/lib/use-health-sync";
import { errorMessage, fmtDateMedium, fmtInt, fmtKg, weeklyRateLabel } from "@/utils/format";
import { orpc } from "@/utils/orpc";

type TrendPoint = { date: string; weightKg: number; trendKg: number };

type PlateItem = {
  id: string;
  name: string;
  kcal: number;
  scanId: string | null;
  photoId?: string | null;
};

function greetingKey(date: Date): "morning" | "noon" | "afternoon" | "evening" {
  const h = Number(
    new Intl.DateTimeFormat("en", {
      hour: "numeric",
      hour12: false,
      timeZone: "Asia/Jakarta",
    }).format(date),
  );
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

export default function Dashboard() {
  const { theme } = useUnistyles();
  const { t } = useTranslation(["home", "common", "berat", "maternal"]);
  const gate = useSessionGate();
  const today = jakartaToday();
  const [date, setDate] = useState(today);
  const isToday = date === today;
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
    orpc.food.listByDate.queryOptions({ input: { date: summary.data?.date ?? jakartaToday() } }),
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
    // Widgets describe the live day; skip while a past day is on screen.
    if (gate !== "authed" || !summaryData?.hasProfile || !summaryData.targets) return;
    if (summaryData.date !== today) return;
    void pushDaySnapshot(
      {
        date: summaryData.date,
        eatenKcal: summaryData.eatenKcal,
        eatKcal: summaryData.targets.eatKcal,
        proteinEatenG: summaryData.protein?.eatenG ?? null,
        proteinTargetG: summaryData.protein?.targetG ?? null,
        streakDays: summaryData.streakDays,
        maternal: summaryData.targets.maternal != null,
      },
      // undefined (query pending) keeps the snapshot's current IF line so it
      // doesn't flicker off; null clears it when IF is off or Ramadan owns the day.
      fastingData?.active && fastingData.state && fastingData.windowOpen && fastingData.windowClose
        ? {
            state: fastingData.state,
            windowOpen: fastingData.windowOpen,
            windowClose: fastingData.windowClose,
            remainingKcal: fastingData.remainingKcal,
          }
        : fastingData === undefined
          ? undefined
          : null,
    );
  }, [gate, summaryData, fastingData, today]);

  const [weighOpen, setWeighOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [adaptiveOpen, setAdaptiveOpen] = useState(false);
  const [explainOpen, setExplainOpen] = useState(false);
  const [viewer, setViewer] = useState<StickerViewerTarget | null>(null);

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
  // Hamil / Menyusui: a need to meet, never a budget to stay under.
  const { kcal: leftKcal, over: overBudget } = remainingKcal(data.targets.eatKcal, data.eatenKcal);
  const over = maternal ? false : overBudget;
  const tone = maternal ? "ok" : eatTone(data.eatenKcal, data.targets.eatKcal);
  const ringColor = {
    ok: theme.colors.makan,
    near: theme.colors.eatNear,
    over: theme.colors.destructive,
  }[tone];
  const maintenance = data.targets.notes?.includes("MAINTENANCE") || data.targets.deficitKcal === 0;
  const adaptive = data.targets.notes?.includes("ADAPTIVE") ?? false;
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

  return (
    <Screen>
      {/* Greeting + avatar → /profil */}
      <View style={styles.greetRow}>
        <View style={styles.greetText}>
          <Text style={styles.greetTitle}>
            {t("greeting.named", {
              greeting: t(`greeting.${greetingKey(new Date())}`),
              name: firstName,
            })}
          </Text>
          <Text style={styles.greetCaption}>{fmtDateMedium(jakartaToday())}</Text>
        </View>
        {!maternal && data.streakDays > 0 ? (
          <View
            style={styles.streakChip}
            accessibilityLabel={t("header.streakLabel", { count: data.streakDays })}
          >
            <Ionicons name="flame" size={14} color={theme.colors.bakarText} />
            <Num style={styles.streakChipText}>{data.streakDays}</Num>
          </View>
        ) : null}
        {maternal ? null : (
          <ShareStoryButton
            iconOnly
            label={t("header.share")}
            story={{
              kind: "progress",
              eatenKcal: data.eatenKcal,
              targetKcal: data.targets.eatKcal,
              proteinG: data.protein?.eatenG ?? null,
              proteinTargetG: data.protein?.targetG ?? null,
              streakDays: data.streakDays,
              weightLostKg: data.weightLostKg,
              weekTrend: data.weekTrend,
            }}
          />
        )}
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

      {/* Day switcher */}
      <DaySwitcher date={date} onChange={setDate} />

      {/* Monday only: recap of the week that just ended */}
      {isToday && !maternal ? <RecapCard /> : null}

      <StravaRetentionNotice />

      {/* Pro banner: kuota gratis vs Pro, ketuk Upgrade → paywall */}
      {showFounderBanner && configData ? (
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
      ) : null}

      {/* Hero: sisa makan di ring + tiga angka di sebelahnya */}
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
                {maternal ? t("maternal:target.eaten") : over ? t("eat.over") : t("eat.left")}
              </Text>
              <CountNum
                value={maternal ? data.eatenKcal : leftKcal}
                style={[styles.heroNumber, over && { color: theme.colors.bakarText }]}
                adjustsFontSizeToFit
                numberOfLines={1}
              />
              <Text style={styles.heroLabel}>kcal</Text>
            </Ring>
            <View style={styles.heroStats}>
              <View style={styles.heroStat}>
                <Text style={styles.heroStatLabel}>{maternal ? t("maternal:target.total") : t("eat.target")}</Text>
                <CountNum value={data.targets.eatKcal} style={styles.heroStatValue} />
              </View>
              {maternal ? (
                <Text style={styles.adaptiveText}>
                  {t("maternal:target.progress", {
                    pct: Math.round((data.eatenKcal / Math.max(data.targets.eatKcal, 1)) * 100),
                  })}
                </Text>
              ) : (
                <View style={[styles.heroStat, styles.heroStatMid]}>
                  <Text style={styles.heroStatLabel}>{t("eat.eaten")}</Text>
                  <CountNum value={data.eatenKcal} style={styles.heroStatValue} />
                </View>
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
                <Text style={styles.adaptiveText} numberOfLines={1}>
                  {t("eat.help")}
                </Text>
              </PressableScale>
            </View>
          </View>
          {adaptive ? (
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel={t("adaptive.info")}
              onPress={() => setAdaptiveOpen(true)}
              scaleTo={1}
              dimTo={0.7}
              style={styles.adaptiveRow}
            >
              <Ionicons name="information-circle" size={14} color={theme.colors.mutedForeground} />
              <Text style={styles.adaptiveText}>{t("adaptive.link")}</Text>
            </PressableScale>
          ) : null}
          {over ? (
            <Text style={styles.heroNote}>{t("eat.overNote", { kcal: fmtInt(leftKcal) })}</Text>
          ) : null}
          {maternal && data.eatenKcal >= data.targets.eatKcal ? (
            <Text style={styles.heroNote}>{t("maternal:target.reached")}</Text>
          ) : null}
        </Card>
      </Reveal>

      {maternal ? (
        <MaternalCard
          info={maternal}
          proteinG={data.protein?.eatenG ?? null}
          fiberG={foods.data?.totals.fiber ?? null}
          waterGlasses={water.glasses}
          waterGoal={water.goal}
          caffeine={data.maternal?.caffeine ?? null}
        />
      ) : null}

      {/* Angka harian: bakar, tidur, protein */}
      <Reveal index={1} style={styles.tileRow}>
        {maternal ? null : (
          <StatTile
            icon="flame"
            tint="bakar"
            label={t("tile.burn")}
            value={fmtInt(data.burnedKcal)}
            count={data.burnedKcal}
            sub={t("tile.burnOf", { kcal: fmtInt(data.targets.burnKcal) })}
            onPress={() => router.navigate("/olahraga")}
          />
        )}
        <StatTile
          icon="moon"
          tint="tidur"
          label={t("tile.sleep")}
          value={data.sleepHoursLastNight !== null ? fmtKg(data.sleepHoursLastNight) : "–"}
          sub={
            data.sleepHoursLastNight !== null
              ? t("tile.sleepNeed", { hours: fmtKg(data.targets.sleepHours) })
              : t("tile.sleepNone")
          }
          onPress={() => router.navigate("/tidur")}
        />
        <StatTile
          macro="protein"
          tint="makan"
          label={t("tile.protein")}
          value={data.protein ? `${fmtInt(data.protein.eatenG)}g` : "–"}
          count={data.protein ? data.protein.eatenG : undefined}
          countSuffix="g"
          sub={
            data.protein
              ? t("tile.proteinOf", { g: fmtInt(data.protein.targetG) })
              : t("tile.proteinNone")
          }
          onPress={() => router.navigate("/makan")}
        />
      </Reveal>

      {/* Air (ketuk = +1 gelas) dan berat tren */}
      <Reveal index={2} style={styles.tileRow}>
        <StatTile
          icon="water"
          tint="tidur"
          label={t("tile.water")}
          value={String(water.glasses)}
          count={water.glasses}
          sub={t("water.ofGoal", { count: water.goal })}
          onPress={water.add}
        />
        <StatTile
          icon="scale-outline"
          tint="makan"
          label={t("tile.weight")}
          value={data.trend ? fmtKg(data.trend.weightKg) : data.latestWeightKg !== null ? fmtKg(data.latestWeightKg) : "–"}
          sub={
            maternal
              ? data.latestWeightKg !== null
                ? undefined
                : t("tile.weightNone")
              : data.trend?.weeklyRateKg != null
                ? weeklyRateLabel(data.trend.weeklyRateKg)
                : t("tile.weightNone")
          }
          onPress={() => router.navigate("/berat")}
        />
      </Reveal>

      {/* Latihan beban: peringatan otot terlewat + pintu ke /latihan */}
      <WorkoutCard />

      {/* Belanja makan hari ini, satu baris — angkanya selalu hari ini */}
      {isToday ? <BelanjaCompact /> : null}

      {/* Masih muat: ide menu yang masih muat di sisa budget */}
      {data.ideas.length > 0 && !maternal ? (
        <View style={styles.ideasWrap}>
          <Text style={styles.ideasTitle}>{t("ideas.title")}</Text>
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
                  items={[`${fmtInt(idea.kcal)} kcal`, t("ideas.protein", { g: fmtInt(idea.proteinG) })]}
                  itemStyle={styles.ideaChipMeta}
                />
              </View>
            ))}
          </ScrollView>
        </View>
      ) : null}

      {/* Makan hari ini per slot */}
      <SectionTitle
        title={
          isToday ? t("meals.title") : t("meals.titleDay", { day: relativeDayLabel(date, today) })
        }
        action={{ label: t("meals.all"), onPress: () => router.navigate("/makan") }}
      />
      <Reveal index={3}>
        <ListGroup>
          {slots.map((slot) => {
            const kcal = data.eatenByMeal[slot] ?? 0;
            return (
              <ListRow
                key={slot}
                title={MEAL_LABELS[slot]}
                subtitle={kcal > 0 ? undefined : t("meals.empty")}
                value={kcal > 0 ? `${fmtInt(kcal)} kcal` : undefined}
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
                  onPress={() =>
                    setViewer({
                      uri: stickerUrl(item.scanId),
                      name: item.name,
                      kcal: item.kcal,
                      photoId: item.photoId,
                    })
                  }
                />
                <Text style={styles.plateName} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={styles.plateKcal}>{fmtInt(item.kcal)} kcal</Text>
              </Reveal>
            ))}
          </ScrollView>
        </View>
      ) : null}

      {/* Tren berat + timbang inline */}
      {data.trend ? (
        <Card>
          <View style={styles.trendHead}>
            <View>
              <Text style={styles.trendLabel}>{t("weight.trend")}</Text>
              <View style={styles.trendValueRow}>
                <Num style={styles.trendValue}>{fmtKg(data.trend.weightKg)}</Num>
                <Text style={styles.trendUnit}>kg</Text>
              </View>
            </View>
            {data.trend.weeklyRateKg !== null ? (
              <View style={styles.trendRate}>
                <Text style={styles.trendRateValue}>
                  {weeklyRateLabel(data.trend.weeklyRateKg)}
                </Text>
                {data.trend.projectedDate ? (
                  <Text style={styles.trendRateSub}>
                    {t("weight.projectedShort", { date: fmtDateMedium(data.trend.projectedDate) })}
                  </Text>
                ) : null}
              </View>
            ) : null}
          </View>
          {trendPoints.length > 1 ? <TrendSpark points={trendPoints} /> : null}
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
      ) : null}

      {/* Puasa intermiten: panduan jadwal makan — timer hidup hanya ada hari ini */}
      {isToday && !maternal ? <FastingScheduleCard /> : null}

      {/* Tips hari ini: artikel berbasis bukti (fat-loss), tidak untuk Hamil / Menyusui */}
      {isToday && !maternal ? <DailyTipCard /> : null}

      {maternal ? (
        <WaterCard date={date} />
      ) : (
        <>
      {/* Lainnya: air, streak, lencana, share — collapsed by default */}
      <SectionTitle
        title={t("more.sectionTitle")}
        action={{
          label: moreOpen ? t("more.hide") : t("more.show"),
          onPress: () => setMoreOpen((v) => !v),
        }}
      />
      {moreOpen ? (
        <>
          <WaterCard date={date} />
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
              onPress={() => shareRecap()}
            />
          </ListGroup>
          {data.milestones.length > 0 ? (
            <Card>
              <Text style={styles.milestoneTitle}>{t("more.badges")}</Text>
              <View style={styles.milestoneRow}>
                {data.milestones.map((badge) => (
                  <View key={`${badge.kind}-${badge.value}`} style={styles.milestoneBadge}>
                    <Ionicons name="trophy" size={13} color={theme.colors.makanText} />
                    <Text style={styles.milestoneText}>
                      {badge.kind === "streak"
                        ? t("milestone.streak", { days: badge.value })
                        : t("milestone.lost", { kg: badge.value })}
                    </Text>
                  </View>
                ))}
              </View>
            </Card>
          ) : null}
        </>
      ) : (
        <Text style={styles.moreHint}>{t("more.hint")}</Text>
      )}
        </>
      )}

      <WeighInSheet visible={weighOpen} onClose={() => setWeighOpen(false)} date={date} />

      {/* Info target adaptif */}
      <Sheet visible={adaptiveOpen} onClose={() => setAdaptiveOpen(false)} title={t("adaptive.title")}>
        <View style={styles.adaptiveBody}>
          <Text style={styles.adaptivePara}>
            <Trans
              ns="home"
              i18nKey="adaptive.formula"
              values={{ kcal: fmtInt(data.targets.formulaTdee) }}
              components={{ b: <Num style={styles.adaptiveStrong} /> }}
            />
          </Text>
          <Text style={styles.adaptivePara}>
            <Trans
              ns="home"
              i18nKey="adaptive.actual"
              values={{ kcal: fmtInt(data.targets.tdee) }}
              components={{ b: <Num style={styles.adaptiveStrong} /> }}
            />
          </Text>
          <Text style={styles.adaptiveMuted}>{t("adaptive.limit")}</Text>
        </View>
      </Sheet>

      {/* Cara baca angka hari ini */}
      <Sheet visible={explainOpen} onClose={() => setExplainOpen(false)} title={t("explain.title")}>
        <View style={styles.adaptiveBody}>
          <View style={styles.explainFormula}>
            <Text style={styles.explainFormulaText}>{t("explain.formula")}</Text>
            <Num style={styles.explainExample}>
              {over
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
          {(["target", "eaten", "left", "burn"] as const).map((key) => (
            <View key={key} style={styles.explainItem}>
              <Text style={styles.explainTitle}>{t(`explain.${key}.title`)}</Text>
              <Text style={styles.adaptiveMuted}>{t(`explain.${key}.body`)}</Text>
            </View>
          ))}
          <View style={styles.explainItem}>
            <Text style={styles.explainTitle}>{t("explain.deficit.title")}</Text>
            <Text style={styles.adaptiveMuted}>
              {maintenance
                ? t("explain.deficit.bodyMaintenance")
                : t("explain.deficit.body", { kcal: fmtInt(data.targets.deficitKcal) })}
            </Text>
          </View>
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
  greetTitle: {
    fontSize: theme.fontSize.title,
    fontWeight: "800",
    letterSpacing: -0.5,
    color: theme.colors.foreground,
  },
  greetCaption: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
  },
  heroCard: {
    paddingVertical: theme.spacing.lg,
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
    fontSize: theme.fontSize.xs,
    fontWeight: "600",
    color: theme.colors.mutedForeground,
  },
  heroStatValue: {
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
  adaptiveRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    minHeight: 44,
    paddingHorizontal: theme.spacing.md,
    borderRadius: theme.radius.pill,
  },
  adaptiveText: {
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
  streakChipText: {
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
    color: theme.colors.bakarText,
  },
  heroNote: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.bakarText,
    textAlign: "center",
    lineHeight: 20,
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
  adaptiveBody: {
    gap: theme.spacing.md,
  },
  adaptivePara: {
    fontSize: theme.fontSize.base,
    lineHeight: 24,
    color: theme.colors.foreground,
  },
  adaptiveStrong: {
    fontWeight: "800",
    color: theme.colors.foreground,
  },
  adaptiveMuted: {
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
