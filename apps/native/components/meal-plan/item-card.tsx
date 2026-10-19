import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import type { ItemView } from "@joyorogo/api/lib/meal/view";

import { MetaLine } from "@/components/meta-line";
import { PressableScale } from "@/components/motion";
import { Button, Card, Num, Text } from "@/components/ui";
import { fmtInt } from "@/utils/format";

import { MacroChips, Pill } from "./parts";

/**
 * One planned meal. What the buttons do is decided by which handlers come in: a past day or the free
 * teaser passes none, so the card is read-only.
 */
export function ItemCard({
  item,
  onOpenRecipe,
  onSwap,
  onBuy,
  onToggleEaten,
  eatPending = false,
}: {
  item: ItemView;
  onOpenRecipe?: () => void;
  onSwap?: () => void;
  /** Present for a meal suggested to buy: opens the "Beli" sheet. */
  onBuy?: () => void;
  /** Present when "Sudah makan" (or, once eaten, "Batalkan") is available for this day. */
  onToggleEaten?: () => void;
  eatPending?: boolean;
}) {
  const { t } = useTranslation("mealPlan");
  const { theme } = useUnistyles();
  const lighter = item.lighterThan;
  const fromHabit = item.habitTimes !== null && !lighter;
  const header = (
    <View style={styles.headerRow}>
      <View style={styles.headerText}>
        <Text style={styles.name}>{item.name}</Text>
        {item.summary ? <Text style={styles.summary}>{item.summary}</Text> : null}
      </View>
      {onOpenRecipe ? (
        <View style={styles.recipeHint}>
          <Text style={styles.recipeHintLabel}>{t("item.recipe")}</Text>
          <Ionicons name="chevron-forward" size={16} color={theme.colors.primary} />
        </View>
      ) : null}
    </View>
  );

  return (
    <Card style={styles.card}>
      <View style={styles.topRow}>
        <Text style={styles.slot}>{item.slotLabel}</Text>
        {onSwap || onToggleEaten ? (
          <Pill
            label={t(item.mode === "buy" ? "item.modeBuy" : "item.modeCook")}
            icon={item.mode === "buy" ? "bag-handle" : "restaurant"}
          />
        ) : null}
        {item.eaten || item.covered ? (
          <Pill label={t("item.eatenBadge")} tone={item.eaten ? "makan" : "muted"} icon="checkmark-circle" />
        ) : null}
      </View>

      {onOpenRecipe ? (
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={`${item.name}, ${t("item.recipe")}`}
          onPress={onOpenRecipe}
          scaleTo={0.99}
          dimTo={0.8}
          style={styles.headerPress}
        >
          {header}
        </PressableScale>
      ) : (
        header
      )}

      <MetaLine
        itemStyle={styles.meta}
        items={[
          item.portion,
          item.minutes !== null ? t("item.minutes", { min: item.minutes }) : null,
          item.cost !== null ? t(`cost.${item.cost}`) : null,
        ]}
      />

      <View style={styles.numbers}>
        <Num style={styles.kcal}>{t("day.unitKcal", { n: fmtInt(item.nutrition.kcal) })}</Num>
        <MacroChips nutrition={item.nutrition} />
      </View>

      {item.tags.length > 0 ? (
        <View style={styles.tags}>
          {item.tags.map((tag) => (
            <Pill key={tag} label={t(`tag.${tag}`)} />
          ))}
        </View>
      ) : null}

      {fromHabit || lighter ? (
        <View style={styles.notes}>
          {fromHabit ? (
            <View style={styles.note}>
              <Ionicons name="repeat" size={15} color={theme.colors.makanText} />
              <Text style={styles.noteText}>
                {item.habitTimes !== null && item.habitTimes > 1
                  ? t("item.fromHabitTimes", { times: item.habitTimes })
                  : t("item.fromHabit")}
              </Text>
            </View>
          ) : null}
          {lighter ? (
            <View style={styles.note}>
              <Ionicons name="trending-down" size={15} color={theme.colors.makanText} />
              <Text style={styles.noteText}>
                {t("item.lighter", { name: lighter.name })}
                {lighter.savedKcal > 0 ? ` (-${t("day.unitKcal", { n: fmtInt(lighter.savedKcal) })})` : ""}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {item.avoid ? (
        <View style={styles.avoid}>
          <Ionicons name="warning" size={16} color={theme.colors.destructiveText} />
          <Text style={styles.avoidText}>{t("item.avoid")}</Text>
        </View>
      ) : null}

      {item.kind === "habit" ? <Text style={styles.habitNote}>{t("recipe.habitNote")}</Text> : null}

      {onBuy ? <Button variant="secondary" icon="bag-handle" label={t("item.buy")} onPress={onBuy} disabled={eatPending} /> : null}

      {onSwap || onToggleEaten ? (
        <View style={styles.actions}>
          {onSwap ? (
            <Button
              variant="secondary"
              icon="swap-horizontal"
              label={t("item.swap")}
              onPress={onSwap}
              disabled={eatPending}
              style={styles.action}
            />
          ) : null}
          {onToggleEaten ? (
            <Button
              variant={item.eaten ? "secondary" : "primary"}
              icon={item.eaten ? "arrow-undo" : "checkmark"}
              label={item.eaten ? t("item.undo") : t("item.ate")}
              onPress={onToggleEaten}
              loading={eatPending}
              style={styles.action}
            />
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create((theme) => ({
  card: {
    gap: theme.spacing.md,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing.sm,
  },
  slot: {
    flexShrink: 1,
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
    color: theme.colors.mutedForeground,
  },
  headerPress: {
    minHeight: 44,
    justifyContent: "center",
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing.md,
  },
  headerText: {
    flex: 1,
    gap: 2,
  },
  name: {
    fontSize: theme.fontSize.lg,
    fontWeight: "800",
    lineHeight: 24,
    color: theme.colors.foreground,
  },
  summary: {
    fontSize: theme.fontSize.sm,
    lineHeight: 19,
    color: theme.colors.mutedForeground,
  },
  recipeHint: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingTop: 3,
  },
  recipeHintLabel: {
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
    color: theme.colors.primary,
  },
  meta: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
  },
  numbers: {
    gap: theme.spacing.sm,
  },
  kcal: {
    fontSize: theme.fontSize.xl,
    fontWeight: "800",
    color: theme.colors.kcalText,
  },
  tags: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  notes: {
    gap: 6,
  },
  note: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
  },
  noteText: {
    flex: 1,
    fontSize: theme.fontSize.sm,
    lineHeight: 19,
    color: theme.colors.makanText,
  },
  avoid: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    borderRadius: 12,
    padding: theme.spacing.md,
    backgroundColor: theme.colors.destructiveSoft,
  },
  avoidText: {
    flex: 1,
    fontSize: theme.fontSize.sm,
    lineHeight: 19,
    fontWeight: "600",
    color: theme.colors.destructiveText,
  },
  habitNote: {
    fontSize: theme.fontSize.xs,
    lineHeight: 17,
    color: theme.colors.mutedForeground,
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing.sm,
  },
  action: {
    flexGrow: 1,
    flexBasis: 120,
  },
}));
