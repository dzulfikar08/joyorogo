import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { Switch, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import {
  ADD_BACK_CAPS,
  ADD_BACK_PCT,
  type AddBackCap,
  type AddBackPrefKey,
  type AddBackSettings,
} from "@joyorogo/api/lib/exercise-credit";

import { PressableScale } from "@/components/motion";
import { Card, Chip, Text } from "@/components/ui";
import { loadAddBackSettings, saveAddBackPref } from "@/src/lib/exercise-credit-prefs";
import { syncPrefs } from "@/src/lib/prefs-sync";
import { fmtInt } from "@/utils/format";
import { orpc, queryClient } from "@/utils/orpc";

// The synced preference behind each field of the settings.
const PREF_KEY: Record<keyof AddBackSettings, AddBackPrefKey> = {
  enabled: "exercise.addBack.enabled",
  pct: "exercise.addBack.pct",
  cap: "exercise.addBack.cap",
};

type Range = { min: number; max: number; step: number };

function Stepper({
  value,
  range,
  label,
  display,
  onChange,
}: {
  value: number;
  range: Range;
  label: string;
  display: string;
  onChange: (next: number) => void;
}) {
  const { theme } = useUnistyles();
  const atMin = value <= range.min;
  const atMax = value >= range.max;
  return (
    <View style={styles.stepper} accessibilityRole="adjustable" accessibilityLabel={label}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={`${label} -`}
        disabled={atMin}
        onPress={() => onChange(Math.max(range.min, value - range.step))}
        style={[styles.stepButton, atMin && styles.disabled]}
      >
        <Ionicons name="remove" size={20} color={theme.colors.foreground} />
      </PressableScale>
      <Text style={styles.stepValue}>{display}</Text>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={`${label} +`}
        disabled={atMax}
        onPress={() => onChange(Math.min(range.max, value + range.step))}
        style={[styles.stepButton, atMax && styles.disabled]}
      >
        <Ionicons name="add" size={20} color={theme.colors.foreground} />
      </PressableScale>
    </View>
  );
}

/** The extra movement (kcal) that `energy:credit.pct.example` is worked on. */
const EXAMPLE_EXTRA_KCAL = 400;

/**
 * Profil > Target & tubuh: how much of the movement above the level's factor Sisa adds, with what the percentage and
 * the cap do in the person's own numbers. Each edit syncs and refreshes Beranda.
 */
export function ExerciseCreditSection({ includedKcal }: { includedKcal: number }) {
  const { t } = useTranslation(["settings", "energy"]);
  const { theme } = useUnistyles();
  const [settings, setSettings] = useState<AddBackSettings | null>(null);

  useEffect(() => {
    let live = true;
    void loadAddBackSettings().then((loaded) => {
      if (live) setSettings(loaded);
    });
    return () => {
      live = false;
    };
  }, []);

  if (!settings) return null;

  // Stores and queues the edit, pushes it (the server reads the synced record), then refreshes what depends on Sisa.
  const commit = async <K extends keyof AddBackSettings>(field: K, value: AddBackSettings[K]) => {
    setSettings({ ...settings, [field]: value });
    const key = PREF_KEY[field];
    await saveAddBackPref(key, value);
    await syncPrefs().catch(() => null);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: orpc.day.summary.key() }),
      queryClient.invalidateQueries({ queryKey: orpc.fasting.today.key() }),
    ]);
  };

  const capLabel = (cap: AddBackCap) =>
    cap === "none" ? t("exerciseCredit.cap.none") : t("exerciseCredit.cap.kcal", { kcal: fmtInt(cap) });

  return (
    <Card>
      <Text style={styles.cardTitle}>{t("energy:credit.title")}</Text>
      <Text style={styles.body}>{t("energy:credit.how", { kcal: fmtInt(includedKcal) })}</Text>
      <Text style={styles.note}>{t("energy:credit.deskNote")}</Text>

      <View style={[styles.switchRow, styles.switchGap]}>
        <View style={styles.switchText}>
          <Text style={styles.rowTitle}>{t("exerciseCredit.enabled.title")}</Text>
        </View>
        <Switch
          value={settings.enabled}
          onValueChange={(value) => void commit("enabled", value)}
          trackColor={{ false: theme.colors.muted, true: theme.colors.primary }}
          thumbColor={theme.colors.background}
          accessibilityLabel={t("exerciseCredit.enabled.title")}
        />
      </View>

      {settings.enabled ? (
        <>
          <Text style={styles.rowTitleBlock}>{t("energy:credit.pct.title")}</Text>
          <Stepper
            value={settings.pct}
            range={ADD_BACK_PCT}
            label={t("exerciseCredit.pct.aria")}
            display={t("exerciseCredit.pct.value", { pct: settings.pct })}
            onChange={(next) => void commit("pct", next)}
          />
          <Text style={styles.note}>{t("energy:credit.pct.body")}</Text>
          <Text style={styles.example}>
            {t("energy:credit.pct.example", {
              pct: settings.pct,
              added: fmtInt((EXAMPLE_EXTRA_KCAL * settings.pct) / 100),
            })}
          </Text>

          <Text style={styles.rowTitleBlock}>{t("energy:credit.cap.title")}</Text>
          <View style={styles.capRow} accessibilityRole="radiogroup">
            {ADD_BACK_CAPS.map((cap) => (
              <Chip
                key={String(cap)}
                label={capLabel(cap)}
                selected={settings.cap === cap}
                onPress={() => void commit("cap", cap)}
              />
            ))}
          </View>
          <Text style={styles.note}>{t("energy:credit.cap.body")}</Text>
          <Text style={styles.example}>
            {settings.cap === "none"
              ? t("energy:credit.cap.exampleNone", { pct: settings.pct })
              : t("energy:credit.cap.example", { cap: fmtInt(settings.cap) })}
          </Text>
        </>
      ) : (
        <Text style={styles.example}>{t("energy:credit.off")}</Text>
      )}
    </Card>
  );
}

const styles = StyleSheet.create((theme) => ({
  cardTitle: {
    fontSize: theme.fontSize.md,
    fontWeight: "700",
    color: theme.colors.foreground,
    marginBottom: theme.spacing.sm,
  },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing.md,
    minHeight: 44,
  },
  switchText: { flex: 1 },
  rowTitle: {
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    color: theme.colors.foreground,
  },
  rowTitleBlock: {
    marginTop: theme.spacing.md,
    marginBottom: theme.spacing.sm,
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    color: theme.colors.foreground,
  },
  body: {
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
    color: theme.colors.foreground,
  },
  note: {
    marginTop: theme.spacing.sm,
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
    color: theme.colors.mutedForeground,
  },
  example: {
    marginTop: theme.spacing.xs,
    fontSize: theme.fontSize.xs,
    lineHeight: 18,
    fontWeight: "600",
    color: theme.colors.makanText,
  },
  switchGap: { marginTop: theme.spacing.md },
  capRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing.sm,
  },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing.md,
  },
  stepButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.muted,
  },
  stepValue: {
    flex: 1,
    textAlign: "center",
    fontSize: theme.fontSize.md,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  disabled: { opacity: 0.4 },
}));
