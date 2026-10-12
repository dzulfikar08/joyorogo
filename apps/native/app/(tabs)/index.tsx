import "@/unistyles";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { Link, Redirect, router } from "expo-router";
import { Dimensions, Pressable, Share, ScrollView, View } from "react-native";
import { useState } from "react";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Circle, Polyline, Svg } from "react-native-svg";

import { effectiveRamadan, jakartaToday, MEAL_LABELS, slotsFor } from "@joyorogo/api/lib/engine";
import type { Meal } from "@joyorogo/api/lib/engine";

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
  Skeleton,
  StatTile,
  Text,
} from "@/components/ui";
import { WaterCard } from "@/components/water-card";
import { WeighInSheet } from "@/components/weigh-in-sheet";
import { authClient } from "@/lib/auth-client";
import { useSessionGate } from "@/lib/use-session-gate";
import { useHealthConnectAutoSync } from "@/src/lib/use-health-connect-sync";
import { errorMessage, fmtDateId, fmtKcal, fmtKg, weeklyRateLabel } from "@/utils/format";
import { orpc } from "@/utils/orpc";

type TrendPoint = { date: string; weightKg: number; trendKg: number };

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

function LegendDot({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={styles.legendLabel}>{label}</Text>
      <Num style={styles.legendValue}>{value}</Num>
    </View>
  );
}

export default function Dashboard() {
  const { theme } = useUnistyles();
  const gate = useSessionGate();
  const summary = useQuery(orpc.day.summary.queryOptions({ input: {} }));
  const profileQuery = useQuery(orpc.profile.myProfile.queryOptions());
  const { data: sessionData } = authClient.useSession();

  // US-013: Health Connect is the primary activity source — once its reads
  // are granted (first import from Profil), every app open syncs silently.
  useHealthConnectAutoSync(
    profileQuery.data?.latestWeightKg ?? null,
    gate === "authed" && summary.data?.hasProfile === true,
  );

  const [weighOpen, setWeighOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

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
  const remaining = Math.max(0, data.targets.eatKcal - data.eatenKcal);
  const displayName = sessionData?.user.name ?? "Kamu";
  const firstName = displayName.split(" ")[0];
  const slots = slotsFor(effectiveRamadan(profileQuery.data?.profile?.ramadanMode)) as Meal[];
  const trendPoints = data.trend?.points ?? [];

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
      "Dibuat dengan JoyoRogo",
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
        <Link href="/profil" asChild>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Buka profil ${displayName}`}
            style={({ pressed }) => [pressed && styles.pressedSoft]}
          >
            <Avatar name={displayName} />
          </Pressable>
        </Link>
      </View>

      {/* Hero: sisa makan di ring */}
      <Card style={styles.heroCard}>
        <Ring
          size={224}
          stroke={14}
          value={over ? data.targets.eatKcal : data.eatenKcal}
          max={data.targets.eatKcal}
          color={over ? theme.colors.bakar : theme.colors.makan}
          track={over ? theme.colors.bakarSoft : theme.colors.makanSoft}
        >
          <Text style={styles.heroLabel}>{over ? "Budget habis" : "Sisa makan"}</Text>
          <Num style={styles.heroNumber} adjustsFontSizeToFit numberOfLines={1}>
            {fmtKcal(remaining)}
          </Num>
        </Ring>
        <View style={styles.heroLegend}>
          <LegendDot
            color={theme.colors.makan}
            label="Dimakan"
            value={`${fmtKcal(data.eatenKcal)} kcal`}
          />
          <LegendDot
            color={theme.colors.bakar}
            label="Budget"
            value={`${fmtKcal(data.targets.eatKcal)} kcal`}
          />
        </View>
        {over ? (
          <Text style={styles.heroNote}>
            Lewat {fmtKcal(data.eatenKcal - data.targets.eatKcal)} kcal dari budget. Ringan saja
            hari ini, besok jalan lagi.
          </Text>
        ) : null}
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
          icon="fitness"
          tint="makan"
          label="Protein"
          value={data.protein ? `${fmtKcal(data.protein.eatenG)}g` : "–"}
          sub={data.protein ? `dari ${fmtKcal(data.protein.targetG)} g` : "catat makan dulu"}
          onPress={() => router.navigate("/makan")}
        />
      </View>

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
                <Text style={styles.ideaChipText} numberOfLines={1}>
                  {idea.name} · {fmtKcal(idea.kcal)} kcal
                </Text>
              </View>
            ))}
          </ScrollView>
        </View>
      ) : null}

      {/* Makan hari ini per slot */}
      <SectionTitle
        title="Makan hari ini"
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
          {data.weightLoggedToday ? (
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
          )}
        </Card>
      ) : null}

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
          <WaterCard />
          <ListGroup>
            <ListRow
              icon="flame"
              iconTint="bakar"
              title="Streak catat"
              value={`${data.streakDays} hari`}
            />
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

      <WeighInSheet visible={weighOpen} onClose={() => setWeighOpen(false)} />
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
  heroLegend: {
    flexDirection: "row",
    gap: theme.spacing.xl,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendLabel: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
  },
  legendValue: {
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
    color: theme.colors.foreground,
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
    borderRadius: theme.radius.pill,
    paddingHorizontal: 14,
    minHeight: 40,
    justifyContent: "center",
  },
  ideaChipText: {
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    color: theme.colors.makanText,
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
