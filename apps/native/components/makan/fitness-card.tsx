import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Platform, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { jakartaToday } from "@joyorogo/api/lib/engine";
import {
  FOOD_GUIDANCE_TEASER,
  fitnessFigures,
  fitnessHints,
  fitnessVerdict,
  hasFitnessData,
} from "@joyorogo/api/lib/fitness-hint";
import type { FitnessDay, FitnessFigure } from "@joyorogo/api/lib/fitness-hint";
import type { FoodPick, ReadinessGuidance } from "@joyorogo/api/lib/readiness-food";
import type { TFunction } from "@joyorogo/i18n";

import { useAppConfig } from "@/components/billing";
import { PressableScale } from "@/components/motion";
import { Button, Num, Sheet, Text } from "@/components/ui";
import { openJoyoFit } from "@/lib/workout/joyofit";
import { fmtGramsLabel, fmtInt, fmtKcalLabel, timeAgo } from "@/utils/format";
import { orpc } from "@/utils/orpc";

/**
 * JoyoFit's recovery, strain and readiness of the day (the Huawei watch app) as one compact card: title row,
 * at most three figures, one verdict line. Tapping it opens the detail sheet, which holds everything longer: how
 * to read the numbers, the food hints, Founder's personalised guidance (server-checked) or the locked teaser (only
 * when Founder can be bought on this platform) and the way into JoyoFit. Renders nothing for a day JoyoFit pushed
 * no scores for, and nothing while loading or when the request fails: it is an extra, not part of the diary.
 */
