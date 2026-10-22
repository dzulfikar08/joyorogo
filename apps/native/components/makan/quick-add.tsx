import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { MEAL_LABELS } from "@joyorogo/api/lib/engine";
import type { Meal } from "@joyorogo/api/lib/engine";

import { FavoritChips, FavoritOffer } from "@/components/favorit";
import type { Favorites } from "@/components/favorit";
import { PressableScale } from "@/components/motion";
import { StickerMini } from "@/components/sticker";
import { Card, Chip, Text } from "@/components/ui";
import { fmtInt } from "@/utils/format";

export type RecentFood = {
  name: string;
  kcal: number;
  grams?: number | null;
  protein?: number | null;
  carbs?: number | null;
  fat?: number | null;
  fiber?: number | null;
  scanId?: string | null;
};

/** food.add fields that repeat a recent food as it was logged: kcal and P/K/L (null = never filled in, left out). */
export function recentAddFields(food: RecentFood) {
  return {
    name: food.name,
    kcal: food.kcal,
    // A repeat of a logged row, not a new typed or scanned meal: keeps AI-meal counts and the portion prior honest.
    source: "copy" as const,
    ...(food.grams ? { grams: food.grams } : {}),
    ...(food.protein != null ? { protein: food.protein } : {}),
    ...(food.carbs != null ? { carbs: food.carbs } : {}),
    ...(food.fat != null ? { fat: food.fat } : {}),
    ...(food.fiber != null ? { fiber: food.fiber } : {}),
  };
}

/**
 * Quick add: photo, barcode and story as three equal actions, then the saved
 * favorites and the last logged foods as one-tap chips into the slot that fits
 * the time of day.
 */
export function QuickAdd({
  date,
  isToday,
  meal,
  favorites,
  recent,
  recentDisabled,
  onLogRecent,
  onStory,
  onManage,
}: {
  date: string;
  isToday: boolean;
  /** Slot the chips log to (suggested from the clock). */
  meal: Meal;
  favorites: Favorites;
  recent: ReadonlyArray<RecentFood>;
  recentDisabled: boolean;
  onLogRecent: (food: RecentFood) => void;
  onStory: () => void;
  onManage: () => void;
}) {
  const { t } = useTranslation("makan");
  const { theme } = useUnistyles();
  const actions = [
    {
      key: "photo",
      icon: "camera-outline",
      label: t("diary.quick.photo"),
      onPress: () =>
        router.push(isToday ? "/makan-ai" : { pathname: "/makan-ai", params: { date } }),
    },
    {
      key: "barcode",
      icon: "barcode-outline",
      label: t("diary.quick.barcode"),
      onPress: () =>
        router.push({
          pathname: "/makan-barcode",
          params: { ...(isToday ? {} : { date }), meal },
        }),
    },
    {
      key: "story",
      icon: "mic-outline",
      label: t("diary.quick.story"),
      onPress: onStory,
    },
  ] as const;

  return (
    <Card style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.title}>{t("diary.quick.label")}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("favorites.quick.manage")}
          onPress={onManage}
          hitSlop={8}
          style={({ pressed }) => [styles.manage, pressed && styles.pressed]}
        >
          <Ionicons name="pencil" size={14} color={theme.colors.mutedForeground} />
          <Text style={styles.manageLabel}>{t("favorites.manage")}</Text>
        </Pressable>
      </View>
      <View style={styles.actions}>
        {actions.map((action) => (
          <PressableScale
            key={action.key}
            accessibilityRole="button"
            accessibilityLabel={action.label}
            onPress={action.onPress}
            scaleTo={0.96}
            style={styles.action}
          >
            <Ionicons name={action.icon} size={20} color={theme.colors.makanText} />
            <Text style={styles.actionLabel}>{action.label}</Text>
          </PressableScale>
        ))}
      </View>
      <FavoritOffer favorites={favorites} />
      {favorites.items.length === 0 && !favorites.offer ? (
        <Text style={styles.hint}>{t("favorites.quick.empty")}</Text>
      ) : null}
      {favorites.items.length > 0 ? (
        <FavoritChips favorites={favorites} date={date} meal={meal} onManage={onManage} showManage={false} />
      ) : null}
      {recent.length > 0 ? (
        <View style={styles.recentBox}>
          <Text style={styles.hint}>{t("diary.quick.recent", { meal: MEAL_LABELS[meal] })}</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.recentRow}
          >
            {recent.map((food) => (
              <Chip
                key={food.name}
                label={`${food.name} · ${fmtInt(food.kcal)}`}
                leading={food.scanId ? <StickerMini scanId={food.scanId} size={32} /> : undefined}
                disabled={recentDisabled}
                onPress={() => onLogRecent(food)}
              />
            ))}
          </ScrollView>
        </View>
      ) : null}
    </Card>
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
    fontSize: theme.fontSize.md,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  manage: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 32,
    paddingHorizontal: theme.spacing.sm,
  },
  manageLabel: {
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    color: theme.colors.mutedForeground,
  },
  pressed: { opacity: 0.7 },
  actions: {
    flexDirection: "row",
    gap: theme.spacing.sm,
  },
  action: {
    flex: 1,
    minHeight: 56,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    borderRadius: theme.radius.tile,
    backgroundColor: theme.colors.makanSoft,
  },
  actionLabel: {
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
    color: theme.colors.makanText,
  },
  recentBox: {
    gap: theme.spacing.sm,
  },
  hint: {
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    color: theme.colors.mutedForeground,
  },
  recentRow: {
    gap: theme.spacing.sm,
    paddingRight: theme.spacing.lg,
  },
}));
