import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { router, Stack } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  AppState,
  Pressable,
  ScrollView,
  Vibration,
  View,
} from "react-native";
import { Swipeable } from "react-native-gesture-handler";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  Button,
  Card,
  Chip,
  Field,
  Input,
  Num,
  Sheet,
  Text,
} from "@/components/ui";
import { ConfirmSheet } from "@/components/confirm-sheet";
import { useSessionGate } from "@/lib/use-session-gate";
import {
  completedSetCount,
  emptySet,
  formatClock,
  nextSetType,
  previousSetLabel,
  SET_TYPE_LABEL,
  showsDuration,
  showsWeight,
  uncheckedSetCount,
  useActiveWorkout,
  workoutVolume,
  patchActiveWorkout,
  setActiveWorkout,
  type ActiveExercise,
  type ActiveSet,
} from "@/lib/workout/active";
import {
  cancelRestEndNotification,
  scheduleRestEndNotification,
} from "@/lib/workout/notify";
import { orpc } from "@/utils/orpc";

const REST_OPTIONS = [
  { value: null, label: "Nonaktif" },
  { value: 60, label: "1:00" },
  { value: 90, label: "1:30" },
  { value: 120, label: "2:00" },
  { value: 180, label: "3:00" },
];

type MenuTarget = { index: number; exercise: ActiveExercise } | null;

/** Ticking clock for the live duration / rest countdown headers. */
function useNow(running: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [running]);
  return now;
}

