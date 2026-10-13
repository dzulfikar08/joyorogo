import { Ionicons } from "@expo/vector-icons";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
} from "expo-audio";
import { File } from "expo-file-system";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { MEALS, jakartaToday, storySlotLabel } from "@joyorogo/api/lib/engine";
import type { Meal } from "@joyorogo/api/lib/engine";

import { Button, Input, ListGroup, ListRow, Text } from "@/components/ui";
import { PlateFields } from "@/components/plate/plate-fields";
import type { PlateValues } from "@/components/plate/plate-fields";
import { errorMessage, fmtKcal, parseNum } from "@/utils/format";
import { isPaywallError, orpc, queryClient } from "@/utils/orpc";

/** One parsed story item as describeFood answers it: pinned to slot and day. */
type StoryItem = {
  name: string;
  portion?: string;
  grams?: number;
  kcal: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  fiber?: number;
  confidence?: number;
  matched?: boolean;
  meal: Meal;
  date: string;
};

export type CeritaPhase = "input" | "recording" | "working" | "review";

/** One minute covers a whole day of meals and keeps the upload near 1 MB. */
const MAX_RECORD_MS = 60_000;
/** Matches the server's audioBase64 floor; anything tinier never transcribes. */
const MIN_AUDIO_BASE64 = 1_332;

const MIC_DENIED =
  "Izin mikrofon ditolak. Ketik saja ceritamu, atau izinkan mikrofon di Pengaturan.";

