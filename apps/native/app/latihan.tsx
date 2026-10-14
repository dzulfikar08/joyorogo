import "@/unistyles";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { Redirect, Stack, router } from "expo-router";
import { Pressable, ScrollView, View } from "react-native";
import { useState, useEffect } from "react";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import type { AppRouterClient } from "@joyorogo/api/routers/index";

import {
  BootLoader,
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorState,
  Num,
  PageHeader,
  Screen,
  SectionTitle,
  Text,
} from "@/components/ui";
import {
  type SessionDraft,
  SessionEditor,
  draftFromSession,
  draftFromTemplate,
} from "@/components/workout/session-editor";
import { useSessionGate } from "@/lib/use-session-gate";
import { ShareToFeedSheet } from "@/components/feed/share-to-feed";
import {
  emptySet,
  loadActiveWorkout,
  newExercise,
  setActiveWorkout,
  useActiveWorkout,
  type ActiveWorkout,
  type ExerciseType,
} from "@/lib/workout/active";
import { errorMessage, fmtDateId, fmtKcal } from "@/utils/format";
import { orpc } from "@/utils/orpc";

type WorkoutStatus = Awaited<ReturnType<AppRouterClient["workout"]["status"]>>;

/** Fresh draft for a workout starting right now. */
function startEmpty(): ActiveWorkout {
  return { name: "", note: "", startedAt: Date.now(), exercises: [] };
}

/** Weekly effective sets per muscle, loudest first, with warning callouts. */
function MuscleMap({ status }: { status: WorkoutStatus }) {
  const { theme } = useUnistyles();
  const maxSets = Math.max(...status.weekly.map((m) => m.sets), 1);

  return (
    <View style={styles.mapBody}>
      {status.trendHint ? (
        <View style={[styles.trendBox, { backgroundColor: theme.colors.bakarSoft }]}>
          <Ionicons name="trending-down" size={16} color={theme.colors.bakarText} />
          <Text style={[styles.trendText, { color: theme.colors.bakarText }]}>
            {status.trendHint.message}
          </Text>
        </View>
      ) : null}
      {status.warnings.slice(0, 3).map((warning) => (
        <View key={warning.muscle} style={styles.warningBox}>
          <View style={styles.warningHead}>
            <Ionicons name="alert-circle" size={14} color={theme.colors.bakarText} />
            <Text style={styles.warningText}>{warning.message}</Text>
          </View>
          {warning.suggestions.length > 0 ? (
            <Text style={styles.suggestionText}>
              Coba: {warning.suggestions.map((s) => s.name).join(", ")}
            </Text>
          ) : null}
        </View>
      ))}
      <View style={styles.volumeList}>
        {status.weekly.map((muscle) => (
          <View key={muscle.muscle} style={styles.volumeRow}>
            <Text style={styles.volumeLabel} numberOfLines={1}>
              {muscle.label}
            </Text>
            <View style={styles.volumeTrack}>
              <View
                style={[
                  styles.volumeBar,
                  {
                    width: `${Math.max((muscle.sets / maxSets) * 100, muscle.sets > 0 ? 4 : 0)}%`,
                    backgroundColor: theme.colors.primary,
                  },
                ]}
              />
            </View>
            <Num style={styles.volumeValue}>
              {muscle.sets > 0
                ? `${muscle.sets % 1 === 0 ? fmtKcal(muscle.sets) : muscle.sets.toFixed(1)} set`
                : "–"}
            </Num>
          </View>
        ))}
      </View>
      <Text style={styles.mapCaption}>
        Set efektif minggu ini: gerakan utama dihitung 1, pendukung 0,5.
      </Text>
    </View>
  );
}

/** Live draft persisted across app kills shows the resume banner. */
function ResumeBanner() {
  const workout = useActiveWorkout();
  if (workout === null) return null;
  const totalSets = workout.exercises.reduce((n, e) => n + e.sets.length, 0);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Lanjutkan latihan"
      onPress={() => router.push("/latihan/aktif")}
      style={({ pressed }) => [styles.resume, pressed && styles.pressed]}
    >
      <Ionicons name="play" size={18} color="#FFFFFF" />
      <View style={styles.resumeText}>
        <Text style={styles.resumeTitle}>Lanjutkan latihan</Text>
        <Text style={styles.resumeSub}>
          {workout.name.trim().length > 0 ? workout.name : "Sesi tanpa nama"}
          {totalSets > 0 ? ` · ${totalSets} set` : ""}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color="#FFFFFF" />
    </Pressable>
  );
}

