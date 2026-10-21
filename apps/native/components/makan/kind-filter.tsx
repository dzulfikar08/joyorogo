import { Ionicons } from "@expo/vector-icons";
import { FOOD_KIND_FILTERS } from "@joyorogo/api/lib/food-kind";
import type { FoodKindFilter } from "@joyorogo/api/lib/food-kind";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { PressableScale } from "@/components/motion";
import { Sheet, Text } from "@/components/ui";

const ICONS = {
  semua: "grid-outline",
  makanan: "restaurant-outline",
  camilan: "fast-food-outline",
  minuman: "cafe-outline",
  lainnya: "bag-handle-outline",
} as const satisfies Record<FoodKindFilter, React.ComponentProps<typeof Ionicons>["name"]>;

/**
 * One filter button beside the view switcher; the kinds open in a sheet, so no
 * full-width chip row costs vertical space. A dot marks an active filter.
 */
export function KindFilter({
  value,
  onChange,
}: {
  value: FoodKindFilter;
  onChange: (kind: FoodKindFilter) => void;
}) {
  const { t } = useTranslation("makan");
  const { theme } = useUnistyles();
  const [open, setOpen] = useState(false);
  const filtered = value !== "semua";
  return (
    <>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={t("kindChips.label")}
        accessibilityState={{ selected: filtered }}
        onPress={() => setOpen(true)}
        scaleTo={0.94}
        style={[
          styles.button,
          { backgroundColor: filtered ? theme.colors.primary : theme.colors.muted },
        ]}
      >
        <Ionicons
          name="options-outline"
          size={22}
          color={filtered ? theme.colors.primaryForeground : theme.colors.mutedForeground}
        />
        {filtered ? <View style={styles.dot} /> : null}
      </PressableScale>
      <Sheet visible={open} onClose={() => setOpen(false)} title={t("kindChips.label")}>
        <View style={styles.list}>
          {FOOD_KIND_FILTERS.map((filter) => {
            const active = filter.value === value;
            const label = filter.value === "semua" ? t("kind.all") : t(`kind.${filter.value}`);
            return (
              <PressableScale
                key={filter.value}
                accessibilityRole="radio"
                accessibilityLabel={label}
                accessibilityState={{ selected: active }}
                onPress={() => {
                  onChange(filter.value);
                  setOpen(false);
                }}
                scaleTo={0.98}
                style={[styles.option, active && { backgroundColor: theme.colors.muted }]}
              >
                <Ionicons name={ICONS[filter.value]} size={20} color={theme.colors.mutedForeground} />
                <Text style={styles.label}>{label}</Text>
                {active ? <Ionicons name="checkmark" size={20} color={theme.colors.foreground} /> : null}
              </PressableScale>
            );
          })}
        </View>
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  button: {
    width: 52,
    height: 52,
    borderRadius: theme.radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  dot: {
    position: "absolute",
    top: 11,
    right: 11,
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: theme.colors.primaryForeground,
    borderWidth: 2,
    borderColor: theme.colors.primary,
  },
  list: {
    gap: 4,
  },
  option: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: theme.spacing.md,
    borderRadius: theme.radius.tile,
  },
  label: {
    flex: 1,
    fontSize: theme.fontSize.md,
    fontWeight: "600",
    color: theme.colors.foreground,
  },
}));
