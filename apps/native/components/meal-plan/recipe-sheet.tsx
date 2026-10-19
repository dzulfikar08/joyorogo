import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { MetaLine } from "@/components/meta-line";
import { ErrorState, Num, Sheet, Skeleton, Text } from "@/components/ui";
import { errorMessage, fmtInt } from "@/utils/format";
import { MACRO_META, MacroIcon } from "@/utils/macro-icons";
import type { MacroKey } from "@/utils/macro-icons";
import { orpc } from "@/utils/orpc";

import { Pill } from "./parts";
import { routePaywall } from "./use-meal-plan";

export type RecipeTarget = { id: string; scale: number; carbScale: number };

function RecipeBody({ target }: { target: RecipeTarget }) {
  const { t } = useTranslation("mealPlan");
  const { theme } = useUnistyles();
  const recipe = useQuery(orpc.mealPlan.recipe.queryOptions({ input: target }));

  useEffect(() => {
    if (recipe.error) routePaywall(recipe.error);
  }, [recipe.error]);

  if (recipe.isPending) {
    return (
      <>
        <Skeleton width="70%" height={26} />
        <Skeleton width="100%" height={150} radius={18} />
        <Skeleton width="100%" height={180} radius={18} />
      </>
    );
  }
  if (recipe.isError) {
    return <ErrorState message={errorMessage(recipe.error)} onRetry={() => void recipe.refetch()} />;
  }

  const r = recipe.data;
  const rows: Array<{ macro: MacroKey; label: string; value: string }> = [
    { macro: "kcal", label: t("day.kcal"), value: t("day.unitKcal", { n: fmtInt(r.nutrition.kcal) }) },
    { macro: "protein", label: t("day.protein"), value: t("day.unitG", { n: fmtInt(r.nutrition.proteinG) }) },
    { macro: "carbs", label: t("day.carbs"), value: t("day.unitG", { n: fmtInt(r.nutrition.carbsG) }) },
    { macro: "fat", label: t("day.fat"), value: t("day.unitG", { n: fmtInt(r.nutrition.fatG) }) },
    { macro: "fiber", label: MACRO_META.fiber.label, value: t("day.unitG", { n: fmtInt(r.nutrition.fiberG) }) },
  ];

  return (
    <>
      <Text style={styles.name}>{r.name}</Text>
      <MetaLine
        itemStyle={styles.meta}
        items={[r.portion, t("item.minutes", { min: r.minutes }), t(`cost.${r.cost}`)]}
      />
      {r.tags.length > 0 ? (
        <View style={styles.pills}>
          {r.tags.map((tag) => (
            <Pill key={tag} label={t(`tag.${tag}`)} />
          ))}
        </View>
      ) : null}

      {r.allergens.length > 0 ? (
        <View style={styles.allergens}>
          <Text style={styles.allergenLabel}>{t("recipe.allergens")}</Text>
          <View style={styles.pills}>
            {r.allergens.map((a) => (
              <Pill key={a} label={t(`allergen.${a}`)} tone="bakar" icon="warning" />
            ))}
          </View>
        </View>
      ) : (
        <View style={styles.noAllergen}>
          <Ionicons name="shield-checkmark" size={16} color={theme.colors.makanText} />
          <Text style={styles.noAllergenText}>{t("recipe.noAllergens")}</Text>
        </View>
      )}

      <Text style={styles.heading}>{t("recipe.nutrition")}</Text>
      <View style={styles.table}>
        {rows.map((row, index) => (
          <View key={row.macro} style={[styles.tableRow, index > 0 && styles.tableRowBorder]}>
            <MacroIcon macro={row.macro} size={16} />
            <Text style={styles.tableLabel}>{row.label}</Text>
            <Num style={styles.tableValue}>{row.value}</Num>
          </View>
        ))}
      </View>

      <Text style={styles.heading}>{t("recipe.ingredients")}</Text>
      <View style={styles.table}>
        {r.ingredients.map((ing, index) => (
          <View key={ing.key} style={[styles.tableRow, index > 0 && styles.tableRowBorder]}>
            <Text style={styles.tableLabel}>{ing.name}</Text>
            <Text style={styles.amount}>{ing.amount}</Text>
          </View>
        ))}
      </View>

      <Text style={styles.heading}>{t("recipe.steps")}</Text>
      <View style={styles.steps}>
        {r.steps.map((step, index) => (
          <View key={index} style={styles.step}>
            <View style={styles.stepNumber}>
              <Num style={styles.stepNumberText}>{index + 1}</Num>
            </View>
            <Text style={styles.stepText}>{step}</Text>
          </View>
        ))}
      </View>

      {r.tip ? (
        <View style={styles.tip}>
          <Ionicons name="bulb" size={18} color={theme.colors.kcalText} />
          <View style={styles.tipBody}>
            <Text style={styles.tipLabel}>{t("recipe.tip")}</Text>
            <Text style={styles.tipText}>{r.tip}</Text>
          </View>
        </View>
      ) : null}

      <Text style={styles.heading}>{t("recipe.sourceTitle")}</Text>
      <View style={styles.notes}>
        {r.sources.map((group) => (
          <Text key={group.kind} style={styles.note}>
            <Text style={styles.noteStrong}>{group.label}: </Text>
            {group.items.join(", ")}
          </Text>
        ))}
      </View>

      <View style={styles.notes}>
        <Text style={styles.note}>{t("recipe.source")}</Text>
        <Text style={styles.note}>{t("recipe.aiNote")}</Text>
      </View>
    </>
  );
}

