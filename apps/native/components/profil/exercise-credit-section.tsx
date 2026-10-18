import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { Switch, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import {
  ADD_BACK_CAPS,
  ADD_BACK_PCT,
  ASSUMED_ACTIVITY_KCAL,
  DEFAULT_ADD_BACK_SETTINGS,
  type AddBackCap,
  type AddBackPrefKey,
  type AddBackSettings,
} from "@joyorogo/api/lib/exercise-credit";

import { PressableScale } from "@/components/motion";
import { Card, Segmented, Text } from "@/components/ui";
import { loadAddBackSettings, saveAddBackPref } from "@/src/lib/exercise-credit-prefs";
import { syncPrefs } from "@/src/lib/prefs-sync";
import { fmtInt } from "@/utils/format";
import { orpc, queryClient } from "@/utils/orpc";

// The synced preference behind each field of the settings.
const PREF_KEY: Record<keyof AddBackSettings, AddBackPrefKey> = {
  enabled: "exercise.addBack.enabled",
  pct: "exercise.addBack.pct",
  cap: "exercise.addBack.cap",
  assumedKcal: "exercise.assumedActive",
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

/** Profil > Target & tubuh: how much of the recorded exercise Sisa adds back. Each edit syncs and refreshes Beranda. */
export function ExerciseCreditSection() {
  const { t } = useTranslation("settings");
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
      <Text style={styles.cardTitle}>{t("exerciseCredit.title")}</Text>

      <View style={styles.switchRow}>
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
      <Text style={styles.note}>{t("exerciseCredit.enabled.hint")}</Text>

      {settings.enabled ? (
        <>
          <Text style={styles.rowTitleBlock}>{t("exerciseCredit.pct.title")}</Text>
          <Stepper
            value={settings.pct}
            range={ADD_BACK_PCT}
            label={t("exerciseCredit.pct.aria")}
            display={t("exerciseCredit.pct.value", { pct: settings.pct })}
            onChange={(next) => void commit("pct", next)}
          />
          <Text style={styles.note}>{t("exerciseCredit.pct.hint")}</Text>

          <Text style={styles.rowTitleBlock}>{t("exerciseCredit.cap.title")}</Text>
          <Segmented<string>
            options={ADD_BACK_CAPS.map((cap) => ({ value: String(cap), label: capLabel(cap) }))}
            value={String(settings.cap)}
            onChange={(next) => {
              const cap = ADD_BACK_CAPS.find((candidate) => String(candidate) === next);
              void commit("cap", cap ?? DEFAULT_ADD_BACK_SETTINGS.cap);
            }}
          />
          <Text style={styles.note}>{t("exerciseCredit.cap.hint")}</Text>
        </>
      ) : null}

      <Text style={styles.rowTitleBlock}>{t("exerciseCredit.assumed.title")}</Text>
      <Segmented<string>
        options={ASSUMED_ACTIVITY_KCAL.map((kcal) => ({
          value: String(kcal),
          label:
            kcal === 0
              ? t("exerciseCredit.assumed.none")
              : kcal === 150
                ? t("exerciseCredit.assumed.light", { kcal })
                : kcal === 300
                  ? t("exerciseCredit.assumed.moderate", { kcal })
                  : t("exerciseCredit.assumed.active", { kcal }),
        }))}
        value={String(settings.assumedKcal)}
        onChange={(next) => {
          const kcal = ASSUMED_ACTIVITY_KCAL.find((candidate) => String(candidate) === next);
          void commit("assumedKcal", kcal ?? DEFAULT_ADD_BACK_SETTINGS.assumedKcal);
        }}
      />
      <Text style={styles.note}>{t("exerciseCredit.assumed.hint")}</Text>
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
  note: {
    marginTop: theme.spacing.sm,
    fontSize: theme.fontSize.xs,
    lineHeight: 18,
    color: theme.colors.mutedForeground,
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
