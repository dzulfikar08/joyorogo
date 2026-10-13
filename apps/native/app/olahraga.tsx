import "@/unistyles";
import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Platform, Pressable, View } from "react-native";
import { useEffect, useState } from "react";
import { Redirect, Stack, router } from "expo-router";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { estimateKcal } from "@joyorogo/api/lib/met";

import {
  BootLoader,
  Button,
  Card,
  Chip,
  EmptyState,
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
import { StravaCard } from "@/components/strava-card";
import { ShareToFeedSheet } from "@/components/feed/share-to-feed";
import { useSessionGate } from "@/lib/use-session-gate";
import { errorMessage, fmtKcal, fmtKg, parseNum } from "@/utils/format";
import { orpc, queryClient } from "@/utils/orpc";

const SOURCE_LABELS: Record<string, string> = {
  manual: "Manual",
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
  const { theme } = useUnistyles();
  const gate = useSessionGate();
  const listQuery = useQuery(orpc.exercise.listByDate.queryOptions({ input: {} }));
  const typesQuery = useQuery(orpc.exercise.types.queryOptions());
  const historyQuery = useQuery(orpc.weight.history.queryOptions({ input: { limit: 30 } }));
  const summaryQuery = useQuery(orpc.day.summary.queryOptions({ input: {} }));
  const profileQuery = useQuery(orpc.profile.myProfile.queryOptions());

  const [sheetOpen, setSheetOpen] = useState(false);
  const [shareTarget, setShareTarget] = useState<
    null | { kind: "latihan"; refId: string; title: string; preview: string }
  >(null);
  const [sheetType, setSheetType] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [duration, setDuration] = useState("30");
  const [kcal, setKcal] = useState("");
  const [kcalEdited, setKcalEdited] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const latestKg = historyQuery.data?.summary.latestKg ?? null;
  const weightKg = profileQuery.data?.latestWeightKg ?? latestKg;
  const targetBurn = summaryQuery.data?.targets?.burnKcal ?? null;

  const addExercise = useMutation(
    orpc.exercise.add.mutationOptions({
      onSuccess: () => {
        setFormError(null);
        setName("");
        setDuration("30");
        setKcal("");
        setKcalEdited(false);
        setSheetOpen(false);
        setSheetType(null);
        queryClient.invalidateQueries();
      },
      onError: (e) => setFormError(errorMessage(e)),
    }),
  );
  const removeExercise = useMutation(
    orpc.exercise.remove.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries(),
    }),
  );

  // MET prefill: pick a type (or change duration/weight) → kcal estimate.
  // Skipped once the user types their own kcal.
  useEffect(() => {
    if (kcalEdited) return;
    const met = typesQuery.data?.find((t) => t.key === sheetType)?.met;
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
        <PageHeader title="Olahraga" />
        <Skeleton width="100%" height={200} radius={24} />
        <Skeleton width="100%" height={180} radius={24} />
        <Skeleton width="100%" height={120} radius={24} />
      </Screen>
    );
  }
  if (listQuery.isError) {
    return (
      <Screen>
        <PageHeader title="Olahraga" />
        <ErrorState message={errorMessage(listQuery.error)} onRetry={() => listQuery.refetch()} />
      </Screen>
    );
  }

  const items = listQuery.data.items;
  const totalKcal = listQuery.data.totalKcal;

  const openSheet = (typeKey: string | null) => {
    setSheetType(typeKey);
    setSheetOpen(true);
    setName(typeKey ? (typesQuery.data?.find((t) => t.key === typeKey)?.label ?? "") : "");
    setDuration("30");
    setKcal("");
    setKcalEdited(false);
    setFormError(null);
  };

  /** Switching activity inside the sheet mirrors web: label becomes the name. */
  const pickType = (typeKey: string) => {
    setSheetType(typeKey);
    const label = typesQuery.data?.find((t) => t.key === typeKey)?.label;
    if (label) setName(label);
  };

  const submit = () => {
    const kcalNum = parseNum(kcal);
    const minutes = parseNum(duration);
    if (sheetType === null && name.trim() === "") {
      setFormError("Tulis nama aktivitasnya, contoh: Renang sore.");
      return;
    }
    if (kcalNum === null || kcalNum < 0) {
      setFormError("Isi jumlah kalori yang dibakar, contoh: 200.");
      return;
    }
    if (minutes !== null && (minutes < 1 || minutes > 1440)) {
      setFormError("Durasi harus antara 1 dan 1440 menit.");
      return;
    }
    const label = typesQuery.data?.find((t) => t.key === sheetType)?.label ?? "Olahraga";
    setFormError(null);
    addExercise.mutate({
      type: sheetType ?? undefined,
      name: name.trim() === "" ? label : name.trim(),
      durationMin: minutes === null ? undefined : minutes,
      kcal: kcalNum,
    });
  };

  return (
    <>
      <Stack.Screen options={{ title: "Olahraga" }} />
      <Screen>
      <PageHeader
        title="Olahraga"
        caption={`Semua sumber dihitung: manual, Strava, ${healthSourceName}`}
        right={
          <Button
            variant="secondary"
            size="sm"
            label="Tulis manual"
            onPress={() => openSheet(null)}
          />
        }
      />

      {/* Burn ring */}
      <Card style={styles.burnCard}>
        <Ring
          size={168}
          stroke={13}
          value={totalKcal}
          max={targetBurn ?? Math.max(totalKcal, 300)}
          color={theme.colors.bakar}
          track={theme.colors.bakarSoft}
        >
          <Text style={styles.burnLabel}>Terbakar</Text>
          <Num style={styles.burnValue} adjustsFontSizeToFit numberOfLines={1}>
            {fmtKcal(totalKcal)}
          </Num>
        </Ring>
        <Text style={styles.burnNote}>
          {targetBurn === null
            ? "Target burn muncul setelah profil lengkap."
            : totalKcal > targetBurn
              ? `Melebihi target ${fmtKcal(targetBurn)} kcal, mantap.`
              : `${items.length} aktivitas · target ${fmtKcal(targetBurn)} kcal`}
        </Text>
        {summaryQuery.data?.dailyActivity ? (
          <View style={styles.activityRow}>
            <View style={styles.activityCell}>
              <Num style={styles.activityValue}>
                {fmtKcal(summaryQuery.data.dailyActivity.steps)}
              </Num>
              <Text style={styles.activityLabel}>langkah</Text>
            </View>
            <View style={styles.activityCell}>
              <Num style={styles.activityValue}>
                {(summaryQuery.data.dailyActivity.distanceMeters / 1000).toFixed(1)}
              </Num>
              <Text style={styles.activityLabel}>km</Text>
            </View>
            <View style={styles.activityCell}>
              <Num style={styles.activityValue}>
                {fmtKcal(summaryQuery.data.dailyActivity.activeCalories)}
              </Num>
              <Text style={styles.activityLabel}>kcal aktif</Text>
            </View>
          </View>
        ) : null}
      </Card>

      {/* Activity type tiles → add sheet */}
      <Text style={styles.sectionLabel}>Tambah aktivitas</Text>
      {typesQuery.isPending ? (
        <View style={styles.typeGrid}>
          <Skeleton width="100%" height={84} radius={18} />
          <Skeleton width="100%" height={84} radius={18} />
          <Skeleton width="100%" height={84} radius={18} />
          <Skeleton width="100%" height={84} radius={18} />
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
                accessibilityLabel={`Tambah ${type.label}${per30 !== null ? `, sekitar ${fmtKcal(per30)} kcal untuk 30 menit` : ""}`}
                onPress={() => openSheet(type.key)}
                style={({ pressed }) => [styles.typeTile, pressed && styles.pressedSoft]}
              >
                <Ionicons
                  name={TYPE_ICONS[type.key] ?? "fitness"}
                  size={22}
                  color={theme.colors.bakar}
                />
                <Text style={styles.typeLabel} numberOfLines={2}>
                  {type.label}
                </Text>
                <Text style={styles.typeEstimate} numberOfLines={1}>
                  {per30 !== null ? `±${fmtKcal(per30)} kcal` : "kalori manual"}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}
      <Text style={styles.gridCaption}>
        {weightKg !== null
          ? "Estimasi kalori per 30 menit dengan berat badan terakhirmu."
          : "Catat berat badanmu di halaman Berat agar estimasi kalori tampil."}
      </Text>

      {/* Strength training: dedicated session logger */}
      <ListGroup>
        <ListRow
          icon="barbell"
          iconTint="bakar"
          title="Latihan beban"
          subtitle="Catat gerakan, set, reps, dan beban. Jaga otot saat defisit."
          chevron
          onPress={() => router.push("/latihan")}
        />
      </ListGroup>

      {/* Activity list */}
      <Text style={styles.sectionLabel}>Hari ini</Text>
      {items.length === 0 ? (
        <EmptyState
          icon="barbell-outline"
          title="Belum ada olahraga hari ini"
          description={`Pilih aktivitas di atas, sinkronkan Strava, atau impor dari ${healthSourceName}.`}
        />
      ) : (
        <ListGroup>
          {items.map((item) => (
            <ListRow
              key={item.id}
              icon="flame"
              iconTint="bakar"
              title={item.name}
              subtitle={`${item.durationMin != null ? `${fmtKcal(item.durationMin)} menit · ` : ""}${fmtKcal(item.kcal)} kcal · ${SOURCE_LABELS[item.source] ?? item.source}`}
              value={fmtKcal(item.kcal)}
              right={
                <View style={styles.rowActions}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Bagikan ${item.name} ke feed`}
                    onPress={() =>
                      setShareTarget({
                        kind: "latihan",
                        refId: item.id,
                        title: item.name,
                        preview: `${fmtKcal(item.kcal)} kcal${
                          item.durationMin != null ? ` · ${fmtKcal(item.durationMin)} menit` : ""
                        }`,
                      })
                    }
                    style={({ pressed }) => [styles.deleteButton, pressed && styles.pressedSoft]}
                  >
                    <Ionicons name="share-social-outline" size={18} />
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Hapus ${item.name}`}
                    onPress={() => removeExercise.mutate({ id: item.id })}
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

      <StravaCard />

      {/* Add form */}
      <Sheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title={
          sheetType === null
            ? "Tulis manual"
            : (typesQuery.data?.find((t) => t.key === sheetType)?.label ?? "Tambah Olahraga")
        }
        footer={<Button label="Tambah" onPress={submit} loading={addExercise.isPending} />}
      >
        <Field label="Jenis aktivitas">
          <View style={styles.chipRow}>
            {typesQuery.data?.map((type) => (
              <Chip
                key={type.key}
                label={type.label}
                selected={sheetType === type.key}
                onPress={() => pickType(type.key)}
              />
            ))}
          </View>
        </Field>
        <Field label={sheetType === null ? "Nama aktivitas" : "Nama (opsional)"}>
          <Input value={name} onChangeText={setName} placeholder="Jalan pagi" />
        </Field>
        <Field label="Durasi (menit)">
          <Input
            value={duration}
            onChangeText={setDuration}
            keyboardType="number-pad"
            placeholder="30"
          />
        </Field>
        <Field
          label="Kalori (kcal)"
          hint={latestKg ? `Estimasi pakai berat terkinimu, ${fmtKg(latestKg)} kg.` : undefined}
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
    alignItems: "center",
    paddingVertical: theme.spacing.xl,
  },
  burnLabel: {
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    color: theme.colors.mutedForeground,
  },
  burnValue: {
    fontSize: theme.fontSize["2xl"],
    fontWeight: "800",
    color: theme.colors.bakarText,
  },
  burnNote: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
    textAlign: "center",
  },
  activityRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: theme.spacing.xl,
  },
  activityCell: {
    alignItems: "center",
    gap: 2,
  },
  activityValue: {
    fontSize: theme.fontSize.lg,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  activityLabel: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.mutedForeground,
  },
  sectionLabel: {
    fontSize: theme.fontSize.md,
    fontWeight: "700",
    color: theme.colors.foreground,
    marginTop: theme.spacing.sm,
  },
  typeGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing.md,
  },
  typeTile: {
    flexGrow: 1,
    flexBasis: "45%",
    backgroundColor: theme.colors.bakarSoft,
    borderRadius: theme.radius.tile,
    padding: 16,
    gap: 8,
    minHeight: 84,
  },
  typeLabel: {
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    color: theme.colors.bakarText,
    lineHeight: 18,
  },
  typeEstimate: {
    fontSize: theme.fontSize.xs,
    fontWeight: "600",
    color: theme.colors.bakarText,
  },
  gridCaption: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.mutedForeground,
    marginTop: -theme.spacing.sm,
    paddingHorizontal: 2,
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
