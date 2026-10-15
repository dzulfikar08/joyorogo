import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { Platform, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { jakartaToday } from "@joyorogo/api/lib/engine";
import {
  FOOD_GUIDANCE_TEASER,
  READINESS_ID,
  fitnessHints,
  hasFitnessData,
} from "@joyorogo/api/lib/fitness-hint";
import type { FoodPick, ReadinessGuidance } from "@joyorogo/api/lib/readiness-food";

import { useAppConfig } from "@/components/billing";
import { Button, Card, Num, Text } from "@/components/ui";
import { fmtKcal } from "@/utils/format";
import { orpc } from "@/utils/orpc";

/**
 * Recovery, strain and sleep of the day from JoyoFit (the Huawei watch app).
 * Everyone gets the short qualitative hints; Founder gets personalised food
 * guidance for today (server-checked), free users a locked teaser when
 * Founder can actually be bought on this platform. Renders nothing for a day
 * JoyoFit pushed no scores for, and nothing while loading or when the request
 * fails: it is an extra, not part of the diary.
 */
export function FitnessCard({ date }: { date: string }) {
  const { data } = useQuery(orpc.fitness.byDate.queryOptions({ input: { date } }));
  const config = useAppConfig();
  const hasScores = hasFitnessData(data);
  // Guidance is about what is left to eat today; a past day only has the hints.
  const guidance = useQuery({
    ...orpc.day.readinessGuidance.queryOptions(),
    enabled: hasScores && date === jakartaToday(),
  });
  if (!hasFitnessData(data)) return null;

  const ready = guidance.data?.status === "ready" ? guidance.data.guidance : null;
  // Same rule as the Harga row in Lainnya: the paywall needs a working checkout here.
  const canBuy =
    config.data?.paywall === true &&
    (Platform.OS === "ios" ? config.data.appleBilling : config.data.billing);
  const showTeaser = guidance.data?.status === "locked" && canBuy;
  const hints = ready ? [] : fitnessHints(data);

  return (
    <Card style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.title}>Kebugaran dari JoyoFit</Text>
        {data.readiness ? <Text style={styles.readiness}>{READINESS_ID[data.readiness]}</Text> : null}
      </View>
      <View style={styles.row}>
        <Metric label="Pemulihan" value={data.recoveryPct === null ? null : `${data.recoveryPct}%`} />
        <Metric label="Strain" value={data.strain === null ? null : `${data.strain.toFixed(1)} / 21`} />
        <Metric label="Tidur" value={data.sleepPct === null ? null : `${data.sleepPct}%`} />
      </View>
      {hints.map((hint) => (
        <Text key={hint} style={styles.hint}>
          {hint}
        </Text>
      ))}
      {ready ? <Guidance guidance={ready} /> : null}
      {showTeaser ? <Teaser /> : null}
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string | null }) {
  return (
    <View style={styles.metric}>
      <Num style={styles.value} numberOfLines={1} adjustsFontSizeToFit>
        {value ?? "-"}
      </Num>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

/** "Sisa" figures that matter for the day's focus; a steady day shows none. */
function remaining(guidance: ReadinessGuidance): Array<{ label: string; value: string }> {
  const { numbers, focus } = guidance;
  if (!numbers || focus === "steady") return [];
  const rows = [{ label: "Sisa kkal", value: fmtKcal(numbers.roomKcal) }];
  if (focus !== "fuel") rows.push({ label: "Sisa protein", value: `${fmtKcal(numbers.protein.remainingG)} g` });
  if (focus !== "recover") rows.push({ label: "Sisa karbo", value: `${fmtKcal(numbers.carbs.remainingG)} g` });
  return rows;
}

function pickDetail(pick: FoodPick): string {
  const parts = [`${fmtKcal(pick.kcal)} kkal`];
  if (pick.proteinG !== null) parts.push(`P ${fmtKcal(pick.proteinG)} g`);
  if (pick.carbsG !== null) parts.push(`K ${fmtKcal(pick.carbsG)} g`);
  parts.push(pick.source === "riwayat" ? `${pick.days}x di catatanmu` : "dari database JoyoRogo");
  return parts.join(" · ");
}

function Guidance({ guidance }: { guidance: ReadinessGuidance }) {
  const stats = remaining(guidance);
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{guidance.headline}</Text>
      {guidance.lines.map((line) => (
        <Text key={line} style={styles.hint}>
          {line}
        </Text>
      ))}
      {stats.length > 0 ? (
        <View style={styles.row}>
          {stats.map((stat) => (
            <Metric key={stat.label} label={stat.label} value={stat.value} />
          ))}
        </View>
      ) : null}
      {guidance.foods.length > 0 ? (
        <View style={styles.foods}>
          <Text style={styles.label}>Pilihan untuk hari ini</Text>
          {guidance.foods.map((pick) => (
            <View key={pick.name} style={styles.food}>
              <Text style={styles.foodName}>
                {pick.name}
                {pick.portion ? ` (${pick.portion})` : ""}
              </Text>
              <Text style={styles.label}>{pickDetail(pick)}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {guidance.basis ? <Text style={styles.label}>{guidance.basis}</Text> : null}
    </View>
  );
}

function Teaser() {
  const { theme } = useUnistyles();
  return (
    <View style={styles.section}>
      <View style={styles.teaserTitle}>
        <Ionicons name="lock-closed" size={14} color={theme.colors.mutedForeground} />
        <Text style={styles.sectionTitle}>{FOOD_GUIDANCE_TEASER.title}</Text>
      </View>
      <Text style={styles.teaserBody}>{FOOD_GUIDANCE_TEASER.body}</Text>
      <View style={styles.teaserAction}>
        <Button
          size="sm"
          label={FOOD_GUIDANCE_TEASER.action}
          onPress={() => router.push({ pathname: "/founder", params: { from: "fitness", next: "/makan" } })}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  card: {
    gap: theme.spacing.md,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing.sm,
  },
  title: {
    flexShrink: 1,
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    color: theme.colors.mutedForeground,
  },
  readiness: {
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
    color: theme.colors.tidurText,
  },
  row: {
    flexDirection: "row",
    gap: theme.spacing.md,
  },
  metric: {
    flex: 1,
    gap: 2,
  },
  value: {
    fontSize: theme.fontSize.xl,
    fontWeight: "800",
  },
  label: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.mutedForeground,
  },
  hint: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
  },
  section: {
    gap: theme.spacing.sm,
    paddingTop: theme.spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.hairline,
  },
  sectionTitle: {
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  foods: {
    gap: theme.spacing.sm,
  },
  food: {
    gap: 2,
  },
  foodName: {
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    color: theme.colors.foreground,
  },
  teaserTitle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  teaserBody: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
  },
  teaserAction: {
    alignItems: "flex-start",
  },
}));
