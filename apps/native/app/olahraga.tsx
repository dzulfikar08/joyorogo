import "@/unistyles";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { Platform, Pressable, View } from "react-native";
import { useEffect, useState } from "react";
import { Redirect, Stack } from "expo-router";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";

import { EXERCISE_MAX_DURATION, EXERCISE_MIN_DURATION } from "@joyorogo/api/lib/exercise-edit";
import { estimateKcal, type ExerciseTypeKey } from "@joyorogo/api/lib/met";
import { jakartaToday, relativeDayLabel } from "@joyorogo/api/lib/engine";
import { fmtNumber } from "@joyorogo/i18n";

import {
  BootLoader,
  Button,
  Card,
  Chip,
  ErrorState,
  Field,
  Input,
  ListGroup,
  ListRow,
  Num,
  PageHeader,
  Ring,
  Screen,
  Sheet,
  Skeleton,
  Text,
} from "@/components/ui";
import { ExerciseEditSheet, type ExerciseEditRow } from "@/components/exercise-edit-sheet";
import { Disclosure } from "@/components/disclosure";
import { StravaCard } from "@/components/strava-card";
import { DaySwitcher } from "@/components/day-switcher";
import { ShareToFeedSheet } from "@/components/feed/share-to-feed";
import { useSessionGate } from "@/lib/use-session-gate";
import { openJoyoFit } from "@/lib/workout/joyofit";
import { errorMessage, fmtDateMedium, fmtInt, fmtKcalLabel, fmtKg, parseNum } from "@/utils/format";
import { client, orpc, queryClient } from "@/utils/orpc";
import { OptimisticCache, useDelayedDelete, useOptimisticMutation } from "@/lib/optimistic";
import type { QueryKey } from "@tanstack/react-query";

// Brand names of import sources; "manual" is translated (source.manual).
const SOURCE_LABELS: Record<string, string> = {
  strava: "Strava",
  health_connect: "Health Connect",
  apple_health: "Apple Health",
};

// Captions name the on-device store this install actually reads.
const healthSourceName = Platform.OS === "ios" ? "Apple Health" : "Health Connect";

const TYPE_ICONS: Record<string, React.ComponentProps<typeof Ionicons>["name"]> = {
  jalan: "footsteps",
  jalan_cepat: "walk",
  lari: "speedometer",
  sepeda: "bicycle",
  sepeda_cepat: "bicycle",
  berenang: "water",
  yoga: "body",
  angkat_beban: "barbell",
  futsal: "football",
  badminton: "tennisball",
};

