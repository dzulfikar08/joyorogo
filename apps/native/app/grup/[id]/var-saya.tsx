import "@/unistyles";
import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as ImagePicker from "expo-image-picker";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { File, Paths } from "expo-file-system";
import { Redirect, Stack, useLocalSearchParams, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  Switch,
  View,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { SafeAreaView } from "react-native-safe-area-context";
import { Circle, Ellipse, Line, Svg } from "react-native-svg";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { BootLoader, Button, Card, Input, Text } from "@/components/ui";
import { useToast } from "@/components/toast";
import { authClient } from "@/lib/auth-client";
import { useSessionGate } from "@/lib/use-session-gate";
import type { VarHistory } from "@/src/lib/group";
import { errorMessage } from "@/utils/format";
import { client, isPaywallError, orpc } from "@/utils/orpc";
import { undoLabel, useDelayedDelete, useOptimisticMutation } from "@/lib/optimistic";

type VarVerdict = VarHistory["scans"][number]["verdict"];
type VarScanRow = VarHistory["scans"][number];

const TIMER_SECONDS = 3;
const MAX_SIDE = 1024;

const CAPTURE_TIPS = [
  "Pose dan jarak yang sama tiap scan",
  "Cahaya terang, kamera sejajar perut",
  "Berdiri tegak, napas biasa",
];

function verdictCopy(verdict: VarVerdict): { icon: string; label: string; color: string } {
  switch (verdict) {
    case "turun":
      return { icon: "checkmark-circle", label: "Perut mengecil", color: "#3DDB84" };
    case "naik":
      return { icon: "alert-circle", label: "Terlihat lebih penuh", color: "#FFD84D" };
    case "sama":
      return { icon: "remove-circle", label: "Belum kelihatan beda", color: "#C9C4BA" };
    case "beda":
      return { icon: "refresh-circle", label: "Kondisi foto beda, ulangi", color: "#FF6A52" };
    case "pertama":
      return { icon: "information-circle", label: "Scan pertama tersimpan", color: "#C9C4BA" };
  }
}

/** "Sen, 12 Okt" — tanggal pendek untuk caption foto dan baris riwayat. */
function dayLabel(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("id-ID", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/**
 * Foto VAR privat lewat /var-photo/:id — server hanya melayani sesi pemilik,
 * jadi di native fotonya diunduh dengan cookie sesi (pola AuthedPhoto).
 */
function AuthedVarPhoto({
  photoUrl,
  label,
  style,
}: {
  photoUrl: string;
  label: string;
  style: object;
}) {
  const { theme } = useUnistyles();
  const [uri, setUri] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setUri(null);
    setFailed(false);
    if (Platform.OS === "web") {
      setUri(photoUrl);
      return;
    }
    void (async () => {
      try {
        const headers: Record<string, string> = {};
        const cookie = await authClient.getCookie();
        if (cookie) headers.Cookie = cookie;
        const file = await File.downloadFileAsync(
          photoUrl,
          new File(Paths.cache, `joyorogo-var-${photoUrl.split("/").pop() ?? "scan"}.jpg`),
          { headers, idempotent: true },
        );
        if (!cancelled) setUri(file.uri);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [photoUrl]);

  if (failed) {
    return (
      <View style={[style, styles.photoMissing]}>
        <Ionicons name="image-outline" size={20} color={theme.colors.mutedForeground} />
      </View>
    );
  }
  if (uri === null) {
    return (
      <View style={[style, styles.photoMissing]}>
        <ActivityIndicator size="small" color={theme.colors.mutedForeground} />
      </View>
    );
  }
  return <Image source={{ uri }} style={style} accessibilityLabel={label} />;
}

/** Overlay jendela bidik: perut di dalam elips putus-putus, ponsel sejajar dada. */
function Silhouette() {
  return (
    <Svg style={StyleSheet.absoluteFill} viewBox="0 0 100 133" preserveAspectRatio="xMidYMid slice">
      <Ellipse cx="50" cy="72" rx="30" ry="26" fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="0.8" strokeDasharray="4 3" />
      <Line x1="50" y1="18" x2="50" y2="28" stroke="rgba(255,255,255,0.6)" strokeWidth="0.8" />
      <Line x1="46" y1="23" x2="54" y2="23" stroke="rgba(255,255,255,0.6)" strokeWidth="0.8" />
      <Circle cx="50" cy="72" r="0.1" fill="transparent" />
    </Svg>
  );
}

export default function VarSaya() {
  const { theme } = useUnistyles();
  const gate = useSessionGate();
  const router = useRouter();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const groupId = Array.isArray(id) ? (id[0] ?? "") : (id ?? "");

  const [permission, requestPermission] = useCameraPermissions();
  const history = useQuery(orpc.group.varHistory.queryOptions({ input: { groupId } }));
  const [view, setView] = useState<"capture" | "result">("capture");
  const [timerOn, setTimerOn] = useState(true);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [flowError, setFlowError] = useState<string | null>(null);
  const cameraRef = useRef<CameraView>(null);
  const countdownRef = useRef<number | null>(null);

  const scans = history.data?.scans ?? [];
  const latestWaist = history.data?.latestWaist ?? null;
  const shareVar = history.data?.shareVar ?? false;

  const analyze = useMutation(
    orpc.group.varAnalyze.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: orpc.group.key() });
        setPreviewUri(null);
        setView("result");
      },
      onError: (e) => {
        setPreviewUri(null);
        setFlowError(errorMessage(e));
      },
    }),
  );

  const setShare = useOptimisticMutation<
    { groupId: string; shareVar: boolean },
    unknown,
    boolean | undefined
  >({
    mutationFn: (input) => client.group.varSetShare(input),
    patch: (input, cache) => {
      const key = orpc.group.varHistory.queryOptions({ input: { groupId } }).queryKey;
      const previous = queryClient.getQueryData<{ shareVar?: boolean }>(key)?.shareVar;
      cache.value<{ shareVar?: boolean }>(key, (old) =>
        old === undefined ? undefined : { ...old, shareVar: input.shareVar },
      );
      return previous;
    },
    success: (_input, _data, previous) => ({
      message: "Pengaturan grup disimpan",
      undo: previous === undefined ? undefined : () => setShare.mutate({ groupId, shareVar: previous }),
    }),
    onError: (e) => toast.error("Gagal mengubah bagikan", errorMessage(e)),
    invalidate: () => [orpc.group.key()],
  });

  type VarScanRow = NonNullable<
    NonNullable<typeof history.data>["scans"]
  >[number];

  const removeScan = useDelayedDelete<VarScanRow>({
    remove: (row) => client.group.varDelete({ id: row.id }),
    patch: (row, cache) => {
      const key = orpc.group.varHistory.queryOptions({ input: { groupId } }).queryKey;
      cache.value<{ scans?: VarScanRow[] }>(key, (old) =>
        old === undefined
          ? undefined
          : { ...old, scans: (old.scans ?? []).filter((scan) => scan.id !== row.id) },
      );
    },
    label: (row) => `Scan ${row.date}`,
    fallback: "Scan",
    invalidate: () => [orpc.group.key()],
  });

  // Hitung ulang: the server re-runs the AI on the stored photo pair and
  // overwrites this scan's verdict (free, capped per scan). A failure leaves
  // the previous verdict untouched; undo puts it back, shared status included.
  const retryScan = useMutation({
    mutationFn: (input: { id: string; hint?: string }) => client.group.varRetry(input),
    onSuccess: ({ scan, previous }) => {
      void queryClient.invalidateQueries({ queryKey: orpc.group.key() });
      toast.success(`Hasil baru: ${verdictCopy(scan.verdict).label}`, undefined, {
        label: undoLabel(),
        onPress: () => {
          const key = orpc.group.varHistory.queryOptions({ input: { groupId } }).queryKey;
          queryClient.setQueryData<VarHistory>(key, (old) =>
            old
              ? {
                  ...old,
                  scans: old.scans.map((row) => (row.id === scan.id ? { ...row, ...previous } : row)),
                }
              : old,
          );
          void client.group
            .varRestore({ id: scan.id, ...previous })
            .catch((e: unknown) => toast.error("Gagal mengembalikan hasil", errorMessage(e)))
            .finally(() => void queryClient.invalidateQueries({ queryKey: orpc.group.key() }));
        },
      });
    },
    onError: (e) => toast.error("Hasil sebelumnya tetap dipakai", errorMessage(e)),
  });

  // Timer yang tertinggal di layar tidak boleh menembak saat sudah pindah view.
  useEffect(
    () => () => {
      clearInterval(countdownRef.current);
    },
    [],
  );

  const stopCountdown = () => {
    clearInterval(countdownRef.current);
    countdownRef.current = null;
    setCountdown(null);
  };

  const submit = async (photoUri: string, width: number, height: number) => {
    setFlowError(null);
    setPreviewUri(photoUri);
    try {
      // Satu resize + satu encode JPEG, senada alur scan makanan.
      let context = ImageManipulator.manipulate(photoUri);
      if (Math.max(width, height) > MAX_SIDE) {
        context =
          height >= width
            ? context.resize({ height: MAX_SIDE })
            : context.resize({ width: MAX_SIDE });
      }
      const rendered = await context.renderAsync();
      const saved = await rendered.saveAsync({
        compress: 0.75,
        format: SaveFormat.JPEG,
        base64: true,
      });
      if (!saved.base64) {
        setFlowError("Gagal memproses foto. Coba lagi.");
        setPreviewUri(null);
        return;
      }
      await analyze.mutateAsync({
        groupId,
        imageBase64: saved.base64,
        mimeType: "image/jpeg",
      });
    } catch (e) {
      setPreviewUri(null);
      if (isPaywallError(e)) {
        router.replace({ pathname: "/founder", params: { from: "quota" } });
        return;
      }
      setFlowError(errorMessage(e));
    }
  };

  const countdownAndShoot = () => {
    if (countdown !== null || analyze.isPending) return;
    let left = TIMER_SECONDS;
    setCountdown(left);
    countdownRef.current = setInterval(() => {
      left -= 1;
      if (left <= 0) {
        stopCountdown();
        void shoot();
      } else {
        setCountdown(left);
      }
    }, 1000);
  };

  const shoot = async () => {
    try {
      const photo = await cameraRef.current?.takePictureAsync({ quality: 1 });
      if (!photo?.uri) {
        setFlowError("Gagal mengambil foto. Coba lagi.");
        return;
      }
      await submit(photo.uri, photo.width, photo.height);
    } catch (e) {
      setFlowError(errorMessage(e));
    }
  };

  const pickFromGallery = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 1,
        exif: false,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset) return;
      await submit(asset.uri, asset.width, asset.height);
    } catch (e) {
      setFlowError(errorMessage(e));
    }
  };

  if (gate === "loading" || permission === null) {
    return <BootLoader />;
  }
  if (gate === "anon") {
    return <Redirect href="/login" />;
  }

  const newest = scans.at(-1) ?? null;
  const busy = analyze.isPending;
  const cameraReady = permission.granted;

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: "VAR Perut" }} />
      <StatusBar style="dark" />
      <SafeAreaView style={styles.safe} edges={["bottom"]}>
        {view === "capture" ? (
          <>
            {/* --- Viewfinder terpandu --- */}
            <View style={styles.finderWrap}>
              {cameraReady ? (
                <View style={styles.finder}>
                  <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" />
                  <Silhouette />
                  <Text style={styles.finderHint}>Perutmu di dalam garis putus-putus</Text>
                  {countdown !== null ? (
                    <View style={styles.countdownLayer}>
                      <Text style={styles.countdownText}>{countdown}</Text>
                    </View>
                  ) : null}
                  {previewUri ? (
                    <Image source={{ uri: previewUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                  ) : null}
                  {busy ? (
                    <View style={styles.analyzingLayer}>
                      <Ionicons name="sparkles" size={26} color="#78FFB4" />
                      <Text style={styles.analyzingTitle}>
                        {scans.length > 0
                          ? "AI membandingkan dengan scan sebelumnya…"
                          : "Menyimpan scan pertamamu…"}
                      </Text>
                      <Text style={styles.analyzingHint}>
                        Biasanya 5-20 detik. Foto cuma tersimpan untukmu.
                      </Text>
                    </View>
                  ) : null}
                </View>
              ) : (
                <View style={styles.finder}>
                  <Text style={styles.permissionText}>
                    Izin kamera belum ada — pakai galeri, atau beri izin kamera dulu.
                  </Text>
                  <Button
                    size="sm"
                    variant="secondary"
                    label="Beri Izin Kamera"
                    onPress={() => void requestPermission()}
                  />
                </View>
              )}
            </View>

            {/* --- Tips + kontrol jepret --- */}
            <Card style={styles.tipsCard}>
              {CAPTURE_TIPS.map((tip) => (
                <View key={tip} style={styles.tipRow}>
                  <Ionicons name="bulb-outline" size={14} color={theme.colors.mutedForeground} />
                  <Text style={styles.tipText}>{tip}</Text>
                </View>
              ))}
              <View style={styles.shutterRow}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={timerOn ? `Matikan timer ${TIMER_SECONDS} detik` : `Nyalakan timer ${TIMER_SECONDS} detik`}
                  accessibilityState={{ selected: timerOn }}
                  onPress={() => setTimerOn((on) => !on)}
                  style={({ pressed }) => [styles.timerChip, timerOn && styles.timerChipOn, pressed && styles.pressedSoft]}
                >
                  <Ionicons name="timer-outline" size={15} color={timerOn ? theme.colors.primary : theme.colors.mutedForeground} />
                  <Text style={[styles.timerText, timerOn && { color: theme.colors.primary }]}>
                    Timer {TIMER_SECONDS} dtk
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Ambil foto perut"
                  disabled={busy || countdown !== null || !cameraReady}
                  onPress={timerOn ? countdownAndShoot : () => void shoot()}
                  style={({ pressed }) => [
                    styles.shutterOuter,
                    (busy || countdown !== null || !cameraReady) && styles.disabled,
                    pressed && styles.pressedSoft,
                  ]}
                >
                  <View style={styles.shutter}>
                    {busy ? <ActivityIndicator color="#FFFFFF" /> : null}
                  </View>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Pilih dari galeri"
                  disabled={busy}
                  onPress={() => void pickFromGallery()}
                  style={({ pressed }) => [styles.timerChip, busy && styles.disabled, pressed && styles.pressedSoft]}
                >
                  <Ionicons name="images-outline" size={15} color={theme.colors.mutedForeground} />
                  <Text style={styles.timerText}>Galeri</Text>
                </Pressable>
              </View>
              <Text style={styles.privacyNote}>
                Foto perutmu privat: tidak masuk feed, cuma kamu yang bisa buka.
                {scans.length > 0 ? ` ${scans.length} scan tersimpan.` : " Scan pertama jadi pembanding awal."}
              </Text>
              {flowError ? <Text style={styles.flowError}>{flowError}</Text> : null}
            </Card>
          </>
        ) : (
          <>
            {/* --- Hasil: verdict + perbandingan --- */}
            {newest ? (
              <KeyboardAwareScrollView
                style={styles.resultScroll}
                contentContainerStyle={styles.resultContent}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                <ResultView
                  scans={scans}
                  shareVar={shareVar}
                  latestWaist={latestWaist}
                  onShare={(value) => setShare.mutate({ groupId, shareVar: value })}
                  sharePending={setShare.isPending}
                  onDelete={(scanId) => {
                    const scan = scans.find((row) => row.id === scanId);
                    if (scan) removeScan(scan);
                  }}
                  onRescan={() => setView("capture")}
                  onRetry={(scanId, hint, onDone) =>
                    retryScan.mutate({ id: scanId, hint }, { onSuccess: onDone })
                  }
                  retrying={retryScan.isPending}
                />
              </KeyboardAwareScrollView>
            ) : (
              <View style={styles.emptyWrap}>
                <Button label="Scan pertama" icon="scan" onPress={() => setView("capture")} />
              </View>
            )}
          </>
        )}
      </SafeAreaView>
    </>
  );
}

