import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Linking, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { shopPlaceUrl } from "@joyorogo/api/lib/meal/links";
import type { ShopPlace } from "@joyorogo/api/lib/meal/links";

import { PressableScale } from "@/components/motion";
import { Card, EmptyState, ErrorState, ListGroup, SectionTitle, Skeleton, Text } from "@/components/ui";
import { errorMessage } from "@/utils/format";
import { orpc } from "@/utils/orpc";

import { routePaywall, useCheckItem } from "./use-meal-plan";

const PLACES: readonly ShopPlace[] = ["market", "supermarket"];

/** Google Maps searches for a market or supermarket near the person (a plain https link, no custom scheme). */
function NearbyShops() {
  const { t } = useTranslation("mealPlan");
  const { theme } = useUnistyles();
  return (
    <Card style={styles.nearby}>
      <Text style={styles.nearbyTitle}>{t("shopping.nearbyTitle")}</Text>
      {PLACES.map((place) => {
        const label = t(place === "market" ? "shopping.nearbyMarket" : "shopping.nearbySupermarket");
        return (
          <PressableScale
            key={place}
            accessibilityRole="link"
            accessibilityLabel={label}
            onPress={() => void Linking.openURL(shopPlaceUrl(place))}
            scaleTo={0.99}
            dimTo={0.8}
            style={styles.nearbyRow}
          >
            <Ionicons name={place === "market" ? "location" : "storefront"} size={20} color={theme.colors.primary} />
            <Text style={styles.nearbyLabel}>{label}</Text>
            <Ionicons name="open-outline" size={18} color={theme.colors.mutedForeground} />
          </PressableScale>
        );
      })}
    </Card>
  );
}

/** Ingredients of the meals still ahead, grouped by where they are bought, with a tick per item. */
export function ShoppingTab() {
  const { t } = useTranslation("mealPlan");
  const { theme } = useUnistyles();
  const checkItem = useCheckItem();
  const shopping = useQuery(orpc.mealPlan.shopping.queryOptions());

  useEffect(() => {
    if (shopping.error) routePaywall(shopping.error);
  }, [shopping.error]);

  if (shopping.isPending) {
    return (
      <>
        <Skeleton width="100%" height={84} radius={24} />
        <Skeleton width="100%" height={200} radius={24} />
      </>
    );
  }
  if (shopping.isError) {
    return <ErrorState message={errorMessage(shopping.error)} onRetry={() => void shopping.refetch()} />;
  }

  const { groups, total, checked } = shopping.data;
  if (total === 0) {
    return <EmptyState icon="cart-outline" title={t("shopping.title")} description={t("shopping.empty")} />;
  }
  const progress = total > 0 ? (checked / total) * 100 : 0;

  return (
    <>
      <Card style={styles.progress}>
        <Text style={styles.subtitle}>{t("shopping.subtitle")}</Text>
        <View
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel={t("shopping.progress", { done: checked, total })}
          accessibilityValue={{ min: 0, max: total, now: checked }}
          style={styles.progressBody}
        >
          <Text style={styles.progressText}>{t("shopping.progress", { done: checked, total })}</Text>
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${progress}%` }]} />
          </View>
        </View>
      </Card>

      <NearbyShops />

      {groups.map((group) => (
        <View key={group.cat} style={styles.group}>
          <SectionTitle title={group.label} />
          <ListGroup>
            {group.items.map((item) => (
              <PressableScale
                key={item.key}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: item.checked }}
                accessibilityLabel={`${item.name}, ${item.amount}`}
                onPress={() => checkItem.mutate({ key: item.key, checked: !item.checked })}
                scaleTo={1}
                dimTo={0.7}
                style={styles.row}
              >
                <View style={[styles.box, item.checked && styles.boxChecked]}>
                  {item.checked ? <Ionicons name="checkmark" size={16} color={theme.colors.primaryForeground} /> : null}
                </View>
                <View style={styles.rowText}>
                  <Text style={[styles.name, item.checked && styles.nameChecked]}>{item.name}</Text>
                  <Text style={styles.uses}>{t("shopping.inMenus", { n: item.uses })}</Text>
                </View>
                <Text style={[styles.amount, item.checked && styles.nameChecked]}>{item.amount}</Text>
              </PressableScale>
            ))}
          </ListGroup>
        </View>
      ))}

      <Text style={styles.approx}>{t("shopping.approx")}</Text>
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  progress: {
    gap: theme.spacing.md,
  },
  subtitle: {
    fontSize: theme.fontSize.sm,
    lineHeight: 19,
    color: theme.colors.mutedForeground,
  },
  progressBody: {
    gap: theme.spacing.sm,
  },
  progressText: {
    fontSize: theme.fontSize.base,
    fontWeight: "700",
  },
  track: {
    height: 8,
    borderRadius: 4,
    overflow: "hidden",
    backgroundColor: theme.colors.muted,
  },
  fill: {
    height: "100%",
    borderRadius: 4,
    backgroundColor: theme.colors.makan,
  },
  nearby: {
    gap: theme.spacing.sm,
  },
  nearbyTitle: {
    fontSize: theme.fontSize.base,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  nearbyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    minHeight: 48,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    borderRadius: theme.radius.tile,
    backgroundColor: theme.colors.muted,
  },
  nearbyLabel: {
    flex: 1,
    fontSize: theme.fontSize.base,
    fontWeight: "600",
    color: theme.colors.foreground,
  },
  group: {
    gap: theme.spacing.sm,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    minHeight: 60,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
  },
  box: {
    width: 24,
    height: 24,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: theme.colors.mutedForeground,
    alignItems: "center",
    justifyContent: "center",
  },
  boxChecked: {
    borderColor: theme.colors.primary,
    backgroundColor: theme.colors.primary,
  },
  rowText: {
    flex: 1,
    gap: 1,
  },
  name: {
    fontSize: theme.fontSize.base,
    fontWeight: "600",
    color: theme.colors.foreground,
  },
  nameChecked: {
    textDecorationLine: "line-through",
    color: theme.colors.mutedForeground,
  },
  uses: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.mutedForeground,
  },
  amount: {
    flexShrink: 1,
    maxWidth: "42%",
    textAlign: "right",
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  approx: {
    fontSize: theme.fontSize.xs,
    lineHeight: 17,
    color: theme.colors.mutedForeground,
  },
}));
