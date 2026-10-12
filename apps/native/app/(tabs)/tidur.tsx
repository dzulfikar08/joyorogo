import "@/unistyles";
import { useMutation, useQueries, useQuery } from "@tanstack/react-query";
import { Dimensions, Pressable, View } from "react-native";
import { useEffect, useState } from "react";
import { Redirect } from "expo-router";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { SLEEP_NEED_HOURS, jakartaToday } from "@joyorogo/api/lib/engine";

import {
  BootLoader,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Num,
  PageHeader,
  Ring,
  Screen,
  Sheet,
  Skeleton,
  Text,
} from "@/components/ui";
import { useSessionGate } from "@/lib/use-session-gate";
import { errorMessage, fmtKg, parseNum } from "@/utils/format";
import { orpc, queryClient } from "@/utils/orpc";

const PRESETS = [5, 6, 7, 8, 9];

// day.summary reads "last night" from the previous WIB day, so the record
// for the night just slept is dated yesterday.
function wibYesterday(date: string): string {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() - 1);
  return day.toISOString().slice(0, 10);
}

function shiftDate(date: string, days: number): string {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, 10);
}

function weekdayShort(date: string): string {
  return new Intl.DateTimeFormat("id-ID", { weekday: "short", timeZone: "UTC" }).format(
    new Date(`${date}T00:00:00Z`),
  );
}

