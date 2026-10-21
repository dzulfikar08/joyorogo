import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { CUP_DRINKS, CUP_SIZES, cupDrinkName, cupSizeLabel } from "@joyorogo/api/lib/drink-options";
import type { CupChoice, CupSizeId } from "@joyorogo/api/lib/drink-options";
import { getActiveLocale } from "@joyorogo/i18n";

import { Chip, Segmented, Text } from "@/components/ui";

/**
 * Under a scan row for a cup whose contents the photo hides: the usual drinks
 * as a wrapping chip cloud and the cup size as one compact segmented control.
 * The row's numbers come from the pick (cupPick), so choosing Coke Zero is
 * 0 kcal rather than a guess.
 */
export function CupChoices({
  choice,
  onPick,
}: {
  choice: CupChoice;
  onPick: (next: CupChoice) => void;
}) {
  const { t } = useTranslation("scan");
  const locale = getActiveLocale();
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{t("result.items.cupWhich")}</Text>
      <View style={styles.row}>
        {CUP_DRINKS.map((drink) => (
          <Chip
            key={drink.id}
            compact
            label={cupDrinkName(drink.id, locale)}
            selected={choice.drink === drink.id}
            onPress={() => onPick({ ...choice, drink: drink.id })}
          />
        ))}
      </View>
      <View accessibilityRole="radiogroup" accessibilityLabel={t("result.items.cupSize")}>
        <Segmented<CupSizeId>
          compact
          options={CUP_SIZES.map((size) => ({ value: size.id, label: cupSizeLabel(size.id) }))}
          value={choice.size}
          onChange={(size) => onPick({ ...choice, size })}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  wrap: {
    gap: theme.spacing.sm,
  },
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing.xs,
  },
  label: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.mutedForeground,
  },
}));
