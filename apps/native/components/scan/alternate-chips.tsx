import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { Chip } from "@/components/ui";

/**
 * "Mungkin juga:" under a scan row the model was unsure about (`item.alt`): one tap renames the row to that
 * dish through the Koreksi box's own correction (`bukan <name>, <dish>`), so grams, kcal and macros are the
 * ones a typed rename gets. The screen applies the patch with undo.
 */
export function AlternateChips({
  name,
  names,
  disabled,
  onPick,
}: {
  name: string;
  names: readonly string[];
  disabled?: boolean;
  onPick: (alternate: string) => Promise<unknown>;
}) {
  const { t } = useTranslation("scan");
  const [busyName, setBusyName] = useState<string | null>(null);
  if (names.length === 0) return null;
  const pick = async (alternate: string) => {
    if (busyName) return;
    setBusyName(alternate);
    try {
      await onPick(alternate);
    } catch {
      // The correction path surfaces its own errors; the chips stay for another try.
    } finally {
      setBusyName(null);
    }
  };
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={t("result.items.altGroup", { name })}
      style={styles.row}
    >
      <Text style={styles.title}>{t("result.items.altTitle")}</Text>
      {names.map((alternate) => (
        <Chip
          key={alternate}
          compact
          label={alternate.charAt(0).toUpperCase() + alternate.slice(1)}
          selected={busyName === alternate}
          disabled={disabled || busyName !== null}
          onPress={() => void pick(alternate)}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  title: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.mutedForeground,
  },
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: theme.spacing.xs,
  },
}));