/** Last 7 nights as mini bars; tonight's bar highlighted. */
function SleepBars({ nights }: { nights: Array<{ date: string; hours: number | null }> }) {
  const { theme } = useUnistyles();
  const w = Math.min(320, Dimensions.get("window").width - 100);
  const h = 96;
  const gap = 8;
  const barW = (w - gap * (nights.length - 1)) / nights.length;
  const max = Math.max(SLEEP_NEED_HOURS, ...nights.map((n) => n.hours ?? 0));
  const today = wibYesterday(jakartaToday());
  return (
    <View style={styles.barsRow}>
      {nights.map((night, i) => {
        const ratio = night.hours !== null ? night.hours / max : 0;
        const isLast = night.date === today;
        return (
          <View key={night.date} style={styles.barCol}>
            {night.hours !== null ? <Num style={styles.barValue}>{fmtKg(night.hours)}</Num> : null}
            <View style={styles.barTrack}>
              <View
                style={{
                  width: barW,
                  height: Math.max(ratio * (h - 24), night.hours !== null ? 4 : 0),
                  borderRadius: 6,
                  backgroundColor:
                    night.hours === null
                      ? theme.colors.hairline
                      : isLast
                        ? theme.colors.tidur
                        : theme.colors.tidurSoft,
                }}
              />
            </View>
            <Text style={[styles.barLabel, isLast && styles.barLabelActive]}>
              {i === nights.length - 1 ? "Semalam" : weekdayShort(night.date)}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

export default function Tidur() {
  const { theme } = useUnistyles();
  const gate = useSessionGate();
  const sleepDate = wibYesterday(jakartaToday());
  const sleepQuery = useQuery(orpc.sleep.getForDate.queryOptions({ input: { date: sleepDate } }));

  const weekDates = Array.from({ length: 7 }, (_, i) => shiftDate(sleepDate, i - 6));
  const weekQueries = useQueries({
    queries: weekDates.map((date) => orpc.sleep.getForDate.queryOptions({ input: { date } })),
    combine: (results) => results.map((r) => r.data?.hours ?? null),
  });
  const nights = weekDates.map((date, i) => ({ date, hours: weekQueries[i] }));

  const [sheetOpen, setSheetOpen] = useState(false);
  const [hours, setHours] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const logSleep = useMutation(
    orpc.sleep.log.mutationOptions({
      onSuccess: () => {
        setFormError(null);
        setSheetOpen(false);
        setHours("");
        queryClient.invalidateQueries();
      },
      onError: (e) => setFormError(errorMessage(e)),
    }),
  );

  // Prefill the manual field with the existing record when the sheet opens.
  useEffect(() => {
    if (sheetOpen && hours === "") {
      const existing = sleepQuery.data?.hours;
      if (existing !== null && existing !== undefined) setHours(String(existing));
    }
  }, [sheetOpen, hours, sleepQuery.data]);

  if (gate === "loading") {
    return <BootLoader />;
  }
  if (gate === "anon") {
    return <Redirect href="/login" />;
  }
  if (sleepQuery.isPending) {
    return (
      <Screen>
        <PageHeader title="Tidur" />
        <Skeleton width="100%" height={240} radius={24} />
        <Skeleton width="100%" height={160} radius={24} />
      </Screen>
    );
  }
  if (sleepQuery.isError) {
    return (
      <Screen>
        <PageHeader title="Tidur" />
        <ErrorState message={errorMessage(sleepQuery.error)} onRetry={() => sleepQuery.refetch()} />
      </Screen>
    );
  }

  const logged = sleepQuery.data?.hours ?? null;

  const logPreset = (value: number) => {
    setFormError(null);
    logSleep.mutate({ date: sleepDate, hours: value });
  };

  const submitManual = () => {
    const num = parseNum(hours);
    if (num === null || num < 0 || num > 24) {
      setFormError("Isi jam tidur antara 0 dan 24.");
      return;
    }
    setFormError(null);
    logSleep.mutate({ date: sleepDate, hours: num });
  };

  return (
    <Screen>
      <PageHeader title="Tidur" caption="Jam tidur semalam (WIB)" />

      {/* Last night ring */}
      <Card style={styles.ringCard}>
        <Ring
          size={184}
          stroke={13}
          value={logged ?? 0}
          max={SLEEP_NEED_HOURS}
          color={theme.colors.tidur}
          track={theme.colors.tidurSoft}
        >
          <Text style={styles.ringLabel}>Semalam</Text>
          <Num style={styles.ringValue} adjustsFontSizeToFit numberOfLines={1}>
            {logged !== null ? fmtKg(logged) : "–"}
          </Num>
        </Ring>
        <Text style={styles.ringNote}>
          {logged === null
            ? `Kebutuhan tidurmu ${SLEEP_NEED_HOURS} jam agar pemulihan terjaga.`
            : logged < SLEEP_NEED_HOURS
              ? `Kurang ${fmtKg(SLEEP_NEED_HOURS - logged)} jam dari kebutuhan ${SLEEP_NEED_HOURS} jam.`
              : "Kebutuhan terpenuhi, mantap."}
        </Text>
      </Card>

      {/* Preset hours: one tap logs */}
      <Text style={styles.sectionLabel}>Catat cepat</Text>
      <View style={styles.presetRow}>
        {PRESETS.map((preset) => {
          const active = logged === preset;
          return (
            <Pressable
              key={preset}
              accessibilityRole="button"
              accessibilityLabel={`Catat ${preset} jam`}
              accessibilityState={{ selected: active }}
              disabled={logSleep.isPending}
              onPress={() => logPreset(preset)}
              style={({ pressed }) => [
                styles.presetChip,
                active && styles.presetChipActive,
                pressed && styles.pressedSoft,
              ]}
            >
              <Text style={[styles.presetText, active && styles.presetTextActive]}>
                {preset} jam
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Last 7 nights */}
      <Text style={styles.sectionLabel}>7 malam terakhir</Text>
      <Card>
        {weekQueries.some((q) => q === undefined) ? (
          <View style={styles.barsSkeleton}>
            <Skeleton width="100%" height={96} radius={12} />
          </View>
        ) : (
          <SleepBars nights={nights} />
        )}
        <Text style={styles.note}>
          Satu catatan per malam. Hasil Health Connect ikut dihitung di sini.
        </Text>
      </Card>

      {logged === null ? (
        <EmptyState
          icon="moon-outline"
          title="Belum dicatat"
          description="Pilih jam tidur di atas supaya angka tidur di Beranda terisi."
        />
      ) : (
        <Button variant="secondary" label="Isi jam manual" onPress={() => setSheetOpen(true)} />
      )}

      {/* Manual entry sheet */}
      <Sheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title="Isi jam tidur"
        footer={<Button label="Simpan" onPress={submitManual} loading={logSleep.isPending} />}
      >
        <Field label="Jam tidur semalam" hint="Boleh pakai desimal, contoh 6,5">
          <Input
            value={hours}
            onChangeText={setHours}
            keyboardType="decimal-pad"
            placeholder="7,5"
            autoFocus
          />
        </Field>
        {formError ? <Text style={styles.error}>{formError}</Text> : null}
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create((theme) => ({
  pressedSoft: {
    opacity: 0.7,
  },
  ringCard: {
    alignItems: "center",
    paddingVertical: theme.spacing.xl,
  },
  ringLabel: {
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    color: theme.colors.mutedForeground,
  },
  ringValue: {
    fontSize: theme.fontSize["2xl"],
    fontWeight: "800",
    color: theme.colors.tidurText,
  },
  ringNote: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
    textAlign: "center",
  },
  sectionLabel: {
    fontSize: theme.fontSize.md,
    fontWeight: "700",
    color: theme.colors.foreground,
    marginTop: theme.spacing.sm,
  },
  presetRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing.sm,
  },
  presetChip: {
    flexGrow: 1,
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.tile,
    minHeight: 56,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  presetChipActive: {
    backgroundColor: theme.colors.tidurSoft,
  },
  presetText: {
    fontSize: theme.fontSize.base,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  presetTextActive: {
    color: theme.colors.tidurText,
  },
  barsRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: 8,
    width: "100%",
  },
  barCol: {
    flex: 1,
    alignItems: "center",
    gap: 6,
  },
  barValue: {
    fontSize: theme.fontSize.xs,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  barTrack: {
    height: 72,
    justifyContent: "flex-end",
  },
  barLabel: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.mutedForeground,
  },
  barLabelActive: {
    fontWeight: "700",
    color: theme.colors.tidurText,
  },
  barsSkeleton: {
    width: "100%",
  },
  note: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
    lineHeight: 20,
  },
  error: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.destructive,
  },
}));
