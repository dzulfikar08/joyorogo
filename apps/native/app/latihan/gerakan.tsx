import { useQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams, Stack } from "expo-router";
import { ScrollView, View } from "react-native";
import { Circle, Polyline, Svg } from "react-native-svg";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { Button, Card, EmptyState, Num, SectionTitle, Text } from "@/components/ui";
import { useSessionGate } from "@/lib/use-session-gate";
import {
  newExercise,
  previousSetLabel,
  setActiveWorkout,
  SET_TYPE_LABEL,
} from "@/lib/workout/active";
import { errorMessage, fmtDateMedium, fmtKg } from "@/utils/format";
import { orpc } from "@/utils/orpc";

const CHART_W = 300;
const CHART_H = 120;
const CHART_PAD = 8;

/** Best-estimated-1RM trend as a minimal sparkline with end dots. */
function OneRmChart({ points }: { points: Array<{ date: string; oneRm: number }> }) {
  const { theme } = useUnistyles();
  if (points.length < 2) {
    return (
      <Text style={styles.chartEmpty}>
        Butuh minimal dua sesi berbeban untuk grafik e1RM.
      </Text>
    );
  }
  const values = points.map((p) => p.oneRm);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(max - min, 1);
  const coords = points.map((p, i) => ({
    x: CHART_PAD + (i / (points.length - 1)) * (CHART_W - CHART_PAD * 2),
    y: CHART_H - CHART_PAD - ((p.oneRm - min) / span) * (CHART_H - CHART_PAD * 2),
  }));
  const path = coords.map((c) => `${c.x},${c.y}`).join(" ");
  const first = coords[0]!;
  const last = coords[coords.length - 1]!;

  return (
    <View style={styles.chartWrap}>
      <Svg width="100%" height={CHART_H} viewBox={`0 0 ${CHART_W} ${CHART_H}`}>
        <Polyline
          points={path}
          fill="none"
          stroke={theme.colors.primary}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <Circle cx={first.x} cy={first.y} r={3} fill={theme.colors.mutedForeground} />
        <Circle cx={last.x} cy={last.y} r={4} fill={theme.colors.primary} />
      </Svg>
      <View style={styles.chartAxis}>
        <Text style={styles.chartAxisText}>{fmtDateMedium(points[0]!.date)}</Text>
        <Text style={styles.chartAxisText}>
          {fmtKg(min)}–{fmtKg(max)} kg
        </Text>
        <Text style={styles.chartAxisText}>{fmtDateMedium(points[points.length - 1]!.date)}</Text>
      </View>
    </View>
  );
}

const BEST_LABEL: Record<string, string> = {
  weightKg: "Beban terberat",
  oneRm: "e1RM terbaik",
  reps: "Reps terbanyak",
  setVolume: "Volume set terbaik",
};

