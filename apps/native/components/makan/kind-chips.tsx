import { Ionicons } from "@expo/vector-icons";
import { FOOD_KIND_FILTERS } from "@joyorogo/api/lib/food-kind";
import type { FoodKindFilter } from "@joyorogo/api/lib/food-kind";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { Text } from "@/components/ui";

const ICONS = {
  semua: "grid-outline",
  makanan: "restaurant-outline",
  camilan: "fast-food-outline",
  minuman: "cafe-outline",
  lainnya: "bag-handle-outline",
} as const satisfies Record<FoodKindFilter, React.ComponentProps<typeof Ionicons>["name"]>;

/** Semua / Makanan / Minuman / Lainnya filter row under the view switcher. */
export function KindChips({
  value,
  onChange,
}: {
  value: FoodKindFilter;
  onChange: (kind: FoodKindFilter) => void;
}) {
  const { t } = useTranslation("makan");
  const { theme } = useUnistyles();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
    >
      {FOOD_KIND_FILTERS.map((filter) => {
        const active = filter.value === value;
        const label = filter.value === "semua" ? t("kind.all") : t(`kind.${filter.value}`);
        const ink = active ? theme.colors.primaryForeground : theme.colors.foreground;
        return (
          <Pressable
            key={filter.value}
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityState={{ selected: active }}
            onPress={() => onChange(filter.value)}
            style={({ pressed }) => [
              styles.chip,
              { backgroundColor: active ? theme.colors.primary : theme.colors.muted },
              pressed && styles.pressed,
            ]}
          >
            <Ionicons name={ICONS[filter.value]} size={16} color={ink} />
            <Text style={[styles.label, { color: ink }]} numberOfLines={1}>
              {label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    gap: theme.spacing.sm,
    paddingRight: theme.spacing.lg,
  },
  chip: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: theme.spacing.lg - 4,
    borderRadius: theme.radius.pill,
  },
  label: {
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
  },
  pressed: {
    opacity: 0.6,
  },
}));
