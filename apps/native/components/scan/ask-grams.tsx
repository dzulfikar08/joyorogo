import { useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import type { SizeOptions } from "@joyorogo/api/lib/ask-grams";
import { MAX_GRAMS } from "@joyorogo/api/lib/portion";

import { Button, Chip, Input, Text } from "@/components/ui";
import { fmtGramsLabel } from "@/utils/format";

const SIZE_KEYS = ["askGramsSmall", "askGramsMedium", "askGramsLarge"] as const;

/**
 * Under a scan row whose only weight is the model's bowl / plate default (lib/ask-grams.ts): "Berapa gram? Timbang
 * biar akurat". For people without a scale, `sizes` (when the library knows the dish) are three one-tap chips,
 * "Kecil · 175 g" / "Sedang" / "Besar", the dish's typical serving x 0.5 / 1 / 1.5. The prompt opens a small grams
 * box with the keyboard up; "Pakai" (or the keyboard's done key) and a chip hand the weight to `onApply`
 * (itemAtTypedGrams: kcal and macros follow, the row is stamped `typed` or `size`). Compact chips are 32 pt high
 * with a 6 pt hit slop, so every tap target is 44 pt.
 */
export function AskGrams({
  name,
  sizes,
  onApply,
}: {
  name: string;
  sizes?: SizeOptions;
  onApply: (grams: number, source: "typed" | "size") => void;
}) {
  const { t } = useTranslation("scan");
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const grams = Number(typed.replace(",", "."));
  const usable = Number.isFinite(grams) && grams >= 1;
  const apply = () => {
    if (usable) onApply(Math.min(MAX_GRAMS, Math.round(grams)), "typed");
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <Chip compact label={t("result.items.askGrams")} selected={open} onPress={() => setOpen((was) => !was)} />
      </View>
      {sizes ? (
        <View
          accessibilityRole="radiogroup"
          accessibilityLabel={t("result.items.askGramsSizes", { name })}
          style={styles.row}
        >
          {sizes.map((g, i) => (
            <Chip
              key={SIZE_KEYS[i]}
              compact
              label={t(`result.items.${SIZE_KEYS[i]!}`, { grams: fmtGramsLabel(g) })}
              onPress={() => onApply(g, "size")}
            />
          ))}
        </View>
      ) : null}
      {open ? (
        <View style={styles.inputRow}>
          <Input
            autoFocus
            value={typed}
            onChangeText={(text) => setTyped(text.replace(/[^\d.,]/g, ""))}
            keyboardType="number-pad"
            returnKeyType="done"
            onSubmitEditing={apply}
            placeholder="0"
            accessibilityLabel={t("result.items.askGramsInput", { name })}
            style={styles.input}
          />
          <Text style={styles.unit}>g</Text>
          <Button size="sm" label={t("result.items.askGramsApply")} disabled={!usable} onPress={apply} />
        </View>
      ) : null}
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
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
  },
  input: {
    width: 88,
    textAlign: "right",
    fontVariant: ["tabular-nums"],
  },
  unit: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
  },
}));
