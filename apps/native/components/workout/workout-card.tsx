import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { Pressable, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { warningMessage } from "@joyorogo/api/lib/workout";

import { useGain } from "@/components/gain/use-gain";
import { Card, Text } from "@/components/ui";
import { orpc } from "@/utils/orpc";

/** Compact Beranda card: missed-muscle warnings today + door to /latihan. */
export function WorkoutCard() {
  const { theme } = useUnistyles();
  const { t } = useTranslation(["home", "gain"]);
  const { gain } = useGain();
  const status = useQuery(orpc.workout.status.queryOptions({ input: {} }));

  // Silent while loading or failing: Beranda stays calm, /latihan owns errors.
  if (status.isPending || status.isError) return null;

  const { warnings, sessionCount28d } = status.data;
  const top = warnings.slice(0, 2);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("home:workout.openLabel")}
      onPress={() => router.push("/latihan")}
      style={({ pressed }) => [styles.press, pressed && styles.pressed]}
    >
      <Card>
        <View style={styles.headRow}>
          <View style={[styles.iconChip, { backgroundColor: theme.colors.bakarSoft }]}>
            <Ionicons name="barbell" size={15} color={theme.colors.bakarText} />
          </View>
          <Text style={styles.label}>{t("home:workout.title")}</Text>
          <Ionicons name="chevron-forward" size={16} color={theme.colors.mutedForeground} />
        </View>
        {top.length > 0 ? (
          <View style={styles.warnings}>
            {top.map((warning) => (
              <Text key={warning.muscle} style={styles.warning} numberOfLines={2}>
                {warningMessage(warning)}
              </Text>
            ))}
          </View>
        ) : (
          <Text style={styles.hint}>
            {sessionCount28d > 0
              ? t("home:workout.allGood")
              : gain
                ? t("gain:coach.keepMuscle")
                : t("home:workout.keepMuscle")}
          </Text>
        )}
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  press: { borderRadius: theme.radius.card },
  pressed: { opacity: 0.7 },
  headRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm },
  iconChip: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  label: { flex: 1, fontSize: theme.fontSize.base, fontWeight: "700", color: theme.colors.foreground },
  warnings: { gap: 2, marginTop: theme.spacing.sm },
  warning: { fontSize: theme.fontSize.sm, color: theme.colors.mutedForeground },
  hint: { fontSize: theme.fontSize.sm, color: theme.colors.mutedForeground, marginTop: theme.spacing.sm },
}));