export function FitnessCard({ date }: { date: string }) {
  const { t } = useTranslation("makan");
  const { theme } = useUnistyles();
  const [open, setOpen] = useState(false);
  const { data } = useQuery(orpc.fitness.byDate.queryOptions({ input: { date } }));
  if (!hasFitnessData(data)) return null;

  const figures = fitnessFigures(data);
  const verdict = fitnessVerdict(data);
  const summary = [...figures.map((f) => `${f.label} ${f.value}${f.unit ?? ""}`), verdict].filter(Boolean).join(", ");

  return (
    <>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={t("fitnessCard.aria", { summary })}
        onPress={() => setOpen(true)}
        scaleTo={0.98}
        style={styles.card}
      >
        <View style={styles.header}>
          <Text style={styles.title}>{t("fitnessCard.title")}</Text>
          {date === jakartaToday() ? <Text style={styles.age}>{timeAgo(data.updatedAt)}</Text> : null}
          <Ionicons name="chevron-forward" size={16} color={theme.colors.mutedForeground} />
        </View>
        <View style={styles.row}>
          {figures.map((figure) => (
            <Figure key={figure.id} figure={figure} />
          ))}
        </View>
        {verdict ? (
          <Text style={styles.verdict} numberOfLines={1}>
            {verdict}
          </Text>
        ) : null}
      </PressableScale>
      {open ? <DetailSheet date={date} day={data} figures={figures} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function Figure({ figure }: { figure: FitnessFigure }) {
  return (
    <View style={styles.figure}>
      <Num style={styles.value} numberOfLines={1} adjustsFontSizeToFit>
        {figure.value}
        {figure.unit ? <Text style={styles.unit}>{figure.unit}</Text> : null}
      </Num>
      <Text style={styles.label} numberOfLines={1}>
        {figure.label}
      </Text>
    </View>
  );
}

/** Everything that was too long for the card: how to read the numbers, food hints or guidance, the way into JoyoFit. */
function DetailSheet({
  date,
  day,
  figures,
  onClose,
}: {
  date: string;
  day: FitnessDay;
  figures: FitnessFigure[];
  onClose: () => void;
}) {
  const { t } = useTranslation("makan");
  const config = useAppConfig();
  // Guidance is about what is left to eat today; a past day only has the hints.
  const guidance = useQuery({
    ...orpc.day.readinessGuidance.queryOptions(),
    enabled: date === jakartaToday(),
  });
  const ready = guidance.data?.status === "ready" ? guidance.data.guidance : null;
  // Same rule as the Harga row in Lainnya: the paywall needs a working checkout here.
  const canBuy =
    config.data?.paywall === true &&
    (Platform.OS === "ios" ? config.data.appleBilling : config.data.billing);
  const showTeaser = guidance.data?.status === "locked" && canBuy;
  const hints = ready ? [] : fitnessHints(day);

  return (
    <Sheet
      visible
      onClose={onClose}
      title={t("fitnessCard.sheet.title")}
      footer={<Button label={t("fitnessCard.sheet.open")} onPress={() => void openJoyoFit("home")} />}
    >
      <View style={styles.sheetBody}>
        {hints.map((hint) => (
          <Text key={hint} style={styles.hint}>
            {hint}
          </Text>
        ))}
        {ready ? <Guidance guidance={ready} /> : null}
        {showTeaser ? <Teaser /> : null}
        <View style={styles.explain}>
          <Text style={styles.sectionTitle}>{t("fitnessCard.sheet.explainTitle")}</Text>
          {figures.map((figure) => (
            <Text key={figure.id} style={styles.label}>
              <Text style={styles.explainName}>{figure.label}: </Text>
              {t(`fitnessCard.explain.${figure.id}`)}
            </Text>
          ))}
        </View>
      </View>
    </Sheet>
  );
}

function Metric({ label, value }: { label: string; value: string | null }) {
  return (
    <View style={styles.figure}>
      <Num style={styles.value} numberOfLines={1} adjustsFontSizeToFit>
        {value ?? "-"}
      </Num>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

/** Remaining figures that matter for the day's focus; a steady day shows none. */
function remaining(
  guidance: ReadinessGuidance,
  t: TFunction<"makan">,
): Array<{ label: string; value: string }> {
  const { numbers, focus } = guidance;
  if (!numbers || focus === "steady") return [];
  const rows = [{ label: t("fitnessCard.left.kcal"), value: fmtInt(numbers.roomKcal) }];
  if (focus !== "fuel") {
    rows.push({ label: t("fitnessCard.left.protein"), value: fmtGramsLabel(numbers.protein.remainingG) });
  }
  if (focus !== "recover") {
    rows.push({ label: t("fitnessCard.left.carbs"), value: fmtGramsLabel(numbers.carbs.remainingG) });
  }
  return rows;
}

function pickDetail(pick: FoodPick, t: TFunction<"makan">): string {
  const parts = [fmtKcalLabel(pick.kcal)];
  if (pick.proteinG !== null) parts.push(t("fitnessCard.pick.protein", { g: fmtGramsLabel(pick.proteinG) }));
  if (pick.carbsG !== null) parts.push(t("fitnessCard.pick.carbs", { g: fmtGramsLabel(pick.carbsG) }));
  parts.push(
    pick.source === "riwayat"
      ? t("fitnessCard.pick.history", { count: pick.days ?? 0, n: fmtInt(pick.days ?? 0) })
      : t("fitnessCard.pick.database"),
  );
  return parts.join(" · ");
}

function Guidance({ guidance }: { guidance: ReadinessGuidance }) {
  const { t } = useTranslation("makan");
  const stats = remaining(guidance, t);
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
          <Text style={styles.label}>{t("fitnessCard.picksTitle")}</Text>
          {guidance.foods.map((pick) => (
            <View key={pick.name} style={styles.food}>
              <Text style={styles.foodName}>
                {pick.name}
                {pick.portion ? ` (${pick.portion})` : ""}
              </Text>
              <Text style={styles.label}>{pickDetail(pick, t)}</Text>
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
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.card,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    gap: theme.spacing.sm,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
  },
  title: {
    flex: 1,
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    color: theme.colors.mutedForeground,
  },
  age: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.mutedForeground,
  },
  row: {
    flexDirection: "row",
    gap: theme.spacing.md,
  },
  figure: {
    flex: 1,
    gap: 2,
  },
  value: {
    fontSize: theme.fontSize.xl,
    fontWeight: "800",
  },
  unit: {
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    color: theme.colors.mutedForeground,
  },
  label: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.mutedForeground,
  },
  verdict: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
  },
  sheetBody: {
    gap: theme.spacing.md,
  },
  hint: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
  },
  explain: {
    gap: theme.spacing.sm,
  },
  explainName: {
    fontWeight: "700",
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
