import "@/unistyles";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
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
  slotsFor,
} from "@joyorogo/api/lib/engine";
import type { Meal } from "@joyorogo/api/lib/engine";
import { pickFact } from "@joyorogo/api/lib/facts";

import { BelanjaCompact } from "@/components/plate/belanja";
import { DaySwitcher } from "@/components/day-switcher";
import { RecapCard } from "@/components/recap-card";
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
import { WaterCard } from "@/components/water-card";
import { FastingScheduleCard } from "@/components/fasting/schedule-card";
import { DailyTipCard } from "@/components/tips/daily-tip-card";
import { WeighInSheet } from "@/components/weigh-in-sheet";
import { WorkoutCard } from "@/components/workout/workout-card";
import { authClient } from "@/lib/auth-client";
import { useSessionGate } from "@/lib/use-session-gate";
import { pushDaySnapshot } from "@/src/lib/widgets/push";
import { useHealthAutoSync } from "@/src/lib/use-health-sync";
import { errorMessage, fmtDateId, fmtKcal, fmtKg, weeklyRateLabel } from "@/utils/format";
import { orpc } from "@/utils/orpc";

type TrendPoint = { date: string; weightKg: number; trendKg: number };

type PlateItem = {
  id: string;
  name: string;
  kcal: number;
  scanId: string | null;
  photoId?: string | null;
};

function greetingId(date: Date): string {
  const h = Number(
    new Intl.DateTimeFormat("en", {
      hour: "numeric",
      hour12: false,
      timeZone: "Asia/Jakarta",
    }).format(date),
  );
  if (h >= 4 && h < 11) return "Selamat pagi";
  if (h >= 11 && h < 15) return "Selamat siang";
  if (h >= 15 && h < 18) return "Selamat sore";
  return "Selamat malam";
}