function ResultView({
  scans,
  shareVar,
  latestWaist,
  onShare,
  sharePending,
  onDelete,
  onRescan,
  onRetry,
  retrying,
}: {
  scans: VarScanRow[];
  shareVar: boolean;
  latestWaist: VarHistory["latestWaist"];
  onShare: (value: boolean) => void;
  sharePending: boolean;
  onDelete: (scanId: string) => void;
  onRescan: () => void;
  onRetry: (scanId: string, hint: string | undefined, onDone: () => void) => void;
  retrying: boolean;
}) {
  const { theme } = useUnistyles();
  const [retryHint, setRetryHint] = useState("");
  const newest = scans.at(-1)!;
  const previous = scans.at(-2) ?? null;
  const verdict = verdictCopy(newest.verdict);

  return (
    <>
      <Card style={styles.resultCard}>
        <View style={styles.verdictHead}>
          <Ionicons name={verdict.icon as never} size={22} color={verdict.color} />
          <Text style={[styles.verdictTitle, { color: verdict.color }]}>{verdict.label}</Text>
        </View>
        {newest.verdict !== "pertama" && newest.confidence !== null ? (
          <>
            <View style={styles.confidenceTrack}>
              <View style={[styles.confidenceFill, { width: `${Math.round((newest.confidence ?? 0) * 100)}%` }]} />
            </View>
            <Text style={styles.confidenceText}>
              Keyakinan visual ~{Math.round((newest.confidence ?? 0) * 100)}% — perkiraan dari foto, bukan pengukuran.
            </Text>
          </>
        ) : null}
        {newest.note ? <Text style={styles.noteText}>{newest.note}</Text> : null}

        <View style={styles.compareRow}>
          <View style={styles.compareCell}>
            {previous ? (
              <AuthedVarPhoto
                photoUrl={previous.photoUrl}
                label={`Foto perut ${dayLabel(previous.date)}`}
                style={styles.comparePhoto}
              />
            ) : (
              <View style={[styles.comparePhoto, styles.photoMissing]}>
                <Text style={styles.photoMissingText}>Belum ada</Text>
              </View>
            )}
            <Text style={styles.compareCaption}>
              Sebelumnya{previous ? ` · ${dayLabel(previous.date)}` : ""}
            </Text>
          </View>
          <View style={styles.compareCell}>
            <AuthedVarPhoto
              photoUrl={newest.photoUrl}
              label={`Foto perut ${dayLabel(newest.date)}`}
              style={styles.comparePhotoHighlight}
            />
            <Text style={styles.compareCaption}>Sekarang · {dayLabel(newest.date)}</Text>
          </View>
        </View>
        {retrying ? (
          <View style={styles.retryOverlay} accessibilityRole="progressbar" accessibilityLabel="Menghitung ulang">
            <ActivityIndicator color={theme.colors.primary} />
            <Text style={styles.retryOverlayText}>AI membaca ulang kedua foto...</Text>
          </View>
        ) : null}
      </Card>

      {/* Hitung ulang: foto yang sama, gratis, dibatasi per scan */}
      {previous ? (
        <Card style={styles.resultCard}>
          <View style={styles.retryHead}>
            <Text style={styles.shareTitle}>Hasilnya kurang pas?</Text>
            <Text style={styles.shareHint}>
              {newest.retriesLeft > 0 ? `Gratis, sisa ${newest.retriesLeft}x` : "Batas habis"}
            </Text>
          </View>
          <Text style={styles.shareHint}>
            AI membandingkan ulang kedua foto yang sama, tanpa foto ulang dan tanpa memakai kuota scan
            harian.{shareVar ? " Status yang dibagikan ke grup ikut diperbarui." : ""}
          </Text>
          {newest.retriesLeft > 0 ? (
            <>
              <Input
                value={retryHint}
                onChangeText={setRetryHint}
                placeholder="Koreksi singkat (opsional), mis. pose sebenarnya sama"
                maxLength={200}
                editable={!retrying}
              />
              <Button
                variant="secondary"
                icon="refresh"
                label={retrying ? "Menghitung ulang..." : "Hitung ulang"}
                loading={retrying}
                disabled={retrying}
                onPress={() => onRetry(newest.id, retryHint.trim() || undefined, () => setRetryHint(""))}
              />
            </>
          ) : (
            <Text style={styles.retryExhausted}>
              Scan ini sudah dihitung ulang sampai batasnya. Scan lagi di lain hari ya.
            </Text>
          )}
        </Card>
      ) : null}

      <Card style={styles.resultCard}>
        <View style={styles.waistHead}>
          <Ionicons name="speedometer-outline" size={15} color={theme.colors.primary} />
          <Text style={styles.waistTitle}>Angka yang lebih jujur: lingkar perut</Text>
        </View>
        {latestWaist ? (
          <Text style={styles.waistText}>
            Terakhir {dayLabel(latestWaist.date)}: {latestWaist.waistCm} cm
            {latestWaist.deltaCm !== null && latestWaist.deltaCm !== 0
              ? ` (${latestWaist.deltaCm > 0 ? "+" : "−"}${Math.abs(latestWaist.deltaCm)} cm)`
              : ""}. Foto cuma perkiraan visual — meteran yang mengukur.
          </Text>
        ) : (
          <Text style={styles.waistText}>
            Belum ada catatan meteran. Catat lingkar perut di layar Berat — itu sinyal objektifnya,
            foto hanya pelengkap.
          </Text>
        )}
      </Card>

      <Card style={styles.resultCard}>
        <View style={styles.shareRow}>
          <View style={styles.shareText}>
            <Text style={styles.shareTitle}>Bagikan status ke grup ini</Text>
            <Text style={styles.shareHint}>
              Yang ikut terlihat cuma verdict + tanggal. Foto perutmu tidak pernah dibagikan.
            </Text>
          </View>
          <Switch
            value={shareVar}
            onValueChange={onShare}
            disabled={sharePending}
            accessibilityLabel="Bagikan status VAR ke grup"
          />
        </View>
        <View style={styles.actionRow}>
          <Button size="sm" icon="camera" label="Scan lagi" onPress={onRescan} />
          <Button
            size="sm"
            variant="secondary"
            destructive
            icon="trash-outline"
            label="Hapus scan ini"
            onPress={() => onDelete(newest.id)}
          />
        </View>
      </Card>

      {scans.length > 1 ? (
        <Card style={styles.resultCard}>
          <Text style={styles.historyTitle}>Riwayat scan</Text>
          {[...scans].reverse().map((scan, index) => {
            const newer = [...scans].reverse()[index - 1] ?? null;
            const copy = verdictCopy(scan.verdict);
            return (
              <View key={scan.id} style={styles.historyRow}>
                <AuthedVarPhoto
                  photoUrl={scan.photoUrl}
                  label={`Foto perut ${dayLabel(scan.date)}`}
                  style={styles.historyPhoto}
                />
                <View style={styles.historyText}>
                  <Text style={[styles.historyVerdict, { color: copy.color }]}>{copy.label}</Text>
                  <Text style={styles.historyMeta}>
                    {dayLabel(scan.date)}
                    {scan.verdict !== "pertama" && scan.confidence !== null
                      ? ` · yakin ~${Math.round(scan.confidence * 100)}%`
                      : ""}
                    {scan.waistCm !== null ? ` · ${scan.waistCm} cm` : ""}
                  </Text>
                  {scan.note ? (
                    <Text style={styles.historyNote} numberOfLines={2}>
                      {scan.note}
                    </Text>
                  ) : null}
                </View>
                {newer ? (
                  <AuthedVarPhoto
                    photoUrl={newer.photoUrl}
                    label={`Pembanding ${dayLabel(newer.date)}`}
                    style={styles.historyPhoto}
                  />
                ) : null}
              </View>
            );
          })}
        </Card>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  safe: {
    flex: 1,
    backgroundColor: theme.colors.background,
    paddingHorizontal: theme.spacing.lg,
    gap: theme.spacing.md,
  },
  finderWrap: {
    flexGrow: 1,
    paddingTop: theme.spacing.md,
  },
  finder: {
    flex: 1,
    borderRadius: theme.radius.card,
    overflow: "hidden",
    backgroundColor: "#0B0F0C",
    alignItems: "center",
    justifyContent: "center",
  },
  finderHint: {
    position: "absolute",
    top: theme.spacing.md,
    alignSelf: "center",
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
    color: "#FFFFFF",
    backgroundColor: "rgba(0,0,0,0.55)",
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 6,
    borderRadius: theme.radius.pill,
    overflow: "hidden",
  },
  countdownLayer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  countdownText: {
    fontSize: 96,
    fontWeight: "900",
    color: "#FFFFFF",
  },
  analyzingLayer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.6)",
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.xl,
  },
  analyzingTitle: {
    fontSize: theme.fontSize.sm,
    fontWeight: "800",
    color: "#FFFFFF",
    textAlign: "center",
  },
  analyzingHint: {
    fontSize: theme.fontSize.xs,
    color: "rgba(255,255,255,0.75)",
    textAlign: "center",
  },
  permissionText: {
    fontSize: theme.fontSize.sm,
    color: "rgba(201,196,186,0.85)",
    textAlign: "center",
    paddingHorizontal: theme.spacing.xl,
    marginBottom: theme.spacing.md,
  },
  tipsCard: {
    gap: theme.spacing.sm,
    padding: theme.spacing.lg,
  },
  tipRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
  },
  tipText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
    flex: 1,
  },
  shutterRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: theme.spacing.sm,
  },
  timerChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 10,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.muted,
    minWidth: 92,
    justifyContent: "center",
  },
  timerChipOn: {
    backgroundColor: "rgba(61, 219, 132, 0.14)",
  },
  timerText: {
    fontSize: theme.fontSize.xs,
    fontWeight: "700",
    color: theme.colors.mutedForeground,
  },
  shutterOuter: {
    width: 68,
    height: 68,
    borderRadius: 34,
    borderWidth: 3,
    borderColor: theme.colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  shutter: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: theme.colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  disabled: {
    opacity: 0.5,
  },
  pressedSoft: {
    opacity: 0.7,
  },
  privacyNote: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.mutedForeground,
    textAlign: "center",
  },
  flowError: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.destructive,
    textAlign: "center",
  },
  resultCard: {
    gap: theme.spacing.sm,
    padding: theme.spacing.lg,
  },
  resultScroll: {
    flex: 1,
  },
  resultContent: {
    gap: theme.spacing.md,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.xl,
  },
  retryOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing.sm,
    borderRadius: theme.radius.card,
    backgroundColor: theme.colors.card,
    opacity: 0.92,
  },
  retryOverlayText: {
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
    color: theme.colors.primary,
  },
  retryHead: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: theme.spacing.sm,
  },
  retryExhausted: {
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    color: theme.colors.mutedForeground,
  },
  verdictHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
  },
  verdictTitle: {
    fontSize: theme.fontSize.lg,
    fontWeight: "800",
    flexShrink: 1,
  },
  confidenceTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.colors.muted,
    overflow: "hidden",
  },
  confidenceFill: {
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.colors.primary,
  },
  confidenceText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.mutedForeground,
  },
  noteText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
  },
  compareRow: {
    flexDirection: "row",
    gap: theme.spacing.md,
  },
  compareCell: {
    flex: 1,
    gap: 4,
  },
  comparePhoto: {
    width: "100%",
    aspectRatio: 0.75,
    borderRadius: theme.radius.card,
    backgroundColor: theme.colors.muted,
  },
  comparePhotoHighlight: {
    width: "100%",
    aspectRatio: 0.75,
    borderRadius: theme.radius.card,
    backgroundColor: theme.colors.muted,
    borderWidth: 2,
    borderColor: theme.colors.primary,
  },
  photoMissing: {
    alignItems: "center",
    justifyContent: "center",
  },
  photoMissingText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.mutedForeground,
  },
  compareCaption: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.mutedForeground,
    textAlign: "center",
  },
  waistHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
  },
  waistTitle: {
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
    flex: 1,
  },
  waistText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
  },
  shareRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
  },
  shareText: {
    flex: 1,
    gap: 2,
  },
  shareTitle: {
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
  },
  shareHint: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.mutedForeground,
  },
  actionRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: theme.spacing.sm,
  },
  historyTitle: {
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
    color: theme.colors.mutedForeground,
  },
  historyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
  },
  historyPhoto: {
    width: 56,
    height: 72,
    borderRadius: theme.radius.card,
    backgroundColor: theme.colors.muted,
  },
  historyText: {
    flex: 1,
    gap: 1,
  },
  historyVerdict: {
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
  },
  historyMeta: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.mutedForeground,
  },
  historyNote: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.mutedForeground,
    opacity: 0.8,
  },
  emptyWrap: {
    alignItems: "center",
    paddingTop: theme.spacing.xl,
  },
}));
