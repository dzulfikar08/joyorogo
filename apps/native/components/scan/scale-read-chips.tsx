import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { scaleGrams, scaleValue } from "@joyorogo/api/lib/scale-chip";
import type { ScaleReadChip } from "@joyorogo/api/lib/scale-chip";

import { Chip } from "@/components/ui";
import { fmtGramsLabel } from "@/utils/format";

/**
 * Under a scan row whose weight was read off a kitchen-scale display in the
 * photo (lib/scale-reading.ts): "Terbaca dari timbangan: 100 g" and "Perkiraan
 * foto: 150 g", one tap to switch. The row's numbers follow the pick
 * (swapScaleRead); the grams can still be corrected in the box below.
 */
export function ScaleReadChips({
  name,
  item,
  onSwap,
}: {
  name: string;
  item: { grams?: number; scaleRead?: ScaleReadChip };
  onSwap: () => void;
}) {
  const { t } = useTranslation("scan");
  const grams = scaleGrams(item);
  const chip = item.scaleRead;
  if (!grams || !chip) return null;
  const scaleActive = chip.active === "scale";
  const value = scaleValue(chip, fmtGramsLabel);
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={t("result.items.scaleGroup", { name })}
      style={styles.row}
    >
      <Chip
        compact
        label={
          chip.count > 1
            ? t("result.items.scaleReadShared", { value, count: chip.count })
            : t("result.items.scaleRead", { value })
        }
        selected={scaleActive}
        onPress={scaleActive ? () => {} : onSwap}
      />
      <Chip
        compact
        label={t("result.items.scaleAi", { grams: fmtGramsLabel(grams.ai) })}
        selected={!scaleActive}
        onPress={scaleActive ? onSwap : () => {}}
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing.xs,
  },
}));