/** Trend line (smoothed) over raw scale dots — answers "ke mana arahku?". */
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

  const over = data.eatenKcal > data.targets.eatKcal;
  const tone = eatTone(data.eatenKcal, data.targets.eatKcal);
  const ringColor = {
    ok: theme.colors.makan,
    near: theme.colors.eatNear,
    over: theme.colors.destructive,
  }[tone];
  const deficitKcal = data.deficit?.deficitKcal ?? null;
  const adaptive = data.targets.notes?.includes("ADAPTIVE") ?? false;
  const plates = (foods.data?.items ?? []).filter((item) => item.scanId != null) as Array<
    PlateItem & { scanId: string }
  >;
  const fact = pickFact(data.date);
  const displayName = sessionData?.user.name ?? "Kamu";
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
      "Ringkasan Minggu Ini",
      `Defisit: ${fmtKcal(data.deficit.deficitKcal)} kkal`,
      `Streak: ${data.streakDays} hari`,
      `Rata-rata makan: ${fmtKcal(Math.round(data.weekEatenKcal / 7))} kkal/hari`,
      `Tren berat: ${pts.map((t) => t.weightKg.toFixed(1) + "kg").join(" → ")}`,
      `Dibuat dengan JoyoRogo: ${shareUrl("/", "recap")}`,
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
            {greetingId(new Date())}, {firstName}
          </Text>
          <Text style={styles.greetCaption}>{fmtDateId(jakartaToday())}</Text>
        </View>
        {data.streakDays > 0 ? (
          <View
            style={styles.streakChip}
            accessibilityLabel={`Streak catat ${data.streakDays} hari beruntun`}
          >
            <Ionicons name="flame" size={14} color={theme.colors.bakarText} />
            <Num style={styles.streakChipText}>{data.streakDays}</Num>
          </View>
        ) : null}
        <Link href="/profil" asChild>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Buka profil ${displayName}`}
            style={({ pressed }) => [pressed && styles.pressedSoft]}
          >
            <Avatar name={displayName} image={sessionData?.user.image ?? null} />
          </Pressable>
        </Link>
      </View>

      {/* Day switcher */}
      <DaySwitcher date={date} onChange={setDate} />

      {/* Monday only: recap of the week that just ended */}
      {isToday ? <RecapCard /> : null}

      {/* Founder banner: kuota gratis vs Founder, ketuk Upgrade → paywall */}
      {showFounderBanner && configData ? (
        <Card style={styles.founderBanner}>
          <Text style={styles.founderBannerText} numberOfLines={1}>
            Scan AI {configData.freeDailyScans}x/hari ·{" "}
            {configData.founderDailyCap === null
              ? "Founder tanpa batas"
              : `Founder ${configData.founderDailyCap}/hari`}
          </Text>
          <Button
            size="sm"
            label="Upgrade"
            onPress={() =>
              router.push({ pathname: "/founder", params: { from: "banner", next: "/" } })
            }
          />
        </Card>
      ) : null}

      {/* Hero: sisa makan di ring */}
      <Card style={styles.heroCard}>
        <Ring
          size={224}
          stroke={14}
          value={data.eatenKcal}
          max={data.targets.eatKcal}
          color={ringColor}
          track={theme.colors.makanSoft}
        >
          <Text style={styles.heroLabel}>{over ? "Kelebihan" : "Masih boleh"}</Text>
          <Num
            style={[styles.heroNumber, over && { color: theme.colors.bakarText }]}
            adjustsFontSizeToFit
            numberOfLines={1}
          >
            {fmtKcal(Math.abs(data.targets.eatKcal - data.eatenKcal))}
          </Num>
          <Text style={styles.heroLabel}>kcal</Text>
        </Ring>
        <View style={styles.heroStats}>
          <View style={styles.heroStat}>
            <Text style={styles.heroStatLabel}>Target</Text>
            <Num style={styles.heroStatValue}>{fmtKcal(data.targets.eatKcal)}</Num>
          </View>
          <View style={[styles.heroStat, styles.heroStatMid]}>
            <Text style={styles.heroStatLabel}>Dimakan</Text>
            <Num style={styles.heroStatValue}>{fmtKcal(data.eatenKcal)}</Num>
          </View>
          <View style={styles.heroStat}>
            <Text style={styles.heroStatLabel}>Defisit</Text>
            <Num
              style={[
                styles.heroStatValue,
                deficitKcal !== null && deficitKcal >= 0 && { color: theme.colors.makanText },
              ]}
            >
              {deficitKcal !== null ? fmtKcal(deficitKcal) : "–"}
            </Num>
          </View>
        </View>
        {adaptive ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Info target adaptif"
            onPress={() => setAdaptiveOpen(true)}
            style={({ pressed }) => [styles.adaptiveRow, pressed && styles.pressedSoft]}
          >
            <Ionicons name="information-circle" size={14} color={theme.colors.mutedForeground} />
            <Text style={styles.adaptiveText}>Target menyesuaikan datamu</Text>
          </Pressable>
        ) : null}
        {over ? (
          <Text style={styles.heroNote}>
            Lewat {fmtKcal(data.eatenKcal - data.targets.eatKcal)} kcal dari budget. Ringan saja
            hari ini, besok jalan lagi.
          </Text>
        ) : null}
        <ShareStoryButton
          variant="secondary"
          style={styles.heroShare}
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
      </Card>

      {/* Tiga angka harian */}
      <View style={styles.tileRow}>
        <StatTile
          icon="flame"
          tint="bakar"
          label="Bakar"
          value={fmtKcal(data.burnedKcal)}
          sub={`dari ${fmtKcal(data.targets.burnKcal)} kcal`}
          onPress={() => router.navigate("/olahraga")}
        />
        <StatTile
          icon="moon"
          tint="tidur"
          label="Tidur"
          value={data.sleepHoursLastNight !== null ? fmtKg(data.sleepHoursLastNight) : "–"}
          sub={`dari ${fmtKg(data.targets.sleepHours)} jam`}
          onPress={() => router.navigate("/tidur")}
        />
        <StatTile
          macro="protein"
          tint="makan"
          label="Protein"
          value={data.protein ? `${fmtKcal(data.protein.eatenG)}g` : "–"}
          sub={data.protein ? `dari ${fmtKcal(data.protein.targetG)} g` : "catat makan dulu"}
          onPress={() => router.navigate("/makan")}
        />
      </View>

      {/* Latihan beban: peringatan otot terlewat + pintu ke /latihan */}
      <WorkoutCard />

      {/* Belanja makan hari ini, satu baris — angkanya selalu hari ini */}
      {isToday ? <BelanjaCompact /> : null}

      {/* Masih muat: ide menu yang masih muat di sisa budget */}
      {data.ideas.length > 0 ? (
        <View style={styles.ideasWrap}>
          <Text style={styles.ideasTitle}>Masih muat</Text>
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
                  items={[`${fmtKcal(idea.kcal)} kcal`, `${fmtKcal(idea.proteinG)} g protein`]}
                  itemStyle={styles.ideaChipMeta}
                />
              </View>
            ))}
          </ScrollView>
        </View>
      ) : null}

      {/* Makan hari ini per slot */}
      <SectionTitle
        title={isToday ? "Makan hari ini" : `Makan ${relativeDayLabel(date, today)}`}
        action={{ label: "Lihat semua", onPress: () => router.navigate("/makan") }}
      />
      <ListGroup>
        {slots.map((slot) => {
          const kcal = data.eatenByMeal[slot] ?? 0;
          return (
            <ListRow
              key={slot}
              title={MEAL_LABELS[slot]}
              subtitle={kcal > 0 ? undefined : "Belum ada catatan"}
              value={kcal > 0 ? `${fmtKcal(kcal)} kcal` : undefined}
              chevron
              onPress={() => router.navigate("/makan")}
            />
          );
        })}
      </ListGroup>

      {/* Diari piring: stiker hasil pindai hari ini */}
      {plates.length > 0 ? (
        <View style={styles.platesWrap}>
          <Text style={styles.ideasTitle}>Diari piring</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.platesRow}
          >
            {plates.map((item) => (
              <View key={item.id} style={styles.plateCard}>
                <FoodSticker
                  scanId={item.scanId}
                  name={item.name}
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
                <Text style={styles.plateKcal}>{fmtKcal(item.kcal)} kcal</Text>
              </View>
            ))}
          </ScrollView>
        </View>
      ) : null}

      {/* Tren berat + timbang inline */}
      {data.trend ? (
        <Card>
          <View style={styles.trendHead}>
            <View>
              <Text style={styles.trendLabel}>Berat tren</Text>
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
                    target {fmtDateId(data.trend.projectedDate)}
                  </Text>
                ) : null}
              </View>
            ) : null}
          </View>
          {trendPoints.length > 1 ? <TrendSpark points={trendPoints} /> : null}
          {isToday ? (
            data.weightLoggedToday ? (
              <Text style={styles.trendNote}>Sudah ditimbang hari ini. Mantap.</Text>
            ) : (
              <>
                <Text style={styles.trendNote}>
                  {trendPoints.length === 0
                    ? "Timbang dirimu agar angka tren mulai terbentuk."
                    : "Belum timbang hari ini. Satu angka bikin rencana makin pas."}
                </Text>
                <View>
                  <Button
                    variant="ghost"
                    size="sm"
                    label="Timbang sekarang"
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
      {isToday ? <FastingScheduleCard /> : null}

      {/* Tips hari ini: artikel berbasis bukti, berganti tiap hari */}
      {isToday ? <DailyTipCard /> : null}

      {/* Lainnya: air, streak, lencana, share — collapsed by default */}
      <SectionTitle
        title="Lainnya"
        action={{
          label: moreOpen ? "Sembunyikan" : "Tampilkan",
          onPress: () => setMoreOpen((v) => !v),
        }}
      />
      {moreOpen ? (
        <>
          <WaterCard date={date} />
          <ListGroup>
            <View style={styles.factBox}>
              <Text style={styles.factLabel}>Fakta kalori hari ini</Text>
              <Text style={styles.factText}>
                {fact.text} = {fmtKcal(fact.kcal)} kcal, setara {fact.move}
              </Text>
            </View>
            <ListRow
              icon="share-social"
              iconTint="makan"
              title="Bagikan recap mingguan"
              chevron
              onPress={() => shareRecap()}
            />
          </ListGroup>
          {data.milestones.length > 0 ? (
            <Card>
              <Text style={styles.milestoneTitle}>Lencana</Text>
              <View style={styles.milestoneRow}>
                {data.milestones.map((badge) => (
                  <View key={badge} style={styles.milestoneBadge}>
                    <Ionicons name="trophy" size={13} color={theme.colors.makanText} />
                    <Text style={styles.milestoneText}>{badge}</Text>
                  </View>
                ))}
              </View>
            </Card>
          ) : null}
        </>
      ) : (
        <Text style={styles.moreHint}>Air minum, streak, dan recap mingguan ada di sini.</Text>
      )}

      <WeighInSheet visible={weighOpen} onClose={() => setWeighOpen(false)} date={date} />

      {/* Info target adaptif */}
      <Sheet visible={adaptiveOpen} onClose={() => setAdaptiveOpen(false)} title="Target adaptif">
        <View style={styles.adaptiveBody}>
          <Text style={styles.adaptivePara}>
            Rumus standar memperkirakan tubuhmu membakar{" "}
            <Num style={styles.adaptiveStrong}>{fmtKcal(data.targets.formulaTdee)} kcal</Num>{" "}
            sehari.
          </Text>
          <Text style={styles.adaptivePara}>
            Dari catatan makan dan timbanganmu 4 minggu terakhir, pembakaran nyatamu sekitar{" "}
            <Num style={styles.adaptiveStrong}>{fmtKcal(data.targets.tdee)} kcal</Num>. Target makan
            memakai angka ini supaya pas dengan tubuhmu, bukan rata-rata orang.
          </Text>
          <Text style={styles.adaptiveMuted}>
            Penyesuaian dibatasi 15% dari rumus, dan hari yang lupa dicatat tidak ikut dihitung.
          </Text>
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
    alignItems: "center",
    paddingVertical: theme.spacing.xl,
  },
  heroShare: { alignSelf: "stretch", marginTop: theme.spacing.lg },
  heroLabel: {
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    color: theme.colors.mutedForeground,
  },
  heroNumber: {
    fontSize: theme.fontSize.hero,
    fontWeight: "800",
    letterSpacing: -1,
    color: theme.colors.foreground,
  },
  heroStats: {
    flexDirection: "row",
    width: "100%",
  },
  heroStat: {
    flex: 1,
    alignItems: "center",
    gap: 2,
  },
  heroStatMid: {
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.muted,
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