export default function Latihan() {
  const { theme } = useUnistyles();
  const gate = useSessionGate();
  // Restore a draft persisted by a previous app run before showing resume.
  useEffect(() => {
    void loadActiveWorkout();
  }, []);
  const status = useQuery(orpc.workout.status.queryOptions({ input: {} }));
  const templates = useQuery(orpc.workout.templates.queryOptions());
  const last = useQuery(orpc.workout.lastSession.queryOptions());
  const history = useQuery(orpc.workout.listSessions.queryOptions({ input: { limit: 20 } }));
  const catalog = useQuery(orpc.workout.catalog.queryOptions());
  const routines = useQuery(orpc.workout.routines.listRoutines.queryOptions());

  // Saved-session editing keeps the lightweight draft editor.
  const [draft, setDraft] = useState<SessionDraft | null>(null);
  const [shareTarget, setShareTarget] = useState<
    null | { refId: string; title: string; preview: string }
  >(null);
  const typeOf = (id: string): ExerciseType =>
    (catalog.data?.exercises.find((e) => e.id === id)?.type ?? "weight_reps") as ExerciseType;
  const nameOf = (id: string) => catalog.data?.exercises.find((e) => e.id === id)?.name ?? id;

  if (gate === "loading") {
    return <BootLoader />;
  }
  if (gate === "anon") {
    return <Redirect href="/login" />;
  }

  const begin = (build: () => ActiveWorkout) => {
    setActiveWorkout(build());
    router.push("/latihan/aktif");
  };

  /** Last session replayed as an active workout, same movements and sets. */
  const fromLastSession = (): ActiveWorkout | null => {
    const item = last.data;
    if (!item) return null;
    const grouped = new Map<string, { name: string; sets: ReturnType<typeof emptySet>[] }>();
    for (const set of item.sets) {
      const entry = grouped.get(set.exerciseId) ?? { name: nameOf(set.exerciseId), sets: [] };
      entry.sets.push({
        ...emptySet(),
        reps: String(set.reps),
        weightKg: set.weightKg != null ? String(set.weightKg) : "",
      });
      grouped.set(set.exerciseId, entry);
    }
    return {
      name: item.session.name,
      note: "",
      startedAt: Date.now(),
      exercises: [...grouped.entries()].map(([exerciseId, entry]) => ({
        ...newExercise({ id: exerciseId, name: entry.name, type: typeOf(exerciseId) }, entry.sets),
      })),
    };
  };

  const fromTemplate = (templateId: string): ActiveWorkout => {
    const template = (templates.data ?? []).find((t) => t.id === templateId);
    if (!template) return startEmpty();
    return {
      name: template.name,
      note: "",
      startedAt: Date.now(),
      exercises: template.exercises.map((item) =>
        newExercise(
          { id: item.exerciseId, name: nameOf(item.exerciseId), type: typeOf(item.exerciseId) },
          Array.from({ length: item.sets }, () => ({
            ...emptySet(),
            reps: String(item.targetReps),
          })),
        ),
      ),
    };
  };

  const fromRoutine = (routineId: string): ActiveWorkout => {
    const routine = (routines.data ?? []).find((r) => r.id === routineId);
    if (!routine) return startEmpty();
    return {
      name: routine.name,
      note: "",
      startedAt: Date.now(),
      exercises: routine.exercises.map((item) =>
        newExercise(
          { id: item.exerciseId, name: nameOf(item.exerciseId), type: typeOf(item.exerciseId) },
          item.sets.map((set) => ({
            type: set.setType,
            weightKg: set.weightKg != null ? String(set.weightKg) : "",
            reps: set.reps != null ? String(set.reps) : "",
            durationSec: set.durationSec != null ? String(set.durationSec) : "",
            done: false,
          })),
        ),
      ),
    };
  };

  return (
    <>
      <Stack.Screen options={{ title: "Latihan Beban" }} />
      <Screen>
        <PageHeader
          title="Latihan Beban"
          caption="Turun berat tanpa kehilangan otot."
          right={
            <Button
              variant="secondary"
              size="sm"
              label="Mulai"
              onPress={() => begin(startEmpty)}
            />
          }
        />

        <ResumeBanner />

        <SectionTitle title="Mulai cepat" />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.quickRow}
        >
          {last.data ? (
            <Chip
              label={`Ulangi: ${last.data.session.name}`}
              onPress={() => begin(() => fromLastSession() ?? startEmpty())}
            />
          ) : null}
          {(templates.data ?? []).map((template) => (
            <Chip
              key={template.id}
              label={template.name}
              onPress={() => begin(() => fromTemplate(template.id))}
            />
          ))}
          <Chip label="Sesi kosong" onPress={() => begin(startEmpty)} />
        </ScrollView>

        <SectionTitle
          title="Rutinitas"
          action={{ label: "Buat", onPress: () => router.push("/latihan/rutinitas") }}
        />
        {routines.isPending ? (
          <Card>
            <Text style={styles.loadingText}>Memuat rutinitas…</Text>
          </Card>
        ) : (routines.data?.length ?? 0) === 0 ? (
          <Card>
            <Text style={styles.loadingText}>
              Belum ada rutinitas. Simpan kombinasi latihan andalanmu di sini.
            </Text>
          </Card>
        ) : (
          <Card style={styles.historyCard}>
            {routines.data!.map((routine) => (
              <View key={routine.id} style={styles.routineRow}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Edit rutinitas ${routine.name}`}
                  onPress={() => router.push(`/latihan/rutinitas?id=${routine.id}`)}
                  style={({ pressed }) => [styles.routineMain, pressed && styles.pressed]}
                >
                  <Text style={styles.prName} numberOfLines={1}>
                    {routine.name}
                  </Text>
                  <Text style={styles.prSub} numberOfLines={1}>
                    {routine.exercises.length} gerakan ·{" "}
                    {routine.exercises.reduce((n, e) => n + e.sets.length, 0)} set
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Mulai rutinitas ${routine.name}`}
                  onPress={() => begin(() => fromRoutine(routine.id))}
                  style={({ pressed }) => [styles.playButton, pressed && styles.pressed]}
                >
                  <Ionicons name="play" size={16} color={theme.colors.primary} />
                </Pressable>
              </View>
            ))}
          </Card>
        )}

        <SectionTitle title="Peta otot minggu ini" />
        {status.isPending ? (
          <Card>
            <Text style={styles.loadingText}>Menghitung volume otot…</Text>
          </Card>
        ) : status.isError ? (
          <ErrorState message={errorMessage(status.error)} onRetry={() => status.refetch()} />
        ) : (
          <Card>
            <MuscleMap status={status.data} />
          </Card>
        )}

        <SectionTitle title="Progres kekuatan" />
        <Card>
          {status.isPending ? (
            <Text style={styles.loadingText}>Memuat rekor…</Text>
          ) : (status.data?.prs.length ?? 0) === 0 ? (
            <Text style={styles.loadingText}>
              Belum ada rekor. Selesaikan satu sesi, rekor gerakan muncul di sini.
            </Text>
          ) : (
            <View style={styles.prList}>
              {status.data!.prs.slice(0, 10).map((pr) => (
                <Pressable
                  key={pr.exerciseId}
                  accessibilityRole="button"
                  accessibilityLabel={`Riwayat ${pr.name}`}
                  onPress={() => router.push(`/latihan/gerakan?id=${pr.exerciseId}`)}
                  style={({ pressed }) => [styles.prRow, pressed && styles.pressed]}
                >
                  <View style={styles.prText}>
                    <Text style={styles.prName} numberOfLines={1}>
                      {pr.name}
                    </Text>
                    <Text style={styles.prSub} numberOfLines={1}>
                      {pr.bestSet
                        ? `Rekor: ${pr.bestSet.reps}× ${
                            pr.bestSet.weightKg != null
                              ? `${fmtKcal(pr.bestSet.weightKg)} kg`
                              : "tanpa beban"
                          }${pr.best1RM ? ` · e1RM ${fmtKcal(pr.best1RM.e1rm ?? 0)} kg` : ""}`
                        : "–"}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={15} color={theme.colors.mutedForeground} />
                </Pressable>
              ))}
            </View>
          )}
        </Card>

        <SectionTitle title="Riwayat sesi" />
        {history.isPending ? (
          <Card>
            <Text style={styles.loadingText}>Memuat riwayat…</Text>
          </Card>
        ) : (history.data?.items.length ?? 0) === 0 ? (
          <EmptyState
            pose="determined"
            title="Belum ada sesi"
            description="Mulai dari template di atas. Dua-tiga sesi seminggu cukup buat jaga otot."
          />
        ) : (
          <Card style={styles.historyCard}>
            {history.data!.items.map((item) => (
              <View key={item.session.id} style={styles.historyRowWrap}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Edit sesi ${item.session.name}`}
                  onPress={() => setDraft(draftFromSession(item, nameOf))}
                  style={({ pressed }) => [styles.prText, styles.pressed]}
                >
                  <Text style={styles.prName} numberOfLines={1}>
                    {item.session.name}
                  </Text>
                  <Text style={styles.prSub} numberOfLines={1}>
                    {fmtDateId(item.session.date)}
                    {item.session.durationMin != null
                      ? ` · ${fmtKcal(item.session.durationMin)} menit`
                      : ""}
                    {` · ${item.sets.length} set`}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Bagikan sesi ${item.session.name} ke feed`}
                  onPress={() =>
                    setShareTarget({
                      refId: item.session.id,
                      title: item.session.name,
                      preview: `${fmtDateId(item.session.date)} · ${item.sets.length} set${
                        item.session.durationMin != null
                          ? ` · ${fmtKcal(item.session.durationMin)} menit`
                          : ""
                      }`,
                    })
                  }
                  style={({ pressed }) => [styles.shareButton, pressed && styles.pressed]}
                >
                  <Ionicons name="share-social-outline" size={16} color={theme.colors.foreground} />
                </Pressable>
                <Ionicons name="pencil" size={15} color={theme.colors.mutedForeground} />
              </View>
            ))}
          </Card>
        )}
      </Screen>

      {draft !== null ? (
        <SessionEditor draft={draft} onClose={() => setDraft(null)} />
      ) : null}

      <ShareToFeedSheet
        visible={shareTarget !== null}
        onClose={() => setShareTarget(null)}
        title={shareTarget?.title ?? ""}
        preview={shareTarget?.preview ?? ""}
        kind="latihan"
        refId={shareTarget?.refId ?? ""}
      />
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  pressed: { opacity: 0.7 },
  resume: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    backgroundColor: theme.colors.primary,
    borderRadius: theme.radius.tile,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.md,
  },
  resumeText: { flex: 1 },
  resumeTitle: { fontSize: theme.fontSize.sm, fontWeight: "800", color: "#FFFFFF" },
  resumeSub: { fontSize: theme.fontSize.xs, color: "#FFFFFF", opacity: 0.85 },
  quickRow: { gap: theme.spacing.sm, paddingVertical: theme.spacing.xs },
  loadingText: { fontSize: theme.fontSize.sm, color: theme.colors.mutedForeground },
  mapBody: { gap: theme.spacing.md },
  trendBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing.sm,
    padding: theme.spacing.md,
    borderRadius: theme.radius.tile,
  },
  trendText: { flex: 1, fontSize: theme.fontSize.sm, fontWeight: "600" },
  warningBox: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.hairline,
    borderRadius: theme.radius.tile,
    padding: theme.spacing.md,
    gap: 4,
  },
  warningHead: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm },
  warningText: {
    flex: 1,
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  suggestionText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.mutedForeground,
    paddingLeft: 22,
  },
  volumeList: { gap: theme.spacing.sm },
  volumeRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing.md },
  volumeLabel: {
    width: 104,
    fontSize: theme.fontSize.xs,
    fontWeight: "600",
    color: theme.colors.foreground,
  },
  volumeTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: theme.colors.muted },
  volumeBar: { height: 8, borderRadius: 4 },
  volumeValue: {
    width: 52,
    textAlign: "right",
    fontSize: theme.fontSize.xs,
    fontWeight: "700",
    color: theme.colors.mutedForeground,
  },
  mapCaption: { fontSize: theme.fontSize.xs, color: theme.colors.mutedForeground },
  prList: { gap: theme.spacing.md },
  prRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing.md },
  prText: { flex: 1, gap: 2 },
  prName: { fontSize: theme.fontSize.sm, fontWeight: "700", color: theme.colors.foreground },
  prSub: { fontSize: theme.fontSize.xs, color: theme.colors.mutedForeground },
  routineRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    paddingVertical: theme.spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.hairline,
  },
  routineMain: { flex: 1, gap: 2 },
  playButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.makanSoft,
  },
  historyCard: { gap: 0 },
  historyRowWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    paddingVertical: theme.spacing.md,
  },
  shareButton: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
}));