export default function Olahraga() {
  const { t } = useTranslation(["olahraga", "common"]);
  const { theme } = useUnistyles();
  const typeLabel = (key: ExerciseTypeKey) => t(`type.${key}`);
  const sourceName = (source: string) =>
    source === "manual" ? t("source.manual") : (SOURCE_LABELS[source] ?? source);
  const detailText = (item: { durationMin: number | null; kcal: number }) =>
    item.durationMin != null
      ? t("row.detail", { minutes: fmtInt(item.durationMin), kcal: fmtKcalLabel(item.kcal) })
      : fmtKcalLabel(item.kcal);
  const gate = useSessionGate();
  const today = jakartaToday();
  const [date, setDate] = useState(today);
  const isToday = date === today;
  const listQuery = useQuery({
    ...orpc.exercise.listByDate.queryOptions({ input: { date } }),
    placeholderData: (prev) => prev,
  });
  const recentQuery = useQuery(orpc.exercise.recent.queryOptions({ input: { days: 7 } }));
  const typesQuery = useQuery(orpc.exercise.types.queryOptions());
  const historyQuery = useQuery(orpc.weight.history.queryOptions({ input: { limit: 30 } }));
  const summaryQuery = useQuery({
    ...orpc.day.summary.queryOptions({ input: { date } }),
    placeholderData: (prev) => prev,
  });
  const profileQuery = useQuery(orpc.profile.myProfile.queryOptions());

  const [sheetOpen, setSheetOpen] = useState(false);
  const [shareTarget, setShareTarget] = useState<
    null | { kind: "latihan"; refId: string; title: string; preview: string }
  >(null);
  // Ubah aktivitas: baris yang sedang diedit.
  const [editRow, setEditRow] = useState<ExerciseEditRow | null>(null);
  const [sheetType, setSheetType] = useState<ExerciseTypeKey | null>(null);
  const [name, setName] = useState("");
  const [duration, setDuration] = useState("30");
  const [kcal, setKcal] = useState("");
  const [kcalEdited, setKcalEdited] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const latestKg = historyQuery.data?.summary.latestKg ?? null;
  const weightKg = profileQuery.data?.latestWeightKg ?? latestKg;
  const targetBurn = summaryQuery.data?.targets?.burnKcal ?? null;

  type ExerciseRow = NonNullable<
    NonNullable<typeof listQuery.data>["items"]
  >[number];
  const exerciseListKey = orpc.exercise.listByDate.queryOptions({ input: { date } }).queryKey;

  /** exercise.listByDate caches hold { items, totalKcal }: land a row and lift the total. */
  const insertExerciseRow = (cache: OptimisticCache, listKey: QueryKey, row: ExerciseRow) => {
    cache.value<{ items: ExerciseRow[]; totalKcal: number }>(listKey, (old) =>
      old ? { ...old, items: [...old.items, row], totalKcal: old.totalKcal + row.kcal } : old,
    );
  };

  /** exercise.listByDate caches hold { items, totalKcal }: strip one row and pull the total down. */
  const stripExerciseRow = (cache: OptimisticCache, listKey: QueryKey, row: ExerciseRow) => {
    cache.value<{ items: ExerciseRow[]; totalKcal: number }>(listKey, (old) => {
      if (!old || !old.items.some((item) => item.id === row.id)) return old;
      return {
        ...old,
        items: old.items.filter((item) => item.id !== row.id),
        totalKcal: Math.max(0, old.totalKcal - row.kcal),
      };
    });
  };

  const addExercise = useOptimisticMutation<
    Parameters<typeof client.exercise.add>[0],
    ExerciseRow
  >({
    mutationFn: async (input) => {
      const row = await client.exercise.add(input);
      if (!row) throw new Error(t("toast.saveFailed"));
      return row;
    },
    patch: (input, cache) => {
      const rowDate = input.date ?? today;
      insertExerciseRow(cache, exerciseListKey, {
        id: "",
        userId: "",
        date: rowDate,
        type: input.type ?? null,
        name: input.name,
        durationMin: input.durationMin ?? null,
        kcal: input.kcal,
        source: input.source ?? "manual",
        externalId: input.externalId ?? null,
        createdAt: new Date(),
      });
      cache.summary({ date: rowDate, burnKcal: input.kcal });
    },
    success: (input, data) => {
      setFormError(null);
      setName("");
      setDuration("30");
      setKcal("");
      setKcalEdited(false);
      setSheetOpen(false);
      setSheetType(null);
      return {
        message: t("toast.logged", { name: input.name, kcal: fmtKcalLabel(input.kcal) }),
        undo: () => {
          void client.exercise.remove({ id: data.id }).then(() => {
            void queryClient.invalidateQueries({ queryKey: orpc.exercise.key() });
            void queryClient.invalidateQueries({ queryKey: orpc.day.key() });
          });
        },
      };
    },
    onError: (e) => setFormError(errorMessage(e)),
    invalidate: () => [orpc.exercise.key(), orpc.day.key()],
  });
  const removeExercise = useDelayedDelete<ExerciseRow>({
    remove: (row) => client.exercise.remove({ id: row.id }),
    patch: (row, cache) => {
      const listKey = orpc.exercise.listByDate.queryOptions({
        input: { date: row.date },
      }).queryKey;
      stripExerciseRow(cache, listKey, row);
      cache.summary({ date: row.date, burnKcal: -row.kcal });
    },
    label: (row) => row.name,
    fallback: t("toast.fallbackName"),
    invalidate: () => [orpc.exercise.key(), orpc.day.key()],
  });

  // MET prefill: pick a type (or change duration/weight) → kcal estimate.
  // Skipped once the user types their own kcal.
  useEffect(() => {
    if (kcalEdited) return;
    const met = typesQuery.data?.find((type) => type.key === sheetType)?.met;
    const minutes = parseNum(duration);
    if (met && minutes && minutes > 0 && weightKg !== null) {
      setKcal(String(estimateKcal(met, weightKg, minutes)));
    }
  }, [sheetType, duration, weightKg, kcalEdited, typesQuery.data]);

  if (gate === "loading") {
    return <BootLoader />;
  }
  if (gate === "anon") {
    return <Redirect href="/login" />;
  }
  if (listQuery.isPending) {
    return (
      <Screen>
        <PageHeader title={t("screen.title")} />
        <Skeleton width="100%" height={200} radius={24} />
        <Skeleton width="100%" height={180} radius={24} />
        <Skeleton width="100%" height={120} radius={24} />
      </Screen>
    );
  }
  if (listQuery.isError) {
    return (
      <Screen>
        <PageHeader title={t("screen.title")} />
        <ErrorState message={errorMessage(listQuery.error)} onRetry={() => listQuery.refetch()} />
      </Screen>
    );
  }

  const items = listQuery.data.items;
  const totalKcal = listQuery.data.totalKcal;

  const openSheet = (typeKey: ExerciseTypeKey | null) => {
    setSheetType(typeKey);
    setSheetOpen(true);
    setName(typeKey ? typeLabel(typeKey) : "");
    setDuration("30");
    setKcal("");
    setKcalEdited(false);
    setFormError(null);
  };

  /** Switching activity inside the sheet mirrors web: label becomes the name. */
  const pickType = (typeKey: ExerciseTypeKey) => {
    setSheetType(typeKey);
    setName(typeLabel(typeKey));
  };

  const submit = () => {
    const kcalNum = parseNum(kcal);
    const minutes = parseNum(duration);
    if (sheetType === null && name.trim() === "") {
      setFormError(t("form.error.nameRequired"));
      return;
    }
    if (kcalNum === null || kcalNum < 0) {
      setFormError(t("form.error.kcalRequired"));
      return;
    }
    if (minutes !== null && (minutes < 1 || minutes > 1440)) {
      setFormError(
        t("form.error.durationRange", { min: EXERCISE_MIN_DURATION, max: EXERCISE_MAX_DURATION }),
      );
      return;
    }
    const label = sheetType ? typeLabel(sheetType) : t("form.defaultName");
    setFormError(null);
    addExercise.mutate({
      date,
      type: sheetType ?? undefined,
      name: name.trim() === "" ? label : name.trim(),
      durationMin: minutes === null ? undefined : minutes,
      kcal: kcalNum,
    });
  };

  return (
    <>
      <Stack.Screen options={{ title: t("screen.title") }} />
      <Screen>
      <PageHeader
        title={t("screen.title")}
        right={
          <Button
            variant="secondary"
            size="sm"
            label={t("screen.manual")}
            onPress={() => openSheet(null)}
          />
        }
      />

      <DaySwitcher date={date} onChange={setDate} />

      {/* Burn ring + target + device activity */}
      <Card style={styles.burnCard}>
        <Ring
          size={112}
          stroke={11}
          value={totalKcal}
          max={targetBurn ?? Math.max(totalKcal, 300)}
          color={theme.colors.bakar}
          track={theme.colors.bakarSoft}
        >
          <Num style={styles.burnValue} adjustsFontSizeToFit numberOfLines={1}>
            {fmtInt(totalKcal)}
          </Num>
          <Text style={styles.burnUnit}>kcal</Text>
        </Ring>
        <View style={styles.burnInfo}>
          <Text style={styles.burnLabel}>{t("summary.burned")}</Text>
          <Text style={styles.burnNote}>
            {targetBurn === null
              ? t("summary.noTarget")
              : totalKcal > targetBurn
                ? t("summary.over", { target: fmtKcalLabel(targetBurn) })
                : t("summary.progress", {
                    count: items.length,
                    target: fmtKcalLabel(targetBurn),
                  })}
          </Text>
          {summaryQuery.data?.dailyActivity ? (
            <View style={styles.activityRow}>
              <View style={styles.activityCell}>
                <Num style={styles.activityValue}>
                  {fmtInt(summaryQuery.data.dailyActivity.steps)}
                </Num>
                <Text style={styles.activityLabel}>{t("summary.steps")}</Text>
              </View>
              <View style={styles.activityCell}>
                <Num style={styles.activityValue}>
                  {fmtNumber(summaryQuery.data.dailyActivity.distanceMeters / 1000, 1)}
                </Num>
                <Text style={styles.activityLabel}>{t("summary.km")}</Text>
              </View>
              <View style={styles.activityCell}>
                <Num style={styles.activityValue}>
                  {fmtInt(summaryQuery.data.dailyActivity.activeCalories)}
                </Num>
                <Text style={styles.activityLabel}>{t("summary.activeKcal")}</Text>
              </View>
            </View>
          ) : null}
        </View>
      </Card>

      {/* Activity list */}
      <View style={styles.sectionHead}>
        <Text style={styles.sectionLabel}>{relativeDayLabel(date, today)}</Text>
        <Num style={styles.sectionTotal}>{fmtKcalLabel(totalKcal)}</Num>
      </View>
      {items.length === 0 ? (
        <Card style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>
            {isToday
              ? t("list.empty.today")
              : t("list.empty.day", { date: fmtDateMedium(date) })}
          </Text>
          <Text style={styles.emptyText}>
            {t("list.empty.hintNative", { health: healthSourceName })}
          </Text>
        </Card>
      ) : (
        <ListGroup>
          {items.map((item) => (
            <ListRow
              key={item.id}
              onPress={() => setEditRow(item)}
              icon="flame"
              iconTint="bakar"
              title={item.name}
              subtitle={t("row.detailSource", {
                detail: detailText(item),
                source: sourceName(item.source),
              })}
              value={fmtInt(item.kcal)}
              right={
                <View style={styles.rowActions}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t("row.share", { name: item.name })}
                    onPress={() =>
                      setShareTarget({
                        kind: "latihan",
                        refId: item.id,
                        title: item.name,
                        preview: detailText(item),
                      })
                    }
                    style={({ pressed }) => [styles.deleteButton, pressed && styles.pressedSoft]}
                  >
                    <Ionicons name="share-social-outline" size={18} color={theme.colors.foreground} />
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t("row.remove", { name: item.name })}
                    onPress={() => removeExercise(item)}
                    style={({ pressed }) => [styles.deleteButton, pressed && styles.pressedSoft]}
                  >
                    <Ionicons name="trash-outline" size={18} color={theme.colors.destructive} />
                  </Pressable>
                </View>
              }
            />
          ))}
        </ListGroup>
      )}

      {/* Activity type tiles → add sheet */}
      <Text style={styles.sectionLabel}>{t("picker.title")}</Text>
      {typesQuery.isPending ? (
        <View style={styles.typeGrid}>
          <Skeleton width="100%" height={72} radius={18} />
          <Skeleton width="100%" height={72} radius={18} />
          <Skeleton width="100%" height={72} radius={18} />
        </View>
      ) : typesQuery.isError ? (
        <ErrorState message={errorMessage(typesQuery.error)} onRetry={() => typesQuery.refetch()} />
      ) : (
        <View style={styles.typeGrid}>
          {typesQuery.data.map((type) => {
            const per30 = weightKg !== null ? estimateKcal(type.met, weightKg, 30) : null;
            return (
              <Pressable
                key={type.key}
                accessibilityRole="button"
                accessibilityLabel={
                  per30 !== null
                    ? t("picker.tileEstimate", {
                        type: typeLabel(type.key),
                        kcal: fmtKcalLabel(per30),
                      })
                    : t("picker.tile", { type: typeLabel(type.key) })
                }
                onPress={() => openSheet(type.key)}
                style={({ pressed }) => [styles.typeTile, pressed && styles.pressedSoft]}
              >
                <Ionicons
                  name={TYPE_ICONS[type.key] ?? "fitness"}
                  size={20}
                  color={theme.colors.bakar}
                />
                <Text style={styles.typeLabel} numberOfLines={2}>
                  {typeLabel(type.key)}
                </Text>
                <Text style={styles.typeEstimate} numberOfLines={1}>
                  {per30 !== null
                    ? t("picker.estimate", { kcal: fmtKcalLabel(per30) })
                    : t("picker.manualKcal")}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}
      {weightKg === null ? <Text style={styles.gridCaption}>{t("picker.noWeight")}</Text> : null}

      {/* Strength training moved to JoyoFit */}
      <ListGroup>
        <ListRow
          icon="barbell"
          iconTint="bakar"
          title={t("moved.title")}
          subtitle={t("moved.body")}
          chevron
          onPress={() => void openJoyoFit()}
        />
      </ListGroup>

      {/* Recent history: Health Connect / Apple Health imports land on the
          workout's own WIB day, so show the past week or they look lost. */}
      {(() => {
        const pastItems = (recentQuery.data?.items ?? []).filter((item) => item.date !== today);
        const byDate = new Map<string, typeof pastItems>();
        for (const item of pastItems) {
          const group = byDate.get(item.date);
          if (group) group.push(item);
          else byDate.set(item.date, [item]);
        }
        if (byDate.size === 0) return null;
        return (
          <>
            <Text style={styles.sectionLabel}>{t("history.title")}</Text>
            {recentQuery.isError ? (
              <ErrorState
                message={errorMessage(recentQuery.error)}
                onRetry={() => recentQuery.refetch()}
              />
            ) : (
              <ListGroup>
                {[...byDate.entries()].map(([day, dayItems]) => (
                  <View key={day}>
                    <Text style={styles.historyDate}>{relativeDayLabel(day, today)}</Text>
                    {dayItems.map((item) => (
                      <ListRow
                        key={item.id}
                        onPress={() => setEditRow(item)}
                        icon="flame"
                        iconTint="bakar"
                        title={item.name}
                        subtitle={t("row.detailSource", {
                          detail: detailText(item),
                          source: sourceName(item.source),
                        })}
                        value={fmtInt(item.kcal)}
                      />
                    ))}
                  </View>
                ))}
              </ListGroup>
            )}
          </>
        );
      })()}

      <StravaCard compact />
      <Disclosure title={t("about.title")}>
        <Text style={styles.aboutText}>{t("about.sources", { health: healthSourceName })}</Text>
        {weightKg !== null ? <Text style={styles.aboutText}>{t("about.estimate")}</Text> : null}
        <Text style={styles.aboutText}>{t("about.strength")}</Text>
      </Disclosure>

      {/* Add form */}
      <Sheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title={sheetType === null ? t("form.title") : t("form.titleType", { type: typeLabel(sheetType) })}
        footer={
          <Button label={t("common:actions.add")} onPress={submit} loading={addExercise.isPending} />
        }
      >
        <Field label={t("form.type")}>
          <View style={styles.chipRow}>
            {typesQuery.data?.map((type) => (
              <Chip
                key={type.key}
                label={typeLabel(type.key)}
                selected={sheetType === type.key}
                onPress={() => pickType(type.key)}
              />
            ))}
          </View>
        </Field>
        <Field label={sheetType === null ? t("form.name") : t("form.nameOptional")}>
          <Input value={name} onChangeText={setName} placeholder={t("form.namePlaceholder")} />
        </Field>
        <Field label={t("form.duration")}>
          <Input
            value={duration}
            onChangeText={setDuration}
            keyboardType="number-pad"
            placeholder="30"
          />
        </Field>
        <Field
          label={t("form.kcal")}
          hint={latestKg ? t("form.kcalHint", { kg: fmtKg(latestKg) }) : undefined}
        >
          <Input
            value={kcal}
            onChangeText={(text) => {
              setKcal(text);
              setKcalEdited(true);
            }}
            keyboardType="number-pad"
            placeholder="150"
          />
        </Field>
        {formError ? <Text style={styles.error}>{formError}</Text> : null}
      </Sheet>
      {editRow ? (
        <ExerciseEditSheet key={editRow.id} row={editRow} onClose={() => setEditRow(null)} />
      ) : null}
      <ShareToFeedSheet
        visible={shareTarget !== null}
        onClose={() => setShareTarget(null)}
        title={shareTarget?.title ?? ""}
        preview={shareTarget?.preview ?? ""}
        kind={shareTarget?.kind ?? "latihan"}
        refId={shareTarget?.refId ?? ""}
      />
    </Screen>
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  rowActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
  },
  pressedSoft: {
    opacity: 0.7,
  },
  burnCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.lg,
    paddingVertical: theme.spacing.lg,
  },
  burnValue: {
    fontSize: theme.fontSize.xl,
    fontWeight: "800",
    color: theme.colors.bakarText,
    maxWidth: 80,
  },
  burnUnit: {
    fontSize: theme.fontSize.xs,
    fontWeight: "600",
    color: theme.colors.mutedForeground,
  },
  burnInfo: {
    flex: 1,
    gap: theme.spacing.xs,
  },
  burnLabel: {
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    color: theme.colors.mutedForeground,
  },
  burnNote: {
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  activityRow: {
    flexDirection: "row",
    gap: theme.spacing.lg,
    marginTop: theme.spacing.xs,
  },
  activityCell: {
    gap: 1,
  },
  activityValue: {
    fontSize: theme.fontSize.base,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  activityLabel: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.mutedForeground,
  },
  sectionHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: theme.spacing.xs,
  },
  sectionLabel: {
    fontSize: theme.fontSize.md,
    fontWeight: "700",
    color: theme.colors.foreground,
    marginTop: theme.spacing.xs,
  },
  sectionTotal: {
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
    color: theme.colors.mutedForeground,
  },
  emptyCard: {
    gap: 2,
    paddingVertical: theme.spacing.md,
  },
  emptyTitle: {
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  emptyText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
  },
  historyDate: {
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
    color: theme.colors.mutedForeground,
    paddingHorizontal: theme.spacing.xs,
    marginTop: theme.spacing.xs,
    marginBottom: theme.spacing.xs,
  },
  typeGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing.sm,
  },
  typeTile: {
    flexGrow: 1,
    flexBasis: "30%",
    backgroundColor: theme.colors.bakarSoft,
    borderRadius: theme.radius.tile,
    padding: 12,
    gap: 4,
    minHeight: 72,
  },
  typeLabel: {
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    color: theme.colors.bakarText,
    lineHeight: 17,
  },
  typeEstimate: {
    fontSize: theme.fontSize.xs,
    fontWeight: "600",
    color: theme.colors.bakarText,
  },
  gridCaption: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.mutedForeground,
    paddingHorizontal: 2,
  },
  aboutText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
    lineHeight: 19,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing.sm,
  },
  deleteButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    marginRight: -12,
  },
  error: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.destructive,
  },
}));
