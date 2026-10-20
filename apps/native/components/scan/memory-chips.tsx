import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { Chip } from "@/components/ui";

/**
 * "Maksudnya ini?": foods this user taught the scan by correcting it. One tap
 * runs the same correction as the Koreksi box on the first item. The parent
 * hides the row once the swap lands.
 */
export function MemoryChips({
  names,
  disabled,
  onPick,
}: {
  names: string[];
  disabled?: boolean;
  onPick: (name: string) => Promise<unknown>;
}) {
  const { t } = useTranslation("scan");
  const [busyName, setBusyName] = useState<string | null>(null);
  if (names.length === 0) return null;
  const pick = async (name: string) => {
    if (busyName) return;
    setBusyName(name);
    try {
      await onPick(name);
    } catch {
      // The correction path surfaces its own errors; the chips stay for another try.
    } finally {
      setBusyName(null);
    }
  };
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{t("result.memory.title")}</Text>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={t("result.memory.group")}
        style={styles.row}
      >
        {names.map((name) => (
          <Chip
            key={name}
            label={name.charAt(0).toUpperCase() + name.slice(1)}
            selected={busyName === name}
            disabled={disabled || busyName !== null}
            onPress={() => void pick(name)}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  wrap: {
    gap: theme.spacing.xs,
    paddingTop: theme.spacing.xs,
  },
  title: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.mutedForeground,
  },
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing.xs,
  },
}));
