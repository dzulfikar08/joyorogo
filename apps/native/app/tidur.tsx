import "@/unistyles";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Dimensions, Platform, Pressable, View } from "react-native";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Redirect } from "expo-router";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { DEFAULT_SLEEP_TARGET_HOURS, MIN_RECOMMENDED_SLEEP_HOURS, jakartaToday } from "@joyorogo/api/lib/engine";
import { getActiveLocale } from "@joyorogo/i18n";

import { DaySwitcher } from "@/components/day-switcher";
import { ConfirmSheet } from "@/components/confirm-sheet";
import { Disclosure } from "@/components/disclosure";
import { SleepInsightsSection } from "@/components/sleep-insights/section";
import {
  BootLoader,
  Button,
  Card,
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
import { errorMessage, fmtDateShort, fmtKg, parseNum } from "@/utils/format";
import { client, orpc } from "@/utils/orpc";
import { useOptimisticMutation } from "@/lib/optimistic";

const PRESETS = [5, 6, 7, 8, 9];

function shiftDate(date: string, days: number): string {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, 10);
}

/** Last 7 nights as mini bars; the viewed night's bar highlighted. */
function SleepBars({
  nights,
  lastLabel,
  need,
}: {
  nights: Array<{ date: string; hours: number | null }>;
  lastLabel: string;
  need: number;
}) {
  const { theme } = useUnistyles();
  const w = Math.min(320, Dimensions.get("window").width - 100);
  const h = 96;
  const gap = 8;
  const barW = (w - gap * (nights.length - 1)) / nights.length;
  const max = Math.max(need, ...nights.map((n) => n.hours ?? 0));
  const weekday = new Intl.DateTimeFormat(getActiveLocale(), {
    weekday: "short",
    timeZone: "UTC",
  });
  return (
    <View style={styles.barsRow}>
      {nights.map((night, i) => {
        const ratio = night.hours !== null ? night.hours / max : 0;
        const isLast = i === nights.length - 1;
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
            <Text
              numberOfLines={1}
              style={[styles.barLabel, isLast && styles.barLabelActive]}
            >
              {isLast ? lastLabel : weekday.format(new Date(`${night.date}T00:00:00Z`))}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

export default function Tidur() {
  const { t } = useTranslation(["tidur", "common"]);
  const { theme } = useUnistyles();
  const gate = useSessionGate();
  const today = jakartaToday();
  // The switcher picks a day; that day's sleep is the night keyed the
  // previous day (day zone) (day.summary reads it the same way).
  const [viewDate, setViewDate] = useState(today);
  const isToday = viewDate === today;
  const sleepDate = shiftDate(viewDate, -1);
  // The goal is a profile setting; until the plan loads (or without one) the default shows.
  const planQuery = useQuery(orpc.profile.myProfile.queryOptions());
  const need = planQuery.data?.targets?.sleepHours ?? DEFAULT_SLEEP_TARGET_HOURS;
  const sleepQuery = useQuery({
    ...orpc.sleep.getForDate.queryOptions({ input: { date: sleepDate } }),
    placeholderData: (prev) => prev,
  });

  const weekDates = Array.from({ length: 7 }, (_, i) => shiftDate(sleepDate, i - 6));
  const weekQueries = useQueries({
    queries: weekDates.map((date) => orpc.sleep.getForDate.queryOptions({ input: { date } })),
    combine: (results) => results.map((r) => r.data?.hours ?? null),
  });
  const nights = weekDates.map((date, i) => ({ date, hours: weekQueries[i] }));

  const [sheetOpen, setSheetOpen] = useState(false);
  const [hours, setHours] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  type SleepLogInput = { date?: string; hours: number };

  const logSleep = useOptimisticMutation<SleepLogInput, unknown>({
    mutationFn: (input) => client.sleep.log(input),
    patch: (input, cache) => {
      const rowDate = input.date ?? shiftDate(jakartaToday(), -1);
      // applySummaryDelta puts sleepHours on the summary of date + 1 itself.
      cache.summary({ date: rowDate, sleepHours: input.hours });
      cache.value<{ hours: number | null }>(
        orpc.sleep.getForDate.queryOptions({ input: { date: rowDate } }).queryKey,
        () => ({ hours: input.hours }),
      );
    },
    success: (input) => {
      setFormError(null);
      setSheetOpen(false);
      setHours("");
      const previous = sleepQuery.data?.hours;
      return {
        message: t("toast.logged"),
        undo:
          previous === null || previous === undefined
            ? undefined
            : () => logSleep.mutate({ date: input.date, hours: previous }),
      };
    },
    onError: (e) => setFormError(errorMessage(e)),
    invalidate: () => [orpc.sleep.key(), orpc.day.key()],
  });

  const queryClient = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const clearManual = useMutation({
    mutationFn: () => client.sleep.clearManual({ date: sleepDate }),
    onSuccess: () => {
      setConfirmOpen(false);
      setSheetOpen(false);
      setHours("");
    },
    onError: (e) => setFormError(errorMessage(e)),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: orpc.sleep.key() }),
        queryClient.invalidateQueries({ queryKey: orpc.day.key() }),
      ]),
  });

  // Prefill the manual field with the existing record when the sheet opens.
  useEffect(() => {
    // Skip while a day-switch fetch is in flight so the field never prefills
    // from the previously viewed night's placeholder data.
    if (sheetOpen && hours === "" && !sleepQuery.isFetching) {
      const existing = sleepQuery.data?.hours;
      if (existing !== null && existing !== undefined) setHours(String(existing));
    }
  }, [sheetOpen, hours, sleepQuery.data, sleepQuery.isFetching]);

  if (gate === "loading") {
    return <BootLoader />;
  }
  if (gate === "anon") {
    return <Redirect href="/login" />;
  }
  if (sleepQuery.isPending) {
    return (
      <Screen>
        <PageHeader title={t("title")} />
        <Skeleton width="100%" height={140} radius={24} />
        <Skeleton width="100%" height={160} radius={24} />
      </Screen>
    );
  }
  if (sleepQuery.isError) {
    return (
      <Screen>
        <PageHeader title={t("title")} />
        <ErrorState message={errorMessage(sleepQuery.error)} onRetry={() => sleepQuery.refetch()} />
      </Screen>
    );
  }

  const logged = sleepQuery.data?.hours ?? null;
  const isManual = sleepQuery.data?.source === "manual";
  const watchHours = sleepQuery.data?.alternative?.hours ?? null;
  const nightLabel = isToday ? t("ring.lastNight") : fmtDateShort(sleepDate);

  const logPreset = (value: number) => {
    setFormError(null);
    logSleep.mutate({ date: sleepDate, hours: value });
  };

  const submitManual = () => {
    const num = parseNum(hours);
    if (num === null || num < 0 || num > 24) {
      setFormError(t("error.range"));
      return;
    }
    setFormError(null);
    logSleep.mutate({ date: sleepDate, hours: num });
  };

  return (
    <Screen>
        <PageHeader title={t("title")} />

        {/* Day switcher */}
        <DaySwitcher date={viewDate} onChange={setViewDate} />

        {/* Last night: ring beside the status line */}
        <Card style={styles.ringCard}>
          <Ring
            size={116}
            stroke={10}
            value={logged ?? 0}
            max={need}
            color={theme.colors.tidur}
            track={theme.colors.tidurSoft}
          >
            <Num style={styles.ringValue} adjustsFontSizeToFit numberOfLines={1}>
              {logged !== null ? fmtKg(logged) : "–"}
            </Num>
            <Text style={styles.ringUnit}>{t("unit.hours")}</Text>
          </Ring>
          <View style={styles.ringText}>
            <Text style={styles.ringLabel}>{nightLabel}</Text>
            <Text style={styles.ringNote}>
              {logged === null
                ? t("status.empty", { need })
                : logged >= need
                  ? t("status.met")
                  : logged < MIN_RECOMMENDED_SLEEP_HOURS
                    ? t("status.belowMin", { hours: fmtKg(logged) })
                    : t("status.short", {
                        count: need - logged,
                        hours: fmtKg(need - logged),
                        need,
                      })}
            </Text>
            {isManual && watchHours !== null ? (
              <>
                <Text style={styles.ringNote}>
                  {t("manualEntry.note", { hours: fmtKg(watchHours) })}
                </Text>
                <Button
                  variant="secondary"
                  label={t("manualEntry.useWatch")}
                  onPress={() => setConfirmOpen(true)}
                />
              </>
            ) : null}
          </View>
        </Card>

        {/* Preset hours: one tap logs */}
        <Text style={styles.sectionLabel}>{t("log.quick")}</Text>
        <View style={styles.presetRow}>
          {PRESETS.map((preset) => {
            const active = logged === preset;
            return (
              <Pressable
                key={preset}
                accessibilityRole="button"
                accessibilityLabel={t("log.preset", { count: preset })}
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
                  {preset}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* Last 7 nights */}
        <Text style={styles.sectionLabel}>{t("week.title")}</Text>
        <Card>
          {weekQueries.some((q) => q === undefined) ? (
            <View style={styles.barsSkeleton}>
              <Skeleton width="100%" height={96} radius={12} />
            </View>
          ) : (
            <SleepBars nights={nights} lastLabel={nightLabel} need={need} />
          )}
        </Card>

        <Button variant="secondary" label={t("log.manualButton")} onPress={() => setSheetOpen(true)} />

        <SleepInsightsSection />

        <Disclosure title={t("how.title")}>
          <Text style={styles.note}>
            {t("how.onePerNight", {
              source: Platform.OS === "ios" ? "Apple Health" : "Health Connect",
            })}
          </Text>
          <Text style={styles.note}>{t("how.home")}</Text>
          <Text style={styles.note}>{t("how.wib")}</Text>
        </Disclosure>

        {/* Manual entry sheet */}
        <Sheet
          visible={sheetOpen}
          onClose={() => setSheetOpen(false)}
          title={t("sheet.title")}
          footer={
            <Button
              label={t("common:actions.save")}
              onPress={submitManual}
              loading={logSleep.isPending}
            />
          }
        >
          <Field label={t("sheet.field")} hint={t("sheet.hint", { example: fmtKg(6.5) })}>
            <Input
              value={hours}
              onChangeText={setHours}
              keyboardType="decimal-pad"
              placeholder={fmtKg(7.5)}
              autoFocus
            />
          </Field>
          {watchHours !== null ? (
            <Text style={styles.note}>{t("manualEntry.watchHint", { hours: fmtKg(watchHours) })}</Text>
          ) : null}
          {formError ? <Text style={styles.error}>{formError}</Text> : null}
          {isManual && watchHours === null ? (
            <Button
              variant="secondary"
              label={t("manualEntry.delete")}
              onPress={() => setConfirmOpen(true)}
            />
          ) : null}
        </Sheet>

        <ConfirmSheet
          visible={confirmOpen}
          onClose={() => setConfirmOpen(false)}
          title={t("manualEntry.title")}
          message={
            watchHours !== null
              ? t("manualEntry.bodyWatch", { hours: fmtKg(watchHours) })
              : t("manualEntry.bodyNone")
          }
          confirmLabel={
            watchHours !== null ? t("manualEntry.confirmWatch") : t("manualEntry.delete")
          }
          cancelLabel={t("common:actions.cancel")}
          loading={clearManual.isPending}
          onConfirm={() => clearManual.mutate()}
        />
    </Screen>
  );
}

const styles = StyleSheet.create((theme) => ({
  pressedSoft: {
    opacity: 0.7,
  },
  ringCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.lg,
    paddingVertical: theme.spacing.lg,
  },
  ringText: {
    flex: 1,
    gap: 4,
  },
  ringLabel: {
    fontSize: theme.fontSize.md,
    fontWeight: "700",
    color: theme.colors.tidurText,
  },
  ringUnit: {
    fontSize: theme.fontSize.xs,
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
  },
  sectionLabel: {
    fontSize: theme.fontSize.md,
    fontWeight: "700",
    color: theme.colors.foreground,
    marginTop: theme.spacing.sm,
  },
  presetRow: {
    flexDirection: "row",
    gap: theme.spacing.sm,
  },
  presetChip: {
    flex: 1,
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.tile,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
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
