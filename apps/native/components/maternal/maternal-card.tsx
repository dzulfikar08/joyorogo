import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import type { MaternalInfo } from "@joyorogo/api/lib/maternal";

import { Button, Card, Text } from "@/components/ui";
import { fmtInt } from "@/utils/format";

import { MaternalDisclaimer } from "./disclaimer";
import { MaternalFlagNotes } from "./flag-notes";
import { NutrientList } from "./nutrient-list";
import { useGainLine, usePregnancyChart } from "./weight-gain-chart";

/**
 * Beranda card for Hamil / Menyusui: stage, tracked nutrients and "Perhatikan",
 * caffeine so far, weight-gain mini summary (pregnancy), flags, short disclaimer.
 */
export function MaternalCard({
  info,
  proteinG,
  fiberG,
  waterGlasses,
  waterGoal,
  caffeine,
}: {
  info: MaternalInfo;
  proteinG: number | null;
  fiberG: number | null;
  waterGlasses: number;
  waterGoal: number;
  caffeine: { mg: number; limitMg: number; over: boolean } | null;
}) {
  const { t } = useTranslation(["maternal", "home"]);
  const { theme } = useUnistyles();
  const pregnant = info.mode === "pregnant";
  const chart = usePregnancyChart();
  const gainLine = useGainLine(chart.data?.current);

  const stage =
    pregnant && info.gestation
      ? t("maternal:home.pregnant", { week: info.gestation.weeks, trimester: info.gestation.trimester })
      : t("maternal:home.breastfeeding", { months: info.babyMonths ?? 0 });

  return (
    <Card style={styles.card}>
      <View style={styles.head}>
        <View style={styles.chip}>
          <Ionicons name="heart-outline" size={16} color={theme.colors.makanText} />
        </View>
        <View style={styles.headText}>
          <Text style={styles.title}>{t("maternal:home.card")}</Text>
          <Text style={styles.stage}>{stage}</Text>
        </View>
      </View>

      <NutrientList
        info={info}
        collapseGuidance
        eaten={{ protein: proteinG, fiber: fiberG, waterGlasses, waterGoal }}
      />

      {caffeine && caffeine.mg > 0 ? (
        <Text style={styles.body}>
          {caffeine.over
            ? t("maternal:flags.caffeineOver", { mg: fmtInt(caffeine.mg), limit: fmtInt(caffeine.limitMg) })
            : t("maternal:flags.caffeineDay", { mg: fmtInt(caffeine.mg), limit: fmtInt(caffeine.limitMg) })}
        </Text>
      ) : null}

      {pregnant && chart.data ? (
        <View style={styles.gain}>
          <Text style={styles.gainTitle}>{t("maternal:home.weightTitle")}</Text>
          <Text style={styles.body}>{gainLine ?? t("maternal:gain.empty")}</Text>
          <Button
            variant="secondary"
            size="sm"
            label={t("maternal:home.seeAll")}
            onPress={() => router.navigate("/berat")}
          />
        </View>
      ) : null}

      <MaternalFlagNotes info={info} />
      <MaternalDisclaimer short />
    </Card>
  );
}

const styles = StyleSheet.create((theme) => ({
  card: {
    gap: theme.spacing.md,
  },
  head: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
  },
  chip: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.makanSoft,
  },
  headText: {
    flex: 1,
  },
  title: {
    fontSize: theme.fontSize.md,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  stage: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
  },
  body: {
    fontSize: theme.fontSize.sm,
    lineHeight: 19,
    color: theme.colors.mutedForeground,
  },
  gain: {
    gap: theme.spacing.sm,
    alignItems: "flex-start",
  },
  gainTitle: {
    fontSize: theme.fontSize.base,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
}));