/** Per-exercise history: PR bests, e1RM chart, and recent sessions. */
export default function LatihanGerakan() {
  const { theme } = useUnistyles();
  const gate = useSessionGate();
  const params = useLocalSearchParams<{ id: string }>();
  const exerciseId = params.id ?? "";
  const catalog = useQuery(orpc.workout.catalog.queryOptions());
  const history = useQuery(
    orpc.workout.exerciseHistory.queryOptions({ input: { exerciseId, limit: 50 }, enabled: exerciseId.length > 0 }),
  );

  if (gate === "loading") return null;
  const exercise = catalog.data?.exercises.find((e) => e.id === exerciseId);

  return (
    <>
      <Stack.Screen options={{ title: exercise?.name ?? "Riwayat gerakan" }} />
      <ScrollView contentContainerStyle={styles.content}>
        <Button
          variant="secondary"
          size="sm"
          label="Catat gerakan ini"
          icon="add"
          style={styles.startButton}
          onPress={() => {
            if (exercise) {
              setActiveWorkout({
                name: "",
                note: "",
                startedAt: Date.now(),
                exercises: [newExercise(exercise)],
              });
              router.push("/latihan/aktif");
            }
          }}
        />

        <SectionTitle title="Rekor terbaik" />
        <Card>
          {history.isPending ? (
            <Text style={styles.empty}>Memuat rekor…</Text>
          ) : history.isError ? (
            <Text style={styles.empty}>{errorMessage(history.error)}</Text>
          ) : (
            <View style={styles.bestGrid}>
              {Object.entries(history.data.best).map(([key, value]) => (
                <View key={key} style={styles.bestCell}>
                  <Num style={styles.bestValue}>
                    {value != null && value > 0
                      ? key === "reps"
                        ? `${Math.round(value)} reps`
                        : `${fmtKg(value)} kg`
                      : "–"}
                  </Num>
                  <Text style={styles.bestLabel}>{BEST_LABEL[key] ?? key}</Text>
                </View>
              ))}
              {Object.keys(history.data.best).length === 0 ? (
                <Text style={styles.empty}>Belum ada data.</Text>
              ) : null}
            </View>
          )}
        </Card>

        <SectionTitle title="Tren e1RM" />
        <Card>
          {history.data ? <OneRmChart points={history.data.oneRmByDate} /> : null}
        </Card>

        <SectionTitle title="Sesi sebelumnya" />
        {history.isPending ? (
          <Card><Text style={styles.empty}>Memuat riwayat…</Text></Card>
        ) : (history.data?.sessions.length ?? 0) === 0 ? (
          <EmptyState
            icon="barbell-outline"
            title="Belum pernah dicatat"
            description="Setelah kamu mencatat gerakan ini, riwayatnya muncul di sini."
          />
        ) : (
          <Card style={styles.sessionList}>
            {(history.data?.sessions ?? []).map((session) => (
              <View key={session.sessionId} style={styles.sessionRow}>
                <Text style={styles.sessionDate}>{fmtDateMedium(session.date)}</Text>
                <View style={styles.sessionSets}>
                  {session.sets.map((set, i) => (
                    <View key={i} style={styles.setTagRow}>
                      <Text style={styles.setTag}>
                        {set.setType === "normal" ? i + 1 : SET_TYPE_LABEL[set.setType as keyof typeof SET_TYPE_LABEL] ?? i + 1}
                      </Text>
                      <Text style={styles.setLabel}>{previousSetLabel(set)}</Text>
                    </View>
                  ))}
                </View>
              </View>
            ))}
          </Card>
        )}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  content: { padding: theme.spacing.lg, gap: theme.spacing.md },
  startButton: { alignSelf: "flex-start" },
  empty: { color: theme.colors.mutedForeground, fontSize: theme.fontSize.sm },
  bestGrid: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.md },
  bestCell: { minWidth: 130, gap: 2 },
  bestValue: { fontSize: theme.fontSize.md, fontWeight: "800", color: theme.colors.foreground },
  bestLabel: { fontSize: theme.fontSize.xs, color: theme.colors.mutedForeground },
  chartWrap: { gap: theme.spacing.sm },
  chartEmpty: { color: theme.colors.mutedForeground, fontSize: theme.fontSize.sm },
  chartAxis: { flexDirection: "row", justifyContent: "space-between" },
  chartAxisText: { fontSize: 10, color: theme.colors.mutedForeground },
  sessionList: { gap: 0 },
  sessionRow: {
    paddingVertical: theme.spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.hairline,
    gap: theme.spacing.sm,
  },
  sessionDate: { fontSize: theme.fontSize.sm, fontWeight: "700", color: theme.colors.foreground },
  sessionSets: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.sm },
  setTagRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.xs,
    backgroundColor: theme.colors.muted,
    borderRadius: theme.radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  setTag: { fontSize: theme.fontSize.xs, fontWeight: "800", color: theme.colors.mutedForeground },
  setLabel: { fontSize: theme.fontSize.xs, color: theme.colors.foreground },
}));
