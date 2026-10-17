import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";

import type { MaternalInfo, MaternalNutrient } from "@joyorogo/api/lib/maternal";

import { Disclosure } from "@/components/disclosure";
import { Num, Text } from "@/components/ui";
import { fmtInt } from "@/utils/format";

type Eaten = { protein: number | null; fiber: number | null; waterGlasses: number; waterGoal: number };

/** "Dasar 60 + tambahan 10", the base and the stage addition of one nutrient. */
function BaseAdd({ n }: { n: MaternalNutrient }) {
  const { t } = useTranslation("maternal");
  const unit = t(`nutrients.unit.${n.unit}`);
  return (
    <Text style={styles.sub}>
      {t("nutrients.base", { base: `${fmtInt(n.base)} ${unit}` })}
      {n.add > 0 ? `, ${t("nutrients.plus", { add: `${fmtInt(n.add)} ${unit}` })}` : ""}
    </Text>
  );
}

function TrackedRow({ n, eaten }: { n: MaternalNutrient; eaten: Eaten }) {
  const { t } = useTranslation(["maternal", "home"]);
  const unit = t(`maternal:nutrients.unit.${n.unit}`);
  const name = t(`maternal:nutrients.${n.key}.name`);

  let progress = 0;
  let value: string;
  if (n.key === "water") {
    progress = eaten.waterGoal > 0 ? eaten.waterGlasses / eaten.waterGoal : 0;
    value = `${eaten.waterGlasses} ${t("home:water.ofGoal", { count: eaten.waterGoal })}`;
  } else {
    const amount = n.key === "protein" ? eaten.protein : eaten.fiber;
    progress = amount !== null && n.target > 0 ? amount / n.target : 0;
    value = `${fmtInt(amount ?? 0)} / ${fmtInt(n.target)} ${unit}`;
  }
  const pct = Math.min(Math.max(progress, 0), 1);

  return (
    <View style={styles.row}>
      <View style={styles.rowHead}>
        <Text style={styles.name}>{name}</Text>
        <Num style={styles.value}>{value}</Num>
      </View>
      <View
        style={styles.track}
        accessibilityRole="progressbar"
        accessibilityLabel={name}
        accessibilityValue={{ min: 0, max: 100, now: Math.round(pct * 100) }}
      >
        <View style={[styles.fill, { width: `${pct * 100}%` }]} />
      </View>
      {n.key === "water" ? (
        <Text style={styles.sub}>
          {fmtInt(n.target)} {unit}
        </Text>
      ) : null}
      <BaseAdd n={n} />
      <Text style={styles.hint}>{t(`maternal:nutrients.${n.key}.hint`)}</Text>
    </View>
  );
}

function GuidanceRow({ n }: { n: MaternalNutrient }) {
  const { t } = useTranslation("maternal");
  const unit = t(`nutrients.unit.${n.unit}`);
  return (
    <View style={styles.row}>
      <View style={styles.rowHead}>
        <Text style={styles.name}>{t(`nutrients.${n.key}.name`)}</Text>
        <Num style={styles.value}>
          {fmtInt(n.target)} {unit}
        </Num>
      </View>
      <BaseAdd n={n} />
      <Text style={styles.hint}>{t(`nutrients.${n.key}.hint`)}</Text>
    </View>
  );
}

/**
 * Daily nutrients of the maternal plan. Protein, fiber and water show progress
 * from the day's data; the rest are guidance only (we do not log them).
 */
export function NutrientList({
  info,
  eaten,
  collapseGuidance = false,
}: {
  info: MaternalInfo;
  eaten: Eaten;
  /** Beranda: keep "Perhatikan" behind a disclosure so the card stays short. */
  collapseGuidance?: boolean;
}) {
  const { t } = useTranslation("maternal");
  const tracked = info.nutrients.filter((n) => n.tracked);
  const guidance = info.nutrients.filter((n) => !n.tracked);
  const guidanceBody = (
    <>
      <Text style={styles.sub}>{t("nutrients.guidanceNote")}</Text>
      {guidance.map((n) => (
        <GuidanceRow key={n.key} n={n} />
      ))}
    </>
  );
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{t("nutrients.trackedTitle")}</Text>
      {tracked.map((n) => (
        <TrackedRow key={n.key} n={n} eaten={eaten} />
      ))}
      {guidance.length > 0 ? (
        collapseGuidance ? (
          <Disclosure plain title={t("nutrients.guidanceTitle")}>
            <View style={styles.wrap}>{guidanceBody}</View>
          </Disclosure>
        ) : (
          <>
            <Text style={styles.title}>{t("nutrients.guidanceTitle")}</Text>
            {guidanceBody}
          </>
        )
      ) : null}
      <Text style={styles.sub}>{t("nutrients.source")}</Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  wrap: {
    gap: theme.spacing.md,
  },
  title: {
    fontSize: theme.fontSize.base,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  row: {
    gap: 4,
  },
  rowHead: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: theme.spacing.sm,
  },
  name: {
    flexShrink: 1,
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    color: theme.colors.foreground,
  },
  value: {
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  track: {
    height: 8,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.makanSoft,
    overflow: "hidden",
  },
  fill: {
    height: 8,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.makan,
  },
  sub: {
    fontSize: theme.fontSize.xs,
    lineHeight: 17,
    color: theme.colors.mutedForeground,
  },
  hint: {
    fontSize: theme.fontSize.xs,
    lineHeight: 17,
    color: theme.colors.mutedForeground,
  },
}));
