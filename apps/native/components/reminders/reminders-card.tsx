import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Switch, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { fmtHHMM, windowHoursFor, windowTimes } from "@joyorogo/api/lib/fasting";

import { Button, ListGroup, ListRow, Segmented, Text } from "@/components/ui";
import { useNotificationGate } from "@/components/reminders/permission-sheet";
import { TimePickerSheet } from "@/components/reminders/time-picker-sheet";
import { useToast } from "@/components/toast";
import {
  DEFAULT_REMINDER_CONFIG,
  getNotificationPermission,
  loadReminderConfig,
  MEAL_REMINDER_KEYS,
  MEAL_REMINDER_LABELS,
  saveReminderConfig,
  waterSlotMinutes,
  type MealReminderKey,
  type NotificationPermission,
  type ReminderConfig,
  type WaterReminder,
} from "@/src/lib/notifications";
import { orpc } from "@/utils/orpc";

type TimeTarget =
  | { kind: "meal"; key: MealReminderKey }
  | { kind: "weighIn" }
  | { kind: "waterStart" }
  | { kind: "waterEnd" };

const INTERVAL_OPTIONS: Array<{ value: "2" | "3" | "4"; label: string }> = [
  { value: "2", label: "2 jam" },
  { value: "3", label: "3 jam" },
  { value: "4", label: "4 jam" },
];

function anyEnabled(config: ReminderConfig): boolean {
  return (
    MEAL_REMINDER_KEYS.some((key) => config.meals[key].enabled) ||
    config.water.enabled ||
    config.weighIn.enabled ||
    config.window.open ||
    config.window.close
  );
}

/**
 * "Pengingat" di Profil: toggle dan jam untuk makan, air minum, timbang, dan
 * jendela puasa. Semua pengingat adalah notifikasi lokal di perangkat ini
 * (tidak disimpan di server), dijadwal ulang tiap setelan atau jadwal puasa
 * berubah — lihat src/lib/notifications.ts.
 */