export default function LatihanAktif() {
  const { theme } = useUnistyles();
  const gate = useSessionGate();
  const insets = useSafeAreaInsets();
  const workout = useActiveWorkout();
  const [restEndsAt, setRestEndsAt] = useState<number | null>(null);
  const [restTotal, setRestTotal] = useState(0);
  const [menu, setMenu] = useState<MenuTarget>(null);
  const [noteFor, setNoteFor] = useState<number | null>(null);
  const [restFor, setRestFor] = useState<number | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [finishUnchecked, setFinishUnchecked] = useState<number | null>(null);
  const now = useNow(true);
  const scheduledForEnd = useRef<number | null>(null);

  const exerciseIds = useMemo(
    () => (workout ? [...new Set(workout.exercises.map((e) => e.exerciseId))] : []),
    [workout],
  );
  const previous = useQuery(
    orpc.workout.previous.queryOptions({ input: { exerciseIds }, enabled: exerciseIds.length > 0 }),
  );

  const patch = useCallback(patchActiveWorkout, []);

  // Rest countdown: vibrate at zero, keep the scheduled notification honest
  // when the app moves to the background mid-rest.
  useEffect(() => {
    if (restEndsAt === null) return;
    if (now >= restEndsAt) {
      Vibration.vibrate([0, 400, 200, 400]);
      setRestEndsAt(null);
      void cancelRestEndNotification();
      return;
    }
    const appState = AppState.currentState;
    if (appState.match(/inactive|background/)) {
      const remaining = Math.ceil((restEndsAt - now) / 1000);
      if (scheduledForEnd.current !== restEndsAt) {
        scheduledForEnd.current = restEndsAt;
        void scheduleRestEndNotification(Math.max(1, remaining));
      }
    }
  }, [now, restEndsAt]);

  const startRest = (seconds: number) => {
    setRestTotal(seconds);
    setRestEndsAt(Date.now() + seconds * 1000);
  };

  if (gate === "loading") return null;
  if (workout === null) {
    // Draft discarded elsewhere; nothing to log here anymore.
    return (
      <>
        <Stack.Screen options={{ title: "Latihan" }} />
        <View style={styles.emptyRoot}>
          <Text style={styles.emptyText}>Tidak ada latihan berjalan.</Text>
          <Button label="Kembali" onPress={() => router.back()} />
        </View>
      </>
    );
  }

  const elapsed = now - workout.startedAt;

  const patchExercise = (index: number, next: Partial<ActiveExercise>) => {
    patch((prev) => ({
      ...prev,
      exercises: prev.exercises.map((exercise, i) => (i === index ? { ...exercise, ...next } : exercise)),
    }));
  };

  const patchSet = (exerciseIndex: number, setIndex: number, next: Partial<ActiveSet>) => {
    patch((prev) => ({
      ...prev,
      exercises: prev.exercises.map((exercise, i) =>
        i === exerciseIndex
          ? { ...exercise, sets: exercise.sets.map((set, si) => (si === setIndex ? { ...set, ...next } : set)) }
          : exercise,
      ),
    }));
  };

  const toggleDone = (exerciseIndex: number, set: ActiveSet, setIndex: number) => {
    const becomingDone = !set.done;
    patchSet(exerciseIndex, setIndex, { done: becomingDone });
    if (becomingDone) {
      Vibration.vibrate(15);
      const restSec = workout.exercises[exerciseIndex].restSec;
      if (restSec !== null && restSec > 0) startRest(restSec);
    } else {
      setRestEndsAt(null);
      void cancelRestEndNotification();
    }
  };

  const fillFromPrevious = (exerciseIndex: number, setIndex: number) => {
    const history = previous.data?.[workout.exercises[exerciseIndex].exerciseId];
    const prev = history?.[setIndex];
    if (!prev) return;
    patchSet(exerciseIndex, setIndex, {
      weightKg: prev.weightKg != null ? String(prev.weightKg) : "",
      reps: prev.reps != null ? String(prev.reps) : "",
      durationSec: prev.durationSec != null ? String(prev.durationSec) : "",
    });
  };

  const addSet = (exerciseIndex: number) => {
    patch((prev) => ({
      ...prev,
      exercises: prev.exercises.map((exercise, i) => {
        if (i !== exerciseIndex) return exercise;
        const last = exercise.sets[exercise.sets.length - 1];
        const copy: ActiveSet = last
          ? { ...last, done: false }
          : emptySet();
        return { ...exercise, sets: [...exercise.sets, copy] };
      }),
    }));
  };

  const removeSet = (exerciseIndex: number, setIndex: number) => {
    patch((prev) => ({
      ...prev,
      exercises: prev.exercises.map((exercise, i) =>
        i === exerciseIndex
          ? { ...exercise, sets: exercise.sets.filter((_, si) => si !== setIndex) }
          : exercise,
      ),
    }));
  };

  const removeExercise = (index: number) => {
    patch((prev) => ({
      ...prev,
      exercises: prev.exercises
        .filter((_, i) => i !== index)
        .map((exercise) => exercise),
    }));
    setMenu(null);
  };

  const moveExercise = (index: number, delta: number) => {
    patch((prev) => {
      const target = index + delta;
      if (target < 0 || target >= prev.exercises.length) return prev;
      const exercises = [...prev.exercises];
      const [moved] = exercises.splice(index, 1);
      exercises.splice(target, 0, moved!);
      return { ...prev, exercises };
    });
    setMenu(null);
  };

  const toggleSuperset = (index: number) => {
    patch((prev) => {
      const current = prev.exercises[index];
      const next = prev.exercises[index + 1];
      if (!next) return prev;
      if (current.supersetGroup !== null) {
        // Break the pair apart.
        return {
          ...prev,
          exercises: prev.exercises.map((exercise, i) =>
            i === index || i === index + 1 ? { ...exercise, supersetGroup: null } : exercise,
          ),
        };
      }
      const groupId = prev.exercises.reduce((max, e) => Math.max(max, e.supersetGroup ?? 0), 0) + 1;
      return {
        ...prev,
        exercises: prev.exercises.map((exercise, i) =>
          i === index || i === index + 1 ? { ...exercise, supersetGroup: groupId } : exercise,
        ),
      };
    });
    setMenu(null);
  };

  const finish = () => {
    const unchecked = uncheckedSetCount(workout);
    const go = () => {
      setRestEndsAt(null);
      void cancelRestEndNotification();
      router.push("/latihan/ringkasan");
    };
    if (unchecked > 0) {
      setFinishUnchecked(unchecked);
      return;
    }
    go();
  };

  const discard = () => setConfirmDiscard(true);

  const menuExercise = menu;

  return (
    <>
      <Stack.Screen options={{ title: "Latihan", headerBackVisible: false }} />
      <View style={styles.root}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 96 }]}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.statRow}>
            <View style={styles.stat}>
              <Text style={styles.statValue}>{formatClock(elapsed)}</Text>
              <Text style={styles.statLabel}>Durasi</Text>
            </View>
            <View style={styles.stat}>
              <Num style={styles.statValue}>{Math.round(workoutVolume(workout))}</Num>
              <Text style={styles.statLabel}>Volume (kg)</Text>
            </View>
            <View style={styles.stat}>
              <Num style={styles.statValue}>
                {completedSetCount(workout)}/{workout.exercises.reduce((n, e) => n + e.sets.length, 0)}
              </Num>
              <Text style={styles.statLabel}>Set selesai</Text>
            </View>
          </View>

          <Input
            value={workout.name}
            onChangeText={(name) => patch((prev) => ({ ...prev, name }))}
            placeholder="Nama sesi, mis. Push Senin"
            style={styles.nameInput}
          />

          {workout.exercises.map((exercise, exerciseIndex) => (
            <Card
              key={`${exercise.exerciseId}-${exerciseIndex}`}
              style={[
                styles.exerciseCard,
                ...(exercise.supersetGroup !== null ? [styles.supersetCard] : []),
              ]}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Menu ${exercise.name}`}
                onPress={() => setMenu({ index: exerciseIndex, exercise })}
                style={styles.exerciseHead}
              >
                <View style={styles.exerciseTitleRow}>
                  {exercise.supersetGroup !== null ? (
                    <View style={[styles.supersetDot, { backgroundColor: theme.colors.tidur }]} />
                  ) : null}
                  <Text style={styles.exerciseName} numberOfLines={1}>
                    {exercise.name}
                  </Text>
                  <Ionicons name="chevron-down" size={16} color={theme.colors.mutedForeground} />
                </View>
                <Chip
                  label={exercise.restSec === null ? "Istirahat: mati" : `Istirahat ${formatClock(exercise.restSec * 1000)}`}
                  onPress={() => setRestFor(exerciseIndex)}
                />
              </Pressable>
              {exercise.note.trim().length > 0 ? (
                <Text style={styles.exerciseNote} numberOfLines={2}>
                  {exercise.note}
                </Text>
              ) : null}

              <View style={styles.setHeader}>
                <Text style={[styles.setHeaderCell, styles.colSet]}>SET</Text>
                <Text style={styles.setHeaderCell}>SEBELUMNYA</Text>
                {showsWeight(exercise.type) ? (
                  <Text style={styles.setHeaderCell}>KG</Text>
                ) : null}
                <Text style={styles.setHeaderCell}>
                  {showsDuration(exercise.type) ? "DETIK" : "REPS"}
                </Text>
                <View style={styles.colCheck} />
              </View>

              {exercise.sets.map((set, setIndex) => {
                const prevSet = previous.data?.[exercise.exerciseId]?.[setIndex];
                return (
                  <Swipeable
                    key={setIndex}
                    renderRightActions={() => (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Hapus set ${setIndex + 1}`}
                        onPress={() => removeSet(exerciseIndex, setIndex)}
                        style={styles.swipeDelete}
                      >
                        <Ionicons name="trash" size={18} color={theme.colors.primaryForeground} />
                      </Pressable>
                    )}
                  >
                    <View style={[styles.setRow, set.done && styles.setRowDone]}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Tipe set ${setIndex + 1}`}
                        onPress={() =>
                          patchSet(exerciseIndex, setIndex, { type: nextSetType(set.type) })
                        }
                        style={[
                          styles.setType,
                          set.type !== "normal" && { backgroundColor: theme.colors.muted },
                        ]}
                      >
                        <Num style={styles.setTypeText}>
                          {set.type === "normal" ? setIndex + 1 : SET_TYPE_LABEL[set.type]}
                        </Num>
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Isi dari latihan sebelumnya"
                        disabled={!prevSet}
                        onPress={() => fillFromPrevious(exerciseIndex, setIndex)}
                        style={styles.prevCell}
                      >
                        <Text
                          style={[styles.prevText, !prevSet && styles.prevEmpty]}
                          numberOfLines={1}
                        >
                          {prevSet ? previousSetLabel(prevSet) : "—"}
                        </Text>
                      </Pressable>
                      {showsWeight(exercise.type) ? (
                        <Input
                          value={set.weightKg}
                          onChangeText={(weightKg) => patchSet(exerciseIndex, setIndex, { weightKg })}
                          placeholder="0"
                          keyboardType="decimal-pad"
                          style={styles.setInput}
                        />
                      ) : null}
                      {showsDuration(exercise.type) ? (
                        <Input
                          value={set.durationSec}
                          onChangeText={(durationSec) => patchSet(exerciseIndex, setIndex, { durationSec })}
                          placeholder="0"
                          keyboardType="number-pad"
                          style={styles.setInput}
                        />
                      ) : (
                        <Input
                          value={set.reps}
                          onChangeText={(reps) => patchSet(exerciseIndex, setIndex, { reps })}
                          placeholder="0"
                          keyboardType="number-pad"
                          style={styles.setInput}
                        />
                      )}
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={set.done ? `Batalkan set ${setIndex + 1}` : `Set ${setIndex + 1} selesai`}
                        onPress={() => toggleDone(exerciseIndex, set, setIndex)}
                        style={[styles.check, set.done && styles.checkDone]}
                      >
                        <Ionicons
                          name={set.done ? "checkmark" : "checkmark-outline"}
                          size={18}
                          color={set.done ? theme.colors.primaryForeground : theme.colors.mutedForeground}
                        />
                      </Pressable>
                    </View>
                  </Swipeable>
                );
              })}

              <Button
                variant="secondary"
                size="sm"
                label="Tambah set"
                icon="add"
                style={styles.addSet}
                onPress={() => addSet(exerciseIndex)}
              />
            </Card>
          ))}
        </ScrollView>

        <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          {restEndsAt !== null ? (
            <View style={styles.restBar}>
              <View style={styles.restInfo}>
                <Ionicons name="timer" size={18} color={theme.colors.primaryForeground} />
                <Num style={styles.restTime}>{formatClock(restEndsAt - now)}</Num>
              </View>
              <View style={styles.restActions}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Kurangi 15 detik"
                  onPress={() => setRestEndsAt(Math.max(now + 1000, restEndsAt - 15000))}
                  style={styles.restButton}
                >
                  <Text style={styles.restButtonText}>-15s</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Tambah 15 detik"
                  onPress={() => setRestEndsAt(restEndsAt + 15000)}
                  style={styles.restButton}
                >
                  <Text style={styles.restButtonText}>+15s</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Lewati istirahat"
                  onPress={() => {
                    setRestEndsAt(null);
                    void cancelRestEndNotification();
                  }}
                  style={styles.restButton}
                >
                  <Text style={styles.restButtonText}>Lewati</Text>
                </Pressable>
              </View>
              <Text style={styles.restTotal}>{formatClock(restTotal * 1000)}</Text>
            </View>
          ) : (
            <Button
              label="Tambah latihan"
              icon="add"
              onPress={() => router.push("/latihan/pilih?mode=add")}
            />
          )}
          <View style={styles.finishRow}>
            <Button variant="secondary" label="Buang" onPress={discard} style={styles.finishSide} />
            <Button label="Selesai" onPress={finish} style={styles.finishMain} />
          </View>
        </View>

        <Sheet
          visible={menuExercise !== null}
          onClose={() => setMenu(null)}
          title={menuExercise?.exercise.name ?? ""}
        >
          {menuExercise ? (
            <View style={styles.menuList}>
              <Button
                variant="secondary"
                label="Ganti latihan"
                onPress={() => {
                  router.push(`/latihan/pilih?mode=replace&index=${menuExercise.index}`);
                  setMenu(null);
                }}
              />
              <Button
                variant="secondary"
                label="Catatan"
                onPress={() => {
                  setNoteFor(menuExercise.index);
                  setMenu(null);
                }}
              />
              <Button
                variant="secondary"
                label={
                  menuExercise.exercise.supersetGroup !== null
                    ? "Lepas superset"
                    : "Superset dengan berikutnya"
                }
                disabled={menuExercise.index >= (workout?.exercises.length ?? 0) - 1}
                onPress={() => toggleSuperset(menuExercise.index)}
              />
              <Button
                variant="secondary"
                label="Naikkan urutan"
                disabled={menuExercise.index === 0}
                onPress={() => moveExercise(menuExercise.index, -1)}
              />
              <Button
                variant="secondary"
                label="Turunkan urutan"
                disabled={menuExercise.index >= (workout?.exercises.length ?? 0) - 1}
                onPress={() => moveExercise(menuExercise.index, 1)}
              />
              <Button
                variant="primary"
                destructive
                label="Hapus latihan"
                onPress={() => removeExercise(menuExercise.index)}
              />
            </View>
          ) : null}
        </Sheet>

        <ExerciseNoteSheet
          index={noteFor}
          initialNote={noteFor !== null ? (workout.exercises[noteFor]?.note ?? "") : ""}
          onClose={() => setNoteFor(null)}
          onSave={(note) => {
            if (noteFor !== null) patchExercise(noteFor, { note });
            setNoteFor(null);
          }}
        />

        <Sheet
          visible={restFor !== null}
          onClose={() => setRestFor(null)}
          title="Waktu istirahat"
        >
          <View style={styles.chipRow}>
            {REST_OPTIONS.map((option) => (
              <Chip
                key={option.label}
                label={option.label}
                selected={
                  restFor !== null && workout.exercises[restFor]?.restSec === option.value
                }
                onPress={() => {
                  if (restFor !== null) patchExercise(restFor, { restSec: option.value });
                  setRestFor(null);
                }}
              />
            ))}
          </View>
        </Sheet>

        <ConfirmSheet
          visible={confirmDiscard}
          onClose={() => setConfirmDiscard(false)}
          title="Buang latihan?"
          message="Semua set yang sudah dicatat akan hilang."
          confirmLabel="Buang"
          onConfirm={() => {
            setConfirmDiscard(false);
            setActiveWorkout(null);
            void cancelRestEndNotification();
            router.back();
          }}
        />

        <ConfirmSheet
          visible={finishUnchecked !== null}
          onClose={() => setFinishUnchecked(null)}
          title="Ada set belum dicentang"
          message={`${finishUnchecked ?? 0} set belum ditandai selesai. Set yang tidak dicentang tidak akan disimpan.`}
          confirmLabel="Simpan tanpa set itu"
          cancelLabel="Kembali"
          onConfirm={() => {
            setFinishUnchecked(null);
            setRestEndsAt(null);
            void cancelRestEndNotification();
            router.push("/latihan/ringkasan");
          }}
        />
      </View>
    </>
  );
}

function ExerciseNoteSheet({
  index,
  initialNote,
  onClose,
  onSave,
}: {
  index: number | null;
  initialNote: string;
  onClose: () => void;
  onSave: (note: string) => void;
}) {
  const [draft, setDraft] = useState(initialNote);
  return (
    <Sheet visible={index !== null} onClose={onClose} title="Catatan latihan">
      <Field label="Catatan" hint="Mis. pegangan lebar, turun pelan.">
        <Input value={draft} onChangeText={setDraft} placeholder="Mis. pegangan lebar, turun pelan" multiline />
      </Field>
      <Button label="Simpan catatan" onPress={() => onSave(draft)} />
    </Sheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: { flex: 1, backgroundColor: theme.colors.background },
  scroll: { flex: 1 },
  content: { padding: theme.spacing.lg, gap: theme.spacing.md },
  emptyRoot: { flex: 1, alignItems: "center", justifyContent: "center", gap: theme.spacing.lg },
  emptyText: { color: theme.colors.mutedForeground },
  statRow: { flexDirection: "row", gap: theme.spacing.sm },
  stat: { flex: 1, alignItems: "center", backgroundColor: theme.colors.card, borderRadius: theme.radius.tile, paddingVertical: theme.spacing.md, gap: 2 },
  statValue: { fontSize: theme.fontSize.md, fontWeight: "800", color: theme.colors.foreground },
  statLabel: { fontSize: theme.fontSize.xs, color: theme.colors.mutedForeground },
  nameInput: { fontWeight: "700", fontSize: theme.fontSize.md },
  exerciseCard: { gap: theme.spacing.md },
  supersetCard: { borderLeftWidth: 3, borderLeftColor: theme.colors.tidur },
  exerciseHead: { gap: theme.spacing.sm },
  exerciseTitleRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm },
  supersetDot: { width: 8, height: 8, borderRadius: 4 },
  exerciseName: { flex: 1, fontSize: theme.fontSize.md, fontWeight: "700", color: theme.colors.foreground },
  exerciseNote: { fontSize: theme.fontSize.sm, color: theme.colors.mutedForeground },
  setHeader: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm },
  setHeaderCell: { fontSize: 10, fontWeight: "700", color: theme.colors.mutedForeground, letterSpacing: 0.5 },
  colSet: { width: 34, textAlign: "center" },
  colCheck: { width: 40 },
  prevCell: { flex: 1.4 },
  prevText: { fontSize: theme.fontSize.sm, color: theme.colors.mutedForeground },
  prevEmpty: { opacity: 0.5 },
  setRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    borderRadius: theme.radius.input,
  },
  setRowDone: { backgroundColor: theme.colors.makanSoft },
  setType: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  setTypeText: { fontSize: theme.fontSize.sm, fontWeight: "800", color: theme.colors.foreground },
  setInput: { flex: 1, paddingHorizontal: 10, height: 40 },
  check: {
    width: 40,
    height: 34,
    borderRadius: theme.radius.input,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.muted,
  },
  checkDone: { backgroundColor: theme.colors.primary },
  swipeDelete: {
    width: 64,
    marginLeft: theme.spacing.sm,
    borderRadius: theme.radius.input,
    backgroundColor: theme.colors.destructive,
    alignItems: "center",
    justifyContent: "center",
  },
  addSet: { alignSelf: "flex-start" },
  bottomBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.md,
    gap: theme.spacing.sm,
    backgroundColor: theme.colors.background,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.hairline,
  },
  restBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    backgroundColor: theme.colors.primary,
    borderRadius: theme.radius.tile,
    padding: theme.spacing.md,
  },
  restInfo: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm },
  restTime: { fontSize: theme.fontSize.lg, fontWeight: "800", color: theme.colors.primaryForeground },
  restActions: { flex: 1, flexDirection: "row", gap: theme.spacing.sm },
  restButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: theme.radius.pill,
    backgroundColor: "rgba(255,255,255,0.18)",
  },
  restButtonText: { fontSize: theme.fontSize.xs, fontWeight: "700", color: theme.colors.primaryForeground },
  restTotal: { fontSize: theme.fontSize.xs, color: theme.colors.primaryForeground, opacity: 0.8 },
  finishRow: { flexDirection: "row", gap: theme.spacing.sm },
  finishSide: { flex: 1 },
  finishMain: { flex: 2 },
  menuList: { gap: theme.spacing.sm },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.sm },
}));
