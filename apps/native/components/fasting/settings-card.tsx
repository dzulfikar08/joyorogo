import { useMutation, useQuery } from "@tanstack/react-query";
import { Switch, View } from "react-native";
import { useEffect, useRef, useState } from "react";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { jakartaToday } from "@joyorogo/api/lib/engine";
import {
  dayReminders,
  type FastingPattern,
  FASTING_LABELS,
  parseHHMM,
  fmtHHMM,
} from "@joyorogo/api/lib/fasting";

import { Card, Input, Segmented, Text } from "@/components/ui";
import { setFastingReminders, type FastingReminder } from "@/src/lib/notifications";
import { errorMessage } from "@/utils/format";
import { orpc, queryClient } from "@/utils/orpc";

type FastingSettings = {
  pattern: "off" | FastingPattern;
  windowStart: string;
  notify: boolean;
};

const PATTERN_OPTIONS: Array<{ value: FastingSettings["pattern"]; label: string }> = [
  { value: "off", label: "Mati" },
  { value: "16:8", label: "16:8" },
  { value: "18:6", label: "18:6" },
  { value: "20:4", label: "20:4" },
  { value: "omad", label: "OMAD" },
];

/** lib/fasting reminder drafts → expo-notifications calendar slots (WIB). */
function buildNativeReminders(
  pattern: FastingPattern,
  windowStart: string,
  remainingKcal: number,
): FastingReminder[] {
  return dayReminders({
    pattern,
    windowStart,
    dateKey: jakartaToday(),
    remainingKcal,
  }).map((draft) => ({
    hour: Math.floor(draft.atMin / 60),
    minute: draft.atMin % 60,
    title: draft.title,
    body: draft.body,
  }));
}

/**
 * "Puasa Intermiten" setelan di Profil: pola, jam buka jendela, dan toggle
 * notifikasi lokal expo-notifications (menggantikan pengingat makan tetap).
 */
export function FastingSettingsCard() {
  const { theme } = useUnistyles();
  const settings = useQuery(orpc.fasting.settings.queryOptions());
  const today = useQuery(orpc.fasting.today.queryOptions({ input: {} }));
  const [windowText, setWindowText] = useState<string | null>(null);

  // Reschedule once on mount so the saved schedule keeps firing after
  // reboots — same habit as the fixed meal reminders. Later refetches only
  // change kcal copy; the times stay put until the user edits settings.
  const bootstrapped = useRef(false);
  useEffect(() => {
    if (bootstrapped.current) return;
    const data = settings.data;
    if (!data || data.pattern === "off" || !data.notify || !today.data) return;
    bootstrapped.current = true;
    void setFastingReminders(
      true,
      buildNativeReminders(data.pattern, data.windowStart, today.data.remainingKcal),
    );
  }, [settings.data, today.data]);

  const save = useMutation(
    orpc.fasting.setSettings.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: orpc.fasting.key() });
      },
    }),
  );

  if (settings.isPending || !settings.data) {
    return (
      <Card>
        <Skeleton />
      </Card>
    );
  }

  const data = settings.data;
  const remaining = today.data?.remainingKcal ?? 0;

  const commit = (patch: Partial<FastingSettings>) => {
    save.mutate({ ...data, ...patch });
    // Jendela berubah saat notifikasi sudah menyala → jadwal ikut bergeser.
    const pattern = patch.pattern ?? data.pattern;
    const windowStart = patch.windowStart ?? data.windowStart;
    if (patch.pattern !== undefined || patch.windowStart !== undefined) {
      if (pattern !== "off" && data.notify) {
        void setFastingReminders(true, buildNativeReminders(pattern, windowStart, remaining));
      }
    }
  };

  const toggleNotify = async (enabled: boolean) => {
    if (enabled && (data.pattern === "off" || !today.data)) {
      commit({ notify: false });
      return;
    }
    const reminders = enabled
      ? buildNativeReminders(data.pattern as FastingPattern, data.windowStart, remaining)
      : null;
    const effective = await setFastingReminders(enabled, reminders);
    commit({ notify: effective });
  };

  const commitWindow = () => {
    if (windowText === null) return;
    const minutes = parseHHMM(windowText);
    setWindowText(null);
    if (minutes === null || fmtHHMM(minutes) === data.windowStart) return;
    commit({ windowStart: fmtHHMM(minutes) });
  };

  return (
    <Card>
      <Text style={styles.cardTitle}>Puasa Intermiten</Text>
      <Segmented
        options={PATTERN_OPTIONS}
        value={data.pattern}
        onChange={(value) => commit({ pattern: value })}
        disabled={save.isPending}
      />
      <View style={styles.windowRow}>
        <Text style={styles.windowLabel}>Jendela makan buka</Text>
        <Input
          value={windowText ?? data.windowStart}
          onChangeText={setWindowText}
          onEndEditing={commitWindow}
          placeholder={data.windowStart}
          keyboardType="numbers-and-punctuation"
          maxLength={5}
          editable={data.pattern !== "off" && !save.isPending}
          style={styles.windowInput}
        />
      </View>
      <View style={styles.switchRow}>
        <View style={styles.switchText}>
          <Text style={styles.rowTitle}>Notifikasi pengingat</Text>
        </View>
        <Switch
          value={data.notify}
          onValueChange={(value) => void toggleNotify(value)}
          disabled={save.isPending || data.pattern === "off"}
          trackColor={{ false: theme.colors.muted, true: theme.colors.primary }}
          thumbColor={theme.colors.background}
          accessibilityLabel="Notifikasi pengingat puasa intermiten"
        />
      </View>
      <Text style={styles.note}>
        {data.pattern === "off"
          ? "Pilih pola 16:8, 18:6, 20:4, atau OMAD untuk mulai. Mode Ramadan tetap didahulukan."
          : `${FASTING_LABELS[data.pattern]}: notifikasi muncul saat jendela buka, waktu makan, dan 30 menit sebelum tutup.`}
      </Text>
      {save.isError ? <Text style={styles.error}>{errorMessage(save.error)}</Text> : null}
    </Card>
  );
}

function Skeleton() {
  return <View style={styles.skeleton} />;
}

const styles = StyleSheet.create((theme) => ({
  cardTitle: {
    fontSize: theme.fontSize.md,
    fontWeight: "700",
    color: theme.colors.foreground,
    marginBottom: theme.spacing.sm,
  },
  windowRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing.md,
    marginTop: theme.spacing.md,
  },
  windowLabel: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
  },
  windowInput: {
    width: 96,
    textAlign: "center",
  },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing.md,
    marginTop: theme.spacing.md,
    minHeight: 44,
  },
  switchText: {
    flex: 1,
  },
  rowTitle: {
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
  error: {
    marginTop: theme.spacing.xs,
    fontSize: theme.fontSize.xs,
    color: theme.colors.destructive,
  },
  skeleton: {
    height: 96,
    borderRadius: theme.radius.input,
    backgroundColor: theme.colors.muted,
  },
}));