export function RemindersCard() {
  const { theme } = useUnistyles();
  const toast = useToast();
  const gate = useNotificationGate();
  const fasting = useQuery(orpc.fasting.settings.queryOptions());
  const [config, setConfig] = useState<ReminderConfig>(DEFAULT_REMINDER_CONFIG);
  const [loaded, setLoaded] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>("granted");
  const [target, setTarget] = useState<TimeTarget | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [stored, status] = await Promise.all([
        loadReminderConfig(),
        getNotificationPermission(),
      ]);
      if (cancelled) return;
      setConfig(stored);
      setPermission(status);
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const apply = (next: ReminderConfig) => {
    setConfig(next);
    void saveReminderConfig(next);
  };

  /** Turning a reminder on needs permission first; off never does. */
  const toggle = async (enabled: boolean, change: (value: boolean) => ReminderConfig) => {
    if (enabled && !(await gate.ensure())) {
      setPermission(await getNotificationPermission());
      return;
    }
    setPermission("granted");
    apply(change(enabled));
  };

  const fixPermission = async () => {
    if (await gate.ensure()) {
      setPermission("granted");
      void saveReminderConfig(config);
    } else {
      setPermission(await getNotificationPermission());
    }
  };

  const setMeal = (key: MealReminderKey, patch: Partial<ReminderConfig["meals"][MealReminderKey]>) =>
    ({
      ...config,
      meals: { ...config.meals, [key]: { ...config.meals[key], ...patch } },
    }) satisfies ReminderConfig;
  const setWater = (patch: Partial<WaterReminder>) =>
    ({ ...config, water: { ...config.water, ...patch } }) satisfies ReminderConfig;

  const fastingSettings = fasting.data;
  const pattern = fastingSettings && fastingSettings.pattern !== "off" ? fastingSettings.pattern : null;
  const fastingNotifyOn = pattern !== null && fastingSettings?.notify === true;
  const window =
    pattern !== null && fastingSettings
      ? windowTimes(fastingSettings.windowStart, windowHoursFor(pattern))
      : null;

  const slots = waterSlotMinutes(config.water).length;

  const sheetTitle =
    target === null
      ? ""
      : target.kind === "meal"
        ? `Jam ${MEAL_REMINDER_LABELS[target.key].toLowerCase()}`
        : target.kind === "weighIn"
          ? "Jam timbang"
          : target.kind === "waterStart"
            ? "Mulai minum"
            : "Selesai minum";
  const sheetValue =
    target === null
      ? "00:00"
      : target.kind === "meal"
        ? config.meals[target.key].time
        : target.kind === "weighIn"
          ? config.weighIn.time
          : target.kind === "waterStart"
            ? config.water.start
            : config.water.end;

  const saveTime = (time: string) => {
    if (target === null) return;
    if (target.kind === "waterStart" && time > config.water.end) {
      toast.error("Jam tidak valid", "Jam mulai harus sebelum jam selesai.");
      return;
    }
    if (target.kind === "waterEnd" && time < config.water.start) {
      toast.error("Jam tidak valid", "Jam selesai harus setelah jam mulai.");
      return;
    }
    setTarget(null);
    if (target.kind === "meal") apply(setMeal(target.key, { time }));
    else if (target.kind === "weighIn") apply({ ...config, weighIn: { ...config.weighIn, time } });
    else if (target.kind === "waterStart") apply(setWater({ start: time }));
    else apply(setWater({ end: time }));
  };

  const switchProps = {
    trackColor: { false: theme.colors.muted, true: theme.colors.primary },
    thumbColor: theme.colors.background,
    disabled: !loaded,
  } as const;

  return (
    <>
      <Text style={styles.sectionLabel}>Pengingat</Text>

      {loaded && permission !== "granted" && anyEnabled(config) ? (
        <View style={styles.warning}>
          <Text style={styles.warningText}>
            Notifikasi JoyoRogo sedang dimatikan di sistem, jadi pengingat di bawah tidak muncul.
          </Text>
          <Button
            variant="secondary"
            size="sm"
            label="Aktifkan notifikasi"
            onPress={() => void fixPermission()}
          />
        </View>
      ) : null}

      <ListGroup>
        {MEAL_REMINDER_KEYS.map((key) => {
          const meal = config.meals[key];
          return (
            <ListRow
              key={key}
              icon="restaurant"
              iconTint="makan"
              title={MEAL_REMINDER_LABELS[key]}
              subtitle={fastingNotifyOn ? "Diganti jadwal puasa" : undefined}
              value={meal.time}
              onPress={() => setTarget({ kind: "meal", key })}
              right={
                <Switch
                  {...switchProps}
                  value={meal.enabled}
                  onValueChange={(value) =>
                    void toggle(value, (enabled) => setMeal(key, { enabled }))
                  }
                  accessibilityLabel={`Pengingat ${MEAL_REMINDER_LABELS[key].toLowerCase()}`}
                />
              }
            />
          );
        })}
      </ListGroup>
      {fastingNotifyOn ? (
        <Text style={styles.note}>
          Notifikasi puasa intermiten aktif, jadi pengingat makan memakai jadwal puasa dan jam di
          atas tidak dipakai.
        </Text>
      ) : null}

      <ListGroup>
        <ListRow
          icon="water"
          iconTint="tidur"
          title="Air minum"
          subtitle={
            config.water.enabled
              ? `${slots} kali sehari, tiap ${config.water.everyHours} jam`
              : undefined
          }
          right={
            <Switch
              {...switchProps}
              value={config.water.enabled}
              onValueChange={(value) => void toggle(value, (enabled) => setWater({ enabled }))}
              accessibilityLabel="Pengingat minum air"
            />
          }
        />
        {config.water.enabled ? (
          <ListRow
            title="Mulai"
            value={config.water.start}
            onPress={() => setTarget({ kind: "waterStart" })}
            chevron
          />
        ) : null}
        {config.water.enabled ? (
          <ListRow
            title="Selesai"
            value={config.water.end}
            onPress={() => setTarget({ kind: "waterEnd" })}
            chevron
          />
        ) : null}
        {config.water.enabled ? (
          <View style={styles.segmentRow}>
            <Segmented
              options={INTERVAL_OPTIONS}
              value={String(config.water.everyHours) as "2" | "3" | "4"}
              onChange={(value) => apply(setWater({ everyHours: Number(value) as 2 | 3 | 4 }))}
            />
          </View>
        ) : null}
      </ListGroup>

      <ListGroup>
        <ListRow
          icon="scale"
          iconTint="bakar"
          title="Timbang"
          value={config.weighIn.time}
          onPress={() => setTarget({ kind: "weighIn" })}
          right={
            <Switch
              {...switchProps}
              value={config.weighIn.enabled}
              onValueChange={(value) =>
                void toggle(value, (enabled) => ({
                  ...config,
                  weighIn: { ...config.weighIn, enabled },
                }))
              }
              accessibilityLabel="Pengingat timbang"
            />
          }
        />
      </ListGroup>

      <ListGroup>
        <ListRow
          icon="timer"
          iconTint="makan"
          title="Jendela makan buka"
          subtitle={window === null ? "Pilih pola puasa dulu di Puasa Intermiten" : "Ikut jadwal puasa, WIB"}
          value={window === null ? undefined : fmtHHMM(window.startMin)}
          right={
            <Switch
              {...switchProps}
              disabled={!loaded || window === null}
              value={config.window.open}
              onValueChange={(value) =>
                void toggle(value, (open) => ({ ...config, window: { ...config.window, open } }))
              }
              accessibilityLabel="Pengingat jendela makan buka"
            />
          }
        />
        <ListRow
          icon="moon"
          iconTint="tidur"
          title="Jendela makan tutup"
          subtitle={window === null ? "Pilih pola puasa dulu di Puasa Intermiten" : "Puasa dimulai, WIB"}
          value={window === null ? undefined : fmtHHMM(window.endMin)}
          right={
            <Switch
              {...switchProps}
              disabled={!loaded || window === null}
              value={config.window.close}
              onValueChange={(value) =>
                void toggle(value, (close) => ({ ...config, window: { ...config.window, close } }))
              }
              accessibilityLabel="Pengingat jendela makan tutup"
            />
          }
        />
      </ListGroup>
      {fastingNotifyOn && config.window.open ? (
        <Text style={styles.note}>
          Notifikasi puasa intermiten sudah mengingatkan saat jendela buka, jadi pengingat buka di
          sini tidak dikirim dobel.
        </Text>
      ) : null}

      <Text style={styles.note}>
        Pengingat adalah notifikasi di perangkat ini, jadi tidak ikut pindah ke ponsel lain atau web.
        Pengingat makan dan timbang dilewati kalau hari ini sudah tercatat saat JoyoRogo terakhir
        dibuka atau kamu mencatat di aplikasi. Catatan dari perangkat lain baru terbaca setelah
        aplikasi dibuka lagi. Pengingat minum selalu muncul sesuai jadwal.
      </Text>

      <TimePickerSheet
        visible={target !== null}
        onClose={() => setTarget(null)}
        title={sheetTitle}
        value={sheetValue}
        onSave={saveTime}
      />
      {gate.sheet}
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  sectionLabel: {
    fontSize: theme.fontSize.md,
    fontWeight: "700",
    color: theme.colors.foreground,
    marginTop: theme.spacing.sm,
  },
  note: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
    lineHeight: 20,
  },
  warning: {
    gap: theme.spacing.sm,
    padding: theme.spacing.md,
    borderRadius: theme.radius.tile,
    backgroundColor: theme.colors.bakarSoft,
    alignItems: "flex-start",
  },
  warningText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.bakarText,
    lineHeight: 20,
  },
  segmentRow: {
    padding: theme.spacing.md,
  },
}));