/** One recipe at the planned portion: nutrition per portion, ingredients in grams, steps. */
export function RecipeSheet({ target, onClose }: { target: RecipeTarget | null; onClose: () => void }) {
  const { t } = useTranslation("mealPlan");
  return (
    <Sheet visible={target !== null} onClose={onClose} title={t("recipe.title")}>
      {target ? <RecipeBody target={target} /> : null}
    </Sheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  name: {
    fontSize: theme.fontSize.xl,
    fontWeight: "800",
    lineHeight: 26,
    color: theme.colors.foreground,
  },
  meta: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
  },
  pills: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  allergens: {
    gap: 6,
  },
  allergenLabel: {
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  noAllergen: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  noAllergenText: {
    flex: 1,
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    color: theme.colors.makanText,
  },
  heading: {
    marginTop: theme.spacing.sm,
    fontSize: theme.fontSize.md,
    fontWeight: "800",
    color: theme.colors.foreground,
  },
  table: {
    borderRadius: theme.radius.tile,
    backgroundColor: theme.colors.muted,
    paddingHorizontal: theme.spacing.lg,
  },
  tableRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    minHeight: 48,
    paddingVertical: 10,
  },
  tableRowBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.hairline,
  },
  tableLabel: {
    flex: 1,
    fontSize: theme.fontSize.base,
    fontWeight: "600",
    color: theme.colors.foreground,
  },
  tableValue: {
    fontSize: theme.fontSize.base,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  amount: {
    flexShrink: 1,
    maxWidth: "55%",
    textAlign: "right",
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
  },
  steps: {
    gap: theme.spacing.md,
  },
  step: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing.md,
  },
  stepNumber: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.makanSoft,
  },
  stepNumberText: {
    fontSize: theme.fontSize.sm,
    fontWeight: "800",
    color: theme.colors.makanText,
  },
  stepText: {
    flex: 1,
    fontSize: theme.fontSize.base,
    lineHeight: 22,
    color: theme.colors.foreground,
  },
  tip: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing.md,
    padding: theme.spacing.lg,
    borderRadius: theme.radius.tile,
    backgroundColor: theme.colors.muted,
  },
  tipBody: {
    flex: 1,
    gap: 2,
  },
  tipLabel: {
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  tipText: {
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
    color: theme.colors.foreground,
  },
  notes: {
    gap: 6,
    marginTop: theme.spacing.sm,
  },
  noteStrong: {
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  note: {
    fontSize: theme.fontSize.xs,
    lineHeight: 17,
    color: theme.colors.mutedForeground,
  },
}));
