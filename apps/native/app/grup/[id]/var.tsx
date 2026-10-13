import "@/unistyles";
import { Ionicons } from "@expo/vector-icons";
import { useMutation } from "@tanstack/react-query";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Redirect, Stack, useLocalSearchParams, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { ComponentProps, useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Image,
  Pressable,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ClipPath, Defs, G, Path, Rect, Svg } from "react-native-svg";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { stickerUrl } from "@/components/sticker";
import { BootLoader, Button, Text } from "@/components/ui";
import { useToast } from "@/components/toast";
import { useSessionGate } from "@/lib/use-session-gate";
import type { VarScan } from "@/src/lib/group";
import { errorMessage, fmtKcal } from "@/utils/format";
import { client, orpc } from "@/utils/orpc";

/** Fixed-length pause so the scanner beat always plays out on screen. */
function wait(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

/** Total scan theatrics before the reveal, so the server call hides inside. */
const SCAN_MS = 2400;

const SCAN_STAGES = [
  "MENGUNCI TARGET…",
  "MEMINDAI ISI PERUT…",
  "ANALISIS KALORI…",
  "MEMUTUSKAN…",
];

/** Fan/cone outline drawn in a stretched 100×100 box so it lines up with the
    food slots, which are positioned in percentages of the same box. */
const CONE_PATH = "M50 10 L13 87 Q50 95 87 87 Z";
const SCANLINES = Array.from({ length: 26 }, (_, i) => 13 + i * 3);

const FOOD_SLOTS: Array<[left: number, top: number]> = [
  [50, 6],
  [20, 28],
  [72, 30],
  [38, 50],
  [64, 58],
  [12, 60],
];

type IconName = ComponentProps<typeof Ionicons>["name"];

function verdictCopy(
  scan: VarScan,
  name: string,
): { icon: IconName; title: string; color: string } {
  if (scan.hidden) {
    return { icon: "eye-off", title: `${name} menyembunyikan isi perutnya`, color: "#C9C4BA" };
  }
  if (scan.verdict === "aman") {
    return { icon: "checkmark-circle", title: "AMAN, lanjutkan!", color: "#3DDB84" };
  }
  if (scan.verdict === "offside") {
    const over = Math.max(0, scan.eatenKcal - (scan.eatTargetKcal ?? 0));
    return { icon: "flag", title: `OFFSIDE! +${fmtKcal(over)} kcal`, color: "#FF6A52" };
  }
  if (scan.verdict === "tanpa_target") {
    return { icon: "information-circle", title: "Belum ada target pembanding", color: "#C9C4BA" };
  }
  return { icon: "ellipse-outline", title: "Perut kosong… belum makan?", color: "#FFD84D" };
}

/** Salinan verdict VAR perut (mirror lib/varscan.ts untuk klien). */
function bellyVerdictLabel(verdict: NonNullable<VarScan["varStatus"]>["verdict"]): string {
  switch (verdict) {
    case "turun":
      return "mengecil";
    case "naik":
      return "lebih penuh";
    case "sama":
      return "belum beda";
    case "beda":
      return "foto beda";
    case "pertama":
      return "scan pertama";
  }
}

/** "12 Okt" untuk chip status VAR perut. */
function varChipDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/** One food chip bobbing inside the cone; static under reduced motion. */
function FoodFloat({
  name,
  kcal,
  photoUrl,
  index,
  reducedMotion,
}: {
  name: string;
  kcal: number;
  photoUrl: string | null;
  index: number;
  reducedMotion: boolean;
}) {
  const bob = useRef(new Animated.Value(0)).current;
  const [left, top] = FOOD_SLOTS[index % FOOD_SLOTS.length];

  useEffect(() => {
    if (reducedMotion) return;
    const duration = 1150 + (index % 4) * 160;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(bob, {
          toValue: 1,
          duration,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(bob, {
          toValue: 0,
          duration,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [bob, reducedMotion, index]);

  return (
    <Animated.View
      style={[styles.foodChip, { left: `${left}%`, top: `${top}%`, transform: [{ translateY: bob.interpolate({ inputRange: [0, 1], outputRange: [-7, 7] }) }] }]}
    >
      {photoUrl ? (
        <Image source={{ uri: stickerUrl(photoUrl) }} style={styles.foodImg} />
      ) : (
        <Ionicons name="restaurant" size={20} color={SCAN_GREEN} />
      )}
      <View style={styles.foodText}>
        <Text style={styles.foodName} numberOfLines={1}>
          {name}
        </Text>
        <Text style={styles.foodKcal}>{fmtKcal(kcal)} kcal</Text>
      </View>
    </Animated.View>
  );
}

export default function VarPerut() {
  const { theme } = useUnistyles();
  const gate = useSessionGate();
  const router = useRouter();
  const { id, userId, name = "", shareFood = "1" } = useLocalSearchParams<{
    id: string;
    userId: string;
    name?: string;
    /** "0" = target menyembunyikan nama makanannya; scan ditekan, bukan dipura-pura. */
    shareFood?: string;
  }>();
  const groupId = Array.isArray(id) ? (id[0] ?? "") : (id ?? "");
  const targetId = Array.isArray(userId) ? (userId[0] ?? "") : (userId ?? "");
  const firstName = name.split(" ")[0] || "temanmu";
  // Anggota yang menyembunyikan makanannya tidak dijamin apa-apa setelah
  // teatrikal 2,4 detik — kartu jujurnya langsung tampil, tanpa scan palsu.
  const hidden = shareFood === "0";

  const [permission, requestPermission] = useCameraPermissions();
  const [phase, setPhase] = useState<"aim" | "scanning" | "reveal">("aim");
  const [scan, setScan] = useState<VarScan | null>(null);
  const [stage, setStage] = useState(0);
  const [poked, setPoked] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const toast = useToast();

  const sweep = useRef(new Animated.Value(0)).current;
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReducedMotion);
  }, []);

  // Sweeping USG line while aiming/scanning.
  useEffect(() => {
    if (phase === "reveal" || reducedMotion) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(sweep, {
          toValue: 1,
          duration: 1700,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(sweep, {
          toValue: 0,
          duration: 1700,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [phase, reducedMotion, sweep]);

  // Stage copy advances on thirds of the scan window.
  useEffect(() => {
    if (phase !== "scanning") return;
    setStage(0);
    const timer = setInterval(
      () => setStage((current) => Math.min(current + 1, SCAN_STAGES.length - 1)),
      SCAN_MS / (SCAN_STAGES.length - 1),
    );
    return () => clearInterval(timer);
  }, [phase]);

  const poke = useMutation(
    orpc.group.nudge.mutationOptions({
      onSuccess: () => {
        setPoked(true);
        toast.success("Colek terkirim", `${firstName} dapat notifikasi sekarang.`);
      },
      onError: (e) => toast.error("Gagal mencolek", errorMessage(e)),
    }),
  );

  if (gate === "loading" || permission === null) {
    return <BootLoader />;
  }
  if (gate === "anon") {
    return <Redirect href="/login" />;
  }

  const startScan = () => {
    setScan(null);
    setPoked(false);
    setPhase("scanning");
    progress.setValue(0);
    const startedAt = Date.now();
    if (!reducedMotion) {
      Animated.timing(progress, {
        toValue: 1,
        duration: SCAN_MS,
        easing: Easing.linear,
        useNativeDriver: true,
      }).start();
    }
    void (async () => {
      try {
        const result = await client.group.varScan({ groupId, userId: targetId });
        // Hold the scanner on screen for the full beat before revealing.
        const elapsed = Date.now() - startedAt;
        if (elapsed < SCAN_MS) await wait(SCAN_MS - elapsed);
        setScan(result);
        setPhase("reveal");
      } catch (e) {
        setPhase("aim");
        toast.error("VAR gagal", errorMessage(e));
      }
    })();
  };

  const scanning = phase === "scanning";
  const revealed = phase === "reveal" && scan !== null;
  const verdict = scan ? verdictCopy(scan, firstName) : null;
  const totalKcal = scan?.eatenKcal ?? 0;
  const targetKcal = scan?.eatTargetKcal ?? null;
  const foods = scan?.hidden ? [] : (scan?.foods ?? []);
  const shownFoods = foods.slice(0, FOOD_SLOTS.length);

  const sweepTop = sweep.interpolate({ inputRange: [0, 1], outputRange: ["12%", "84%"] });
  const progressWidth = progress.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] });

  return (
    <>
      <Stack.Screen options={{ headerShown: false, presentation: "fullScreenModal" }} />
      <StatusBar style="light" />
      <SafeAreaView style={styles.safe}>
        {/* --- Camera + USG overlay --- */}
        <View style={styles.cameraWrap}>
          {permission.granted ? (
            <CameraView style={StyleSheet.absoluteFill} facing="back" />
          ) : (
            <View style={StyleSheet.absoluteFill}>
              <Text style={styles.placeholderHint}>
                Izin kamera belum ada — mode bayangan. VAR tetap jalan kok!
              </Text>
              <Button
                size="sm"
                variant="secondary"
                label="Beri Izin Kamera"
                onPress={() => void requestPermission()}
                style={styles.permissionBtn}
              />
            </View>
          )}
          <View style={styles.tint} />

          {/* Fan cone + scanlines */}
          <Svg
            style={StyleSheet.absoluteFill}
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
          >
            <Defs>
              <ClipPath id="cone">
                <Path d={CONE_PATH} />
              </ClipPath>
            </Defs>
            <Path d={CONE_PATH} fill="rgba(120,255,180,0.10)" stroke="rgba(120,255,180,0.7)" strokeWidth="0.4" />
            <G clipPath="url(#cone)">
              {SCANLINES.map((y) => (
                <Rect key={y} x="0" y={y} width="100" height="0.35" fill="rgba(120,255,180,0.14)" />
              ))}
            </G>
          </Svg>

          {/* Sweep line */}
          {!revealed && !reducedMotion ? (
            <Animated.View style={[styles.sweep, { top: sweepTop }]} pointerEvents="none" />
          ) : null}

          {/* Food reveal inside the cone */}
          {revealed ? (
            <View style={styles.foodLayer} pointerEvents="none">
              {shownFoods.map((food, index) => (
                <FoodFloat
                  key={`${food.name}-${index}`}
                  name={food.name}
                  kcal={food.kcal}
                  photoUrl={food.photoUrl}
                  index={index}
                  reducedMotion={reducedMotion}
                />
              ))}
              {foods.length > shownFoods.length ? (
                <View style={[styles.foodChip, { left: "44%", top: "76%" }]}>
                  <Text style={styles.foodKcal}>+{foods.length - shownFoods.length} lagi</Text>
                </View>
              ) : null}
              {foods.length === 0 && !scan?.hidden ? (
                <View style={[styles.foodChip, { left: "30%", top: "42%" }]}>
                  <Ionicons name="ellipse-outline" size={16} color={SCAN_GREEN} />
                  <Text style={styles.foodKcal}>Tidak ada makanan terdeteksi</Text>
                </View>
              ) : null}
            </View>
          ) : null}

          {/* Broadcast banner */}
          {!revealed ? (
            <View style={styles.banner} pointerEvents="none">
              <View style={[styles.bannerFlag, { backgroundColor: "#E23B2E" }]} />
              <View style={styles.bannerBox}>
                <Text style={styles.bannerText}>{scanning ? "VAR SCANNING" : "VAR CHECK"}</Text>
              </View>
              <View style={[styles.bannerFlag, { backgroundColor: "#E23B2E" }]} />
            </View>
          ) : null}

          {/* Reticle + aim hint */}
          {phase === "aim" ? (
            <View style={styles.reticleWrap} pointerEvents="none">
              <View style={styles.reticle}>
                <View style={[styles.crosshair, styles.crosshairH]} />
                <View style={[styles.crosshair, styles.crosshairV]} />
              </View>
              <Text style={styles.aimHint}>
                {hidden ? `${firstName} menyembunyikan isi perutnya` : `Arahkan ke perut ${firstName}`}
              </Text>
            </View>
          ) : null}

          {/* Scanning stage copy + progress */}
          {scanning ? (
            <View style={styles.scanInfo} pointerEvents="none">
              <Text style={styles.stageText}>{SCAN_STAGES[stage]}</Text>
              <Text style={styles.beepText}>biip… biip…</Text>
              <View style={styles.progressTrack}>
                <Animated.View
                  style={[styles.progressFill, reducedMotion ? { width: "60%" } : { width: progressWidth }]}
                />
              </View>
            </View>
          ) : null}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Tutup VAR"
            onPress={() => router.back()}
            hitSlop={8}
            style={({ pressed }) => [styles.close, pressed && styles.pressed]}
          >
            <Ionicons name="close" size={20} color="#FFFFFF" />
          </Pressable>
        </View>

        {/* --- Bottom panel: verdict / scan button --- */}
        <View style={styles.bottom}>
          {hidden ? (
            <>
              <View style={[styles.verdictCard, { borderColor: "#C9C4BA" }]}>
                <View style={styles.verdictHead}>
                  <Ionicons name="eye-off" size={22} color="#C9C4BA" />
                  <Text style={[styles.verdictTitle, { color: "#C9C4BA" }]}>
                    {firstName} menyembunyikan isi perutnya
                  </Text>
                </View>
                <Text style={styles.hiddenNote}>
                  Total kalorinya tetap terlihat di kartu anggotanya. Colek aja biar makin semangat.
                </Text>
              </View>
              <View style={styles.bottomActions}>
                <Button
                  size="sm"
                  variant="secondary"
                  icon="hand-left"
                  label={poked ? "Terkirim" : "Colek"}
                  disabled={poked || poke.isPending}
                  loading={poke.isPending}
                  onPress={() => poke.mutate({ groupId, toUserId: targetId, kind: "poke" })}
                />
                <Button size="sm" label="Selesai" onPress={() => router.back()} />
              </View>
            </>
          ) : revealed && scan && verdict ? (
            <>
              <View style={[styles.verdictCard, { borderColor: verdict.color }]}>
                <View style={styles.verdictHead}>
                  <Ionicons name={verdict.icon} size={22} color={verdict.color} />
                  <Text style={[styles.verdictTitle, { color: verdict.color }]}>
                    {verdict.title}
                  </Text>
                </View>
                <View style={styles.totalsRow}>
                  <Text style={styles.totalsLabel}>Asupan hari ini</Text>
                  <Text style={styles.totalsValue}>
                    {fmtKcal(totalKcal)} / {targetKcal !== null ? fmtKcal(targetKcal) : "?"} kcal
                  </Text>
                </View>
                <View style={styles.totalTrack}>
                  <View
                    style={[
                      styles.totalFill,
                      {
                        width:
                          targetKcal !== null && targetKcal > 0
                            ? `${Math.min(100, (totalKcal / targetKcal) * 100)}%`
                            : "0%",
                        backgroundColor: verdict.color,
                      },
                    ]}
                  />
                </View>
                <Text style={styles.honestNote}>
                  Berdasarkan catatan makan {firstName} hari ini, bukan foto asli.
                </Text>
                {scan.varStatus ? (
                  <View style={styles.varStatusChip}>
                    <Ionicons name="tv" size={13} color="#78FFB4" />
                    <Text style={styles.varStatusText}>
                      VAR perut {firstName} ({varChipDate(scan.varStatus.date)}):{" "}
                      {bellyVerdictLabel(scan.varStatus.verdict)}
                    </Text>
                  </View>
                ) : null}
              </View>
              <View style={styles.bottomActions}>
                <Button
                  size="sm"
                  variant="secondary"
                  label="Scan ulang"
                  onPress={() => {
                    setScan(null);
                    setPhase("aim");
                  }}
                />
                <Button
                  size="sm"
                  variant="secondary"
                  icon="hand-left"
                  label={poked ? "Terkirim" : "Colek"}
                  disabled={poked || poke.isPending}
                  loading={poke.isPending}
                  onPress={() => poke.mutate({ groupId, toUserId: targetId, kind: "poke" })}
                />
                <Button size="sm" label="Selesai" onPress={() => router.back()} />
              </View>
            </>
          ) : (
            <>
              <Text style={styles.bottomHint}>
                {scanning
                  ? "VAR sedang memeriksa catatan makan…"
                  : `Cek catatan makan ${firstName} lewat VAR`}
              </Text>
              {!scanning ? (
                <Button
                  icon="scan"
                  label="Scan Sekarang"
                  onPress={startScan}
                  style={styles.scanBtn}
                />
              ) : null}
            </>
          )}
        </View>
      </SafeAreaView>
    </>
  );
}

const PANEL = "#060807";
const SCAN_GREEN = "#78FFB4";

const styles = StyleSheet.create((theme) => ({
  safe: {
    flex: 1,
    backgroundColor: PANEL,
  },
  cameraWrap: {
    flex: 1,
    backgroundColor: "#0B0F0C",
    overflow: "hidden",
  },
  tint: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(6, 32, 18, 0.42)",
  },
  placeholderHint: {
    ...StyleSheet.absoluteFillObject,
    textAlign: "center",
    top: "18%",
    paddingHorizontal: theme.spacing.xl,
    fontSize: theme.fontSize.sm,
    color: "rgba(201,196,186,0.8)",
  },
  permissionBtn: {
    position: "absolute",
    top: "26%",
    alignSelf: "center",
    minWidth: 200,
  },
  sweep: {
    position: "absolute",
    left: "14%",
    right: "14%",
    height: 2,
    backgroundColor: SCAN_GREEN,
    opacity: 0.8,
    shadowColor: SCAN_GREEN,
    shadowOpacity: 0.9,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
    elevation: 4,
  },
  foodLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  foodChip: {
    position: "absolute",
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    maxWidth: "62%",
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.radius.pill,
    backgroundColor: "rgba(4, 12, 7, 0.78)",
    borderWidth: 1,
    borderColor: "rgba(120,255,180,0.4)",
  },
  foodImg: {
    width: 36,
    height: 36,
    borderRadius: 10,
  },
  foodText: {
    flexShrink: 1,
  },
  foodName: {
    fontSize: theme.fontSize.xs,
    fontWeight: "700",
    color: "#F1EEE9",
  },
  foodKcal: {
    fontSize: theme.fontSize.xs,
    color: SCAN_GREEN,
  },
  banner: {
    position: "absolute",
    top: 18,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  bannerFlag: {
    width: 5,
    height: 20,
    borderRadius: 2,
  },
  bannerBox: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: "rgba(0,0,0,0.85)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
  },
  bannerText: {
    fontSize: theme.fontSize.xs,
    fontWeight: "800",
    letterSpacing: 3,
    color: "#FFFFFF",
  },
  reticleWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing.md,
  },
  reticle: {
    width: 128,
    height: 128,
    borderRadius: 64,
    borderWidth: 2,
    borderColor: "rgba(120,255,180,0.85)",
    alignItems: "center",
    justifyContent: "center",
  },
  crosshair: {
    position: "absolute",
    backgroundColor: "rgba(120,255,180,0.85)",
  },
  crosshairH: {
    width: 26,
    height: 2,
  },
  crosshairV: {
    width: 2,
    height: 26,
  },
  aimHint: {
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
    color: "#FFFFFF",
    backgroundColor: "rgba(0,0,0,0.6)",
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 6,
    borderRadius: theme.radius.pill,
    overflow: "hidden",
  },
  scanInfo: {
    position: "absolute",
    bottom: "8%",
    alignSelf: "center",
    alignItems: "center",
    gap: theme.spacing.sm,
  },
  stageText: {
    fontSize: theme.fontSize.sm,
    fontWeight: "800",
    letterSpacing: 2,
    color: SCAN_GREEN,
  },
  beepText: {
    fontSize: theme.fontSize.xs,
    color: "rgba(201,196,186,0.7)",
  },
  progressTrack: {
    width: 220,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.18)",
    overflow: "hidden",
  },
  progressFill: {
    height: 4,
    backgroundColor: SCAN_GREEN,
  },
  close: {
    position: "absolute",
    top: theme.spacing.md,
    right: theme.spacing.md,
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  pressed: {
    opacity: 0.7,
  },
  bottom: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.md,
    gap: theme.spacing.md,
    backgroundColor: PANEL,
  },
  bottomHint: {
    textAlign: "center",
    fontSize: theme.fontSize.sm,
    color: "rgba(201,196,186,0.85)",
  },
  scanBtn: {
    alignSelf: "center",
    minWidth: 240,
  },
  verdictCard: {
    borderRadius: theme.radius.card,
    borderWidth: 2,
    padding: theme.spacing.lg,
    gap: theme.spacing.sm,
    backgroundColor: "rgba(255,255,255,0.04)",
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
  totalsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  totalsLabel: {
    fontSize: theme.fontSize.sm,
    color: "rgba(201,196,186,0.85)",
  },
  totalsValue: {
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
    color: "#F1EEE9",
  },
  totalTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: "rgba(255,255,255,0.14)",
    overflow: "hidden",
  },
  totalFill: {
    height: 6,
    borderRadius: 3,
  },
  bottomActions: {
    flexDirection: "row",
    justifyContent: "center",
    gap: theme.spacing.sm,
  },
  hiddenNote: {
    fontSize: theme.fontSize.sm,
    color: "rgba(201,196,186,0.85)",
  },
  honestNote: {
    fontSize: theme.fontSize.xs,
    color: "rgba(201,196,186,0.7)",
  },
  varStatusChip: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "center",
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 6,
    borderRadius: theme.radius.pill,
    backgroundColor: "rgba(120,255,180,0.1)",
    borderWidth: 1,
    borderColor: "rgba(120,255,180,0.35)",
  },
  varStatusText: {
    fontSize: theme.fontSize.xs,
    fontWeight: "600",
    color: "#78FFB4",
  },
}));
