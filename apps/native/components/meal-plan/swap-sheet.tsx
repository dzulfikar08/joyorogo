import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import type { Meal } from "@joyorogo/api/lib/engine";
import type { ItemView } from "@joyorogo/api/lib/meal/view";

import { MetaLine } from "@/components/meta-line";
import { Button, ErrorState, Num, Sheet, Skeleton, Text } from "@/components/ui";
import { errorMessage, fmtInt } from "@/utils/format";
import { orpc } from "@/utils/orpc";

import { routePaywall, useMealPlanMutations } from "./use-meal-plan";

export type SwapTarget = { date: string; slot: Meal };

const signed = (n: number): string => (n > 0 ? `+${fmtInt(n)}` : fmtInt(n));

function SwapBody({ target, onDone }: { target: SwapTarget; onDone: () => void }) {
  const { t } = useTranslation("mealPlan");
  const { swap } = useMealPlanMutations();
  const options = useQuery(orpc.mealPlan.swapOptions.queryOptions({ input: target }));

  useEffect(() => {
    if (options.error) routePaywall(options.error);
  }, [options.error]);

  if (options.isPending) {
    return (
      <>
        <Skeleton width="100%" height={64} radius={18} />
        <Skeleton width="100%" height={120} radius={18} />
        <Skeleton width="100%" height={120} radius={18} />
      </>
    );
  }
  if (options.isError) {
    return <ErrorState message={errorMessage(options.error)} onRetry={() => void options.refetch()} />;
  }

  const { current, alternatives } = options.data;
  const pickedKey = swap.isPending ? altKey(swap.variables) : null;

  return (
    <>
      <Text style={styles.subtitle}>{t("swap.subtitle")}</Text>

      <View style={styles.current}>
        <Text style={styles.currentLabel}>{t("swap.current")}</Text>
        <Text style={styles.name}>{current.name}</Text>
        <Summary item={current} />
      </View>

      {alternatives.length === 0 ? (
        <Text style={styles.none}>{t("swap.none")}</Text>
      ) : (
        alternatives.map((alt) => {
          const key = altKey(alt);
          return (
            <View key={key} style={styles.alt}>
              <Text style={styles.name}>{alt.name}</Text>
              {alt.summary ? <Text style={styles.altSummary}>{alt.summary}</Text> : null}
              <Summary item={alt} />
              <Text style={styles.delta}>
                {t("swap.delta", {
                  kcal: signed(Math.round(alt.nutrition.kcal - current.nutrition.kcal)),
                  protein: signed(Math.round(alt.nutrition.proteinG - current.nutrition.proteinG)),
                })}
              </Text>
              <Button
                label={pickedKey === key ? t("swap.working") : t("swap.pick")}
                loading={pickedKey === key}
                disabled={swap.isPending}
                onPress={() =>
                  swap.mutate(
                    { date: target.date, slot: target.slot, ref: alt.ref, scale: alt.scale, carbScale: alt.carbScale },
                    { onSuccess: onDone },
                  )
                }
              />
            </View>
          );
        })
      )}
    </>
  );
}

function altKey(item: Pick<ItemView, "ref" | "scale" | "carbScale">): string {
  return `${item.ref}|${item.scale}|${item.carbScale}`;
}

function Summary({ item }: { item: ItemView }) {
  const { t } = useTranslation("mealPlan");
  return (
    <View style={styles.summary}>
      <Num style={styles.kcal}>{t("day.unitKcal", { n: fmtInt(item.nutrition.kcal) })}</Num>
      <MetaLine
        itemStyle={styles.meta}
        items={[`${t("day.protein")} ${t("day.unitG", { n: fmtInt(item.nutrition.proteinG) })}`, item.portion]}
      />
    </View>
  );
}

/** Similar meals for one slot, with what each changes against the planned one. */
export function SwapSheet({ target, onClose }: { target: SwapTarget | null; onClose: () => void }) {
  const { t } = useTranslation("mealPlan");
  return (
    <Sheet visible={target !== null} onClose={onClose} title={t("swap.title")}>
      {target ? <SwapBody target={target} onDone={onClose} /> : null}
    </Sheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  subtitle: {
    fontSize: theme.fontSize.sm,
    lineHeight: 19,
    color: theme.colors.mutedForeground,
  },
  current: {
    gap: 4,
    padding: theme.spacing.lg,
    borderRadius: theme.radius.tile,
    backgroundColor: theme.colors.makanSoft,
  },
  currentLabel: {
    fontSize: theme.fontSize.xs,
    fontWeight: "700",
    color: theme.colors.makanText,
  },
  alt: {
    gap: 6,
    padding: theme.spacing.lg,
    borderRadius: theme.radius.tile,
    backgroundColor: theme.colors.muted,
  },
  name: {
    fontSize: theme.fontSize.md,
    fontWeight: "800",
    lineHeight: 22,
    color: theme.colors.foreground,
  },
  altSummary: {
    fontSize: theme.fontSize.sm,
    lineHeight: 19,
    color: theme.colors.mutedForeground,
  },
  summary: {
    gap: 2,
  },
  kcal: {
    fontSize: theme.fontSize.lg,
    fontWeight: "800",
    color: theme.colors.kcalText,
  },
  meta: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
  },
  delta: {
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
    color: theme.colors.foreground,
    marginBottom: 4,
  },
  none: {
    fontSize: theme.fontSize.sm,
    textAlign: "center",
    paddingVertical: theme.spacing.lg,
    color: theme.colors.mutedForeground,
  },
}));
