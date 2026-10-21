import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { chipGrams, priorLabelKey } from "@joyorogo/api/lib/portion-chip";
import type { PortionPriorChip } from "@joyorogo/api/lib/portion-chip";

import { Chip } from "@/components/ui";
import { fmtGramsLabel } from "@/utils/format";

/**
 * Under a scan row that has a second portion (lib/portion-prior.ts): "AI: 150 g" and either
 * "Biasanya kamu: 100 g" (the user's own history) or "Biasanya: 100 g" (the typical rice
 * portion), one tap to switch. The row's numbers follow the pick (swapPortionPrior).
 */
export function PortionPriorChips({
  name,
  item,
  onSwap,
}: {
  name: string;
  item: { grams?: number; portionPrior?: PortionPriorChip };
  onSwap: () => void;
}) {
  const { t } = useTranslation("scan");
  const grams = chipGrams(item);
  if (!grams) return null;
  const usualActive = item.portionPrior!.active === "prior";
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={t("result.items.priorGroup", { name })}
      style={styles.row}
    >
      <Chip
        compact
        label={t("result.items.priorAi", { grams: fmtGramsLabel(grams.ai) })}
        selected={!usualActive}
        onPress={usualActive ? onSwap : () => {}}
      />
      <Chip
        compact
        label={t(priorLabelKey(item.portionPrior!), { grams: fmtGramsLabel(grams.usual) })}
        selected={usualActive}
        onPress={usualActive ? () => {} : onSwap}
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