function fmtClock(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Server errors carry user-facing copy; the transcript survives a failed parse. */
function errorParts(err: unknown): { message: string; transcript: string | null } {
  const message = errorMessage(err);
  const data = (err as { data?: { transcript?: unknown } } | null)?.data;
  return { message, transcript: typeof data?.transcript === "string" ? data.transcript : null };
}

/**
 * "Ceritakan": type or say what you ate, AI places each item on a meal slot
 * and day, the user checks the numbers, one tap saves everything.
 * `meal` pins stories without a meal word to the slot the sheet came from.
 */
export function Cerita({
  meal,
  date,
  slots,
  onPhaseChange,
  onSaved,
}: {
  meal?: Meal;
  date: string;
  slots: Meal[];
  onPhaseChange?: (phase: CeritaPhase) => void;
  onSaved: (result: { count: number; dates: string[] }) => void;
}) {
  const { theme } = useUnistyles();
  const router = useRouter();
  const [phase, setPhaseState] = useState<CeritaPhase>("input");
  // This story used the last free scan of today → paywall after the save.
  const [quotaReached, setQuotaReached] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState("");
  const [items, setItems] = useState<StoryItem[]>([]);
  const [kcals, setKcals] = useState<string[]>([]);
  // Per-group plate fields, keyed by `${date}-${meal}` like the review groups.
  const [plates, setPlates] = useState<Record<string, PlateValues>>({});
  const [saving, setSaving] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  // The working phase shows a different line for a voice note vs typed text.
  const [listening, setListening] = useState(false);

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const discardRef = useRef(false);
  const stoppingRef = useRef(false);
  // Bumped on cancel so a slow answer can never jump the UI back to review.
  const runRef = useRef(0);

  const describe = useMutation(orpc.ai.describeFood.mutationOptions());
  const addFood = useMutation(orpc.food.add.mutationOptions());
  const logCorrections = useMutation(orpc.ai.logCorrections.mutationOptions());

  const setPhase = (next: CeritaPhase) => {
    setPhaseState(next);
    onPhaseChange?.(next);
  };

  // Release the mic and audio focus when the hosting sheet unmounts.
  useEffect(
    () => () => {
      discardRef.current = true;
      runRef.current += 1;
      void recorder.stop().catch(() => {});
      void setAudioModeAsync({ allowsRecording: false }).catch(() => {});
    },
    [recorder],
  );

  const finishRecording = async () => {
    if (stoppingRef.current) return;
    stoppingRef.current = true;
    try {
      try {
        await recorder.stop();
        await setAudioModeAsync({ allowsRecording: false });
      } catch {
        setError("Rekaman gagal dihentikan. Coba lagi.");
        setPhase("input");
        return;
      }
      const uri = recorder.uri;
      const discarded = discardRef.current;
      if (uri) {
        try {
          const file = new File(uri);
          if (discarded) {
            file.delete();
            setPhase("input");
          } else {
            const audioBase64 = await file.base64();
            file.delete();
            if (audioBase64.length < MIN_AUDIO_BASE64) {
              setError("Rekamannya terlalu pendek. Tekan mikrofon, ceritakan, lalu tekan Selesai.");
              setPhase("input");
            } else {
              await runDescribe({ audioBase64 }, true);
            }
          }
        } catch {
          setError("Rekaman gagal diproses. Coba lagi.");
          setPhase("input");
        }
      } else if (!discarded) {
        setError("Rekaman gagal. Coba lagi.");
        setPhase("input");
      } else {
        setPhase("input");
      }
    } finally {
      stoppingRef.current = false;
      discardRef.current = false;
    }
  };

  const finishRef = useRef(finishRecording);
  finishRef.current = finishRecording;

  useEffect(() => {
    if (phase !== "recording") return;
    const startedAt = Date.now();
    setElapsed(0);
    const timer = setInterval(() => {
      const ms = Date.now() - startedAt;
      setElapsed(ms);
      if (ms >= MAX_RECORD_MS) void finishRef.current();
    }, 250);
    return () => clearInterval(timer);
  }, [phase]);

  const runDescribe = async (
    input: { text: string } | { audioBase64: string },
    fromAudio: boolean,
  ) => {
    const run = ++runRef.current;
    setError(null);
    setListening(fromAudio);
    setPhase("working");
    try {
      const result = await describe.mutateAsync({
        ...input,
        ...(meal ? { meal } : {}),
        date,
        slots,
      });
      if (run !== runRef.current) return;
      setTranscript(result.transcript);
      setText(result.transcript);
      setItems(result.items);
      setKcals(result.items.map((item) => String(Math.round(item.kcal))));
      setPlates({});
      setQuotaReached(result.quotaReached);
      setPhase("review");
    } catch (err) {
      if (run !== runRef.current) return;
      // Out of free scans: paywall on top of the sheet, not an error line.
      if (isPaywallError(err)) {
        router.push({ pathname: "/founder", params: { from: "quota", next: "/makan" } });
        setPhase("input");
        return;
      }
      const parts = errorParts(err);
      // What Whisper heard lands in the box so the user can fix it.
      if (parts.transcript) setText(parts.transcript);
      setError(parts.message);
      setPhase("input");
    }
  };

  const startRecording = async () => {
    setError(null);
    let granted = false;
    try {
      granted = (await requestRecordingPermissionsAsync()).granted;
    } catch {
      granted = false;
    }
    if (!granted) {
      setError(MIC_DENIED);
      return;
    }
    try {
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      discardRef.current = false;
      stoppingRef.current = false;
      // Each take needs a fresh prepared file; stop() finalizes the previous one.
      await recorder.prepareToRecordAsync();
      recorder.record();
      setPhase("recording");
    } catch {
      void setAudioModeAsync({ allowsRecording: false }).catch(() => {});
      setError("Rekaman tidak bisa dimulai. Coba lagi.");
    }
  };

  const stopRecording = (discard: boolean) => {
    discardRef.current = discard;
    void finishRef.current();
  };

  const cancelDescribe = () => {
    runRef.current += 1;
    describe.reset();
    setPhase("input");
  };

  const submitText = () => {
    const clean = text.trim();
    if (clean.length < 2) {
      setError("Tulis dulu makanannya, misalnya: nasi goreng 1 piring.");
      return;
    }
    void runDescribe({ text: clean }, false);
  };

  const backToInput = () => {
    setItems([]);
    setKcals([]);
    setPlates({});
    setPhase("input");
  };

  const remove = (index: number) => {
    const nextItems = items.filter((_, i) => i !== index);
    setItems(nextItems);
    setKcals((current) => current.filter((_, i) => i !== index));
    if (nextItems.length === 0) backToInput();
  };

  const saveAll = async () => {
    const values = kcals.map((value) => parseNum(value));
    const invalid = values.findIndex((value) => value === null || value < 0);
    if (invalid !== -1) {
      setError(`Kalori untuk "${items[invalid]?.name}" belum valid.`);
      return;
    }
    setSaving(true);
    setError(null);
    let saved = 0;
    // First row of each date+meal group creates the plate; the rest follow it.
    const plateIds: Record<string, string | undefined> = {};
    const groupKey = (item: StoryItem) => `${item.date}-${MEALS.indexOf(item.meal)}`;
    try {
      for (const [index, item] of items.entries()) {
        const key = groupKey(item);
        const existing = plateIds[key];
        let plate: { name?: string; place?: string; priceIdr?: number } | undefined;
        if (!existing) {
          const plateVals = plates[key];
          if (plateVals) {
            const name = plateVals.name.trim();
            const place = plateVals.place.trim();
            const priceNum = parseNum(plateVals.price);
            const priceIdr =
              plateVals.price.trim() !== "" && priceNum !== null && priceNum >= 0
                ? Math.round(priceNum)
                : null;
            // Pass a plate only when the price is filled or the name was edited.
            if (priceIdr !== null || (name !== "" && name !== item.name)) {
              plate = {
                ...(name !== "" ? { name } : {}),
                ...(place !== "" ? { place } : {}),
                ...(priceIdr !== null ? { priceIdr } : {}),
              };
            }
          }
        }
        const savedRow = await addFood.mutateAsync({
          date: item.date,
          meal: item.meal,
          name: item.name,
          kcal: values[index] ?? 0,
          protein: item.protein,
          carbs: item.carbs,
          fat: item.fat,
          fiber: item.fiber,
          source: "ai",
          ...(existing ? { plateId: existing } : plate ? { plate } : {}),
        });
        if (!existing && savedRow?.plateId) plateIds[key] = savedRow.plateId;
        saved += 1;
      }
      // Miss log: AI estimate vs what the user kept. Never blocks the save.
      void logCorrections
        .mutateAsync({
          source: "native",
          items: items.map((item, index) => ({
            meal: item.meal,
            dishName: item.name,
            aiKcal: Math.round(item.kcal),
            savedKcal: values[index] ?? 0,
            aiGrams: item.grams ?? null,
            aiConfidence: item.confidence ?? null,
          })),
        })
        .catch(() => {});
      queryClient.invalidateQueries();
      const dates: string[] = [];
      for (const item of items) {
        if (!dates.includes(item.date)) dates.push(item.date);
      }
      dates.sort();
      setItems([]);
      setKcals([]);
      setPlates({});
      setPhase("input");
      onSaved({ count: saved, dates });
      // The saved story stays in the diary; paywall follows the sheet close
      // when this story used the last free scan of today.
      if (quotaReached) {
        router.push({ pathname: "/founder", params: { from: "quota", next: "/makan" } });
      }
    } catch (err) {
      setError(errorMessage(err));
      // Keep only what did not make it, so a retry never double-logs.
      setItems((current) => current.slice(saved));
      setKcals((current) => current.slice(saved));
    } finally {
      setSaving(false);
    }
  };

  if (phase === "working") {
    return (
      <View style={styles.workingBox}>
        <View style={styles.workingRow}>
          <ActivityIndicator size="small" color={theme.colors.primary} />
          <View style={styles.workingText}>
            <Text style={styles.workingTitle}>
              {listening ? "Mendengarkan rekaman…" : "AI menghitung kalori…"}
            </Text>
            <Text style={styles.workingHint}>Biasanya 2 sampai 6 detik.</Text>
          </View>
          <Button variant="ghost" size="sm" label="Batalkan" onPress={cancelDescribe} />
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    );
  }

  if (phase === "review") {
    const today = jakartaToday();
    const order = (item: StoryItem) => `${item.date}-${MEALS.indexOf(item.meal)}`;
    const indexed = items.map((item, index) => ({ item, index }));
    const keys: string[] = [];
    for (const { item } of indexed) {
      const key = order(item);
      if (!keys.includes(key)) keys.push(key);
    }
    keys.sort();
    const groups = keys.map((key) => indexed.filter(({ item }) => order(item) === key));
    const total = kcals.reduce((sum, value) => sum + (parseNum(value) ?? 0), 0);
    return (
      <View style={styles.reviewGap}>
        <View style={styles.saidBox}>
          <Text style={styles.saidLabel}>Kamu bilang</Text>
          <Text style={styles.saidText}>{transcript}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Ubah cerita"
            disabled={saving}
            onPress={backToInput}
            style={({ pressed }) => [styles.saidEdit, pressed && styles.pressedSoft]}
          >
            <Text style={styles.saidEditText}>Ubah</Text>
          </Pressable>
        </View>

        {groups.map((group, groupIndex) => {
          const first = group[0]?.item;
          if (!first) return null;
          const label = storySlotLabel(first.date, first.meal, today);
          const key = keys[groupIndex];
          return (
            <View key={label} style={styles.groupGap}>
              <Text style={styles.groupLabel}>{label}</Text>
              <ListGroup>
                {group.map(({ item, index }) => (
                  <ListRow
                    key={`${item.name}-${index}`}
                    title={item.name}
                    subtitle={
                      [item.portion, item.grams != null ? `± ${fmtKcal(item.grams)} g` : null]
                        .filter(Boolean)
                        .join(" · ") || "1 porsi"
                    }
                    right={
                      <View style={styles.kcalEdit}>
                        <Input
                          value={kcals[index] ?? ""}
                          onChangeText={(value) =>
                            setKcals((current) => current.map((v, i) => (i === index ? value : v)))
                          }
                          keyboardType="number-pad"
                          maxLength={6}
                          accessibilityLabel={`Kalori ${item.name}`}
                          style={styles.kcalInput}
                        />
                        <Text style={styles.kcalUnit}>kcal</Text>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Hapus ${item.name}`}
                          disabled={saving}
                          onPress={() => remove(index)}
                          style={({ pressed }) => [styles.remove, pressed && styles.pressedSoft]}
                        >
                          <Ionicons name="close" size={20} color={theme.colors.mutedForeground} />
                        </Pressable>
                      </View>
                    }
                  />
                ))}
              </ListGroup>
              <PlateFields
                title={`Piring: ${label}`}
                priceLabel="Harga piring ini (Rp)"
                values={
                  plates[key] ?? {
                    name: group[0]?.item.name ?? "",
                    place: "",
                    price: "",
                  }
                }
                onChange={(next) => setPlates((current) => ({ ...current, [key]: next }))}
              />
            </View>
          );
        })}

        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Total</Text>
          <Text style={styles.totalValue}>
            {fmtKcal(total)} <Text style={styles.totalUnit}>kcal</Text>
          </Text>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Button
          label={`Simpan ${items.length} makanan`}
          onPress={() => void saveAll()}
          disabled={items.length === 0}
          loading={saving}
        />
        <Button variant="secondary" label="Ubah cerita" onPress={backToInput} disabled={saving} />
      </View>
    );
  }

  const recording = phase === "recording";
  return (
    <View style={styles.inputGap}>
      {recording ? (
        <View style={styles.recordPanel} accessibilityLiveRegion="polite">
          <View style={styles.recordRow}>
            <Ionicons name="mic" size={18} color={theme.colors.destructive} />
            <Text style={styles.recordClock}>Merekam {fmtClock(elapsed)}</Text>
          </View>
          <Text style={styles.recordHint}>
            Sebut makanan, porsi, dan waktunya. Maksimal 1 menit.
          </Text>
        </View>
      ) : (
        <Input
          value={text}
          onChangeText={setText}
          multiline
          maxLength={1000}
          placeholder={
            meal
              ? "Contoh: mie gacoan 1 porsi, udang keju 3 pcs"
              : "Contoh: kemarin pagi nasi kuning pakai telur dadar, siang nasi padang lauk rendang"
          }
          accessibilityLabel="Ceritakan makananmu"
          style={styles.textArea}
        />
      )}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {recording ? (
        <View style={styles.actionRow}>
          <Button
            variant="secondary"
            label="Batal"
            onPress={() => stopRecording(true)}
            style={styles.grow}
          />
          <Button label="Selesai" onPress={() => stopRecording(false)} style={styles.grow} />
        </View>
      ) : (
        <View style={styles.actionRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Rekam suara"
            onPress={() => void startRecording()}
            style={({ pressed }) => [styles.micButton, pressed && styles.pressedSoft]}
          >
            <Ionicons name="mic" size={20} color={theme.colors.primary} />
          </Pressable>
          <Button label="Hitung kalori" onPress={submitText} style={styles.grow} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  pressedSoft: {
    opacity: 0.7,
  },
  inputGap: {
    gap: theme.spacing.md,
  },
  textArea: {
    minHeight: 112,
    textAlignVertical: "top",
    paddingTop: 12,
    paddingBottom: 12,
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
  },
  grow: {
    flex: 1,
  },
  micButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: theme.colors.muted,
    alignItems: "center",
    justifyContent: "center",
  },
  recordPanel: {
    backgroundColor: theme.colors.muted,
    borderRadius: theme.radius.card,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.lg,
    gap: theme.spacing.xs,
    minHeight: 112,
    alignItems: "center",
    justifyContent: "center",
  },
  recordRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
  },
  recordClock: {
    fontSize: theme.fontSize.base,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  recordHint: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.mutedForeground,
    textAlign: "center",
  },
  workingBox: {
    backgroundColor: theme.colors.muted,
    borderRadius: theme.radius.card,
    padding: theme.spacing.lg,
    gap: theme.spacing.sm,
  },
  workingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
  },
  workingText: {
    flex: 1,
    gap: 2,
  },
  workingTitle: {
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  workingHint: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.mutedForeground,
  },
  reviewGap: {
    gap: theme.spacing.md,
  },
  saidBox: {
    backgroundColor: theme.colors.muted,
    borderRadius: theme.radius.card,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    gap: 2,
  },
  saidLabel: {
    fontSize: theme.fontSize.xs,
    fontWeight: "600",
    color: theme.colors.mutedForeground,
  },
  saidText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
  },
  saidEdit: {
    alignSelf: "flex-start",
    minHeight: 44,
    justifyContent: "center",
    marginTop: theme.spacing.xs,
  },
  saidEditText: {
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
    color: theme.colors.primary,
  },
  groupGap: {
    gap: theme.spacing.sm,
  },
  groupLabel: {
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
    color: theme.colors.foreground,
    paddingHorizontal: theme.spacing.xs,
  },
  kcalEdit: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  kcalInput: {
    width: 84,
    minHeight: 44,
    paddingHorizontal: 12,
    textAlign: "right",
  },
  kcalUnit: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.mutedForeground,
  },
  remove: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    marginRight: -12,
  },
  totalRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    paddingHorizontal: theme.spacing.xs,
  },
  totalLabel: {
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    color: theme.colors.mutedForeground,
  },
  totalValue: {
    fontSize: theme.fontSize.lg,
    fontWeight: "800",
    color: theme.colors.foreground,
  },
  totalUnit: {
    fontSize: theme.fontSize.xs,
    fontWeight: "600",
    color: theme.colors.mutedForeground,
  },
  error: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.destructive,
  },
}));
