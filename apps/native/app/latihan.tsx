import "@/unistyles";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { Redirect, Stack, router } from "expo-router";
import { Pressable, ScrollView, View } from "react-native";
import { useState } from "react";
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
import { errorMessage, fmtDateId, fmtKcal } from "@/utils/format";
import { orpc } from "@/utils/orpc";

type WorkoutStatus = Awaited<ReturnType<AppRouterClient["workout"]["status"]>>;

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

export default function Latihan() {
  const { theme } = useUnistyles();
  const gate = useSessionGate();
  const status = useQuery(orpc.workout.status.queryOptions({ input: {} }));
  const templates = useQuery(orpc.workout.templates.queryOptions());
  const last = useQuery(orpc.workout.lastSession.queryOptions());
  const history = useQuery(orpc.workout.listSessions.queryOptions({ input: { limit: 20 } }));
  const catalog = useQuery(orpc.workout.catalog.queryOptions());

  // draft !== null shows the editor; typed here as the built draft shape.
  const [draft, setDraft] = useState<SessionDraft | null>(null);
  const nameOf = (id: string) => catalog.data?.exercises.find((e) => e.id === id)?.name ?? id;

  if (gate === "loading") {
    return <BootLoader />;
  }
  if (gate === "anon") {
    return <Redirect href="/login" />;
  }

  const startDraft = (build: () => SessionDraft) => {
    setDraft(build());
    // Editor lives at the top: bring it into view after state settles.
    router.navigate("/latihan");
  };

  return (
    <>
      <Stack.Screen options={{ title: "Latihan Beban" }} />
      <Screen>
        <PageHeader
          title="Latihan Beban"
          caption="Turun berat tanpa kehilangan otot."
          right={
            draft === null ? (
              <Button
                variant="secondary"
                size="sm"
                label="Mulai"
                onPress={() =>
                  startDraft(() => ({ name: "", durationMin: "45", note: "", exercises: [] }))
                }
              />
            ) : undefined
          }
        />

        {draft !== null ? (
          <SessionEditor draft={draft} onClose={() => setDraft(null)} />
        ) : (
          <>
            <SectionTitle title="Mulai cepat" />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.quickRow}
            >
              {last.data ? (
                <Chip
                  label={`Ulangi: ${last.data.session.name}`}
                  onPress={() => startDraft(() => draftFromSession(last.data!, nameOf))}
                />
              ) : null}
              {(templates.data ?? []).map((template) => (
                <Chip
                  key={template.id}
                  label={template.name}
                  onPress={() =>
                    startDraft(() => {
                      const built = draftFromTemplate(template.id, templates.data ?? [], nameOf);
                      return (
                        built ?? { name: template.name, durationMin: "45", note: "", exercises: [] }
                      );
                    })
                  }
                />
              ))}
              <Chip
                label="Sesi kosong"
                onPress={() =>
                  startDraft(() => ({ name: "", durationMin: "45", note: "", exercises: [] }))
                }
              />
            </ScrollView>
          </>
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
                <View key={pr.exerciseId} style={styles.prRow}>
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
                  {pr.lastDate ? <Text style={styles.prDate}>{fmtDateId(pr.lastDate)}</Text> : null}
                </View>
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
            icon="barbell-outline"
            title="Belum ada sesi"
            description="Mulai dari template di atas. Dua-tiga sesi seminggu cukup buat jaga otot."
          />
        ) : (
          <Card style={styles.historyCard}>
            {history.data!.items.map((item) => (
              <Pressable
                key={item.session.id}
                accessibilityRole="button"
                accessibilityLabel={`Edit sesi ${item.session.name}`}
                onPress={() => startDraft(() => draftFromSession(item, nameOf))}
                style={({ pressed }) => [styles.historyRow, pressed && styles.pressed]}
              >
                <View style={styles.prText}>
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
                </View>
                <Ionicons name="pencil" size={15} color={theme.colors.mutedForeground} />
              </Pressable>
            ))}
          </Card>
        )}
      </Screen>
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  pressed: { opacity: 0.7 },
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
  prDate: { fontSize: theme.fontSize.xs, color: theme.colors.mutedForeground },
  historyCard: { gap: 0 },
  historyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    paddingVertical: theme.spacing.md,
  },
}));
