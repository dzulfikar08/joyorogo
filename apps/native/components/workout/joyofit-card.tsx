import { Ionicons } from "@expo/vector-icons";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { Button, Card, Text } from "@/components/ui";
import { installJoyoFit, openJoyoFit } from "@/lib/workout/joyofit";

/** Strength training lives in JoyoFit: open it, or get it from the store. */
export function JoyoFitCard() {
  const { theme } = useUnistyles();
  const { t } = useTranslation("olahraga");

  return (
    <Card>
      <View style={styles.headRow}>
        <View style={[styles.iconChip, { backgroundColor: theme.colors.bakarSoft }]}>
          <Ionicons name="barbell" size={15} color={theme.colors.bakarText} />
        </View>
        <Text style={styles.label}>{t("moved.title")}</Text>
      </View>
      <Text style={styles.hint}>{t("moved.body")}</Text>
      <View style={styles.actions}>
        <Button size="sm" label={t("moved.open")} onPress={() => void openJoyoFit()} />
        <Button
          size="sm"
          variant="secondary"
          label={t("moved.install")}
          onPress={() => void installJoyoFit().catch(() => {})}
        />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create((theme) => ({
  headRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm },
  iconChip: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  label: { flex: 1, fontSize: theme.fontSize.base, fontWeight: "700", color: theme.colors.foreground },
  hint: { fontSize: theme.fontSize.sm, color: theme.colors.mutedForeground, marginTop: theme.spacing.sm },
  actions: { flexDirection: "row", gap: theme.spacing.sm, marginTop: theme.spacing.md },
}));
