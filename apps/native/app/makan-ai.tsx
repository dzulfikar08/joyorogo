import "@/unistyles";
import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Redirect, router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as ImagePicker from "expo-image-picker";
import ConfettiCannon from "react-native-confetti-cannon";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";

import { MEAL_LABELS, effectiveRamadan, slotsFor, suggestMealNow } from "@joyorogo/api/lib/engine";
import type { Meal } from "@joyorogo/api/lib/engine";

import {
  BootLoader,
  Button,
  Input,
  ListGroup,
  ListRow,
  Num,
  Segmented,
  Text,
} from "@/components/ui";
import { PlateFields, plateInput } from "@/components/plate/plate-fields";
import type { PlateValues } from "@/components/plate/plate-fields";
import { useSessionGate } from "@/lib/use-session-gate";
import { errorMessage, parseNum } from "@/utils/format";
import { orpc, queryClient } from "@/utils/orpc";

type AnalyzedItem = {
  name: string;
  portion?: string;
  grams?: number;
  kcal: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  fiber?: number;
  confidence?: number;
  /** [ymin, xmin, ymax, xmax] on 0-1000 relative to the image we sent. */
  box?: number[];
};

const ALL_MEAL_KEYS = Object.keys(MEAL_LABELS) as Meal[];

const MEAL_SHORT: Record<Meal, string> = {
  sarapan: "Sarapan",
  makan_siang: "Siang",
  makan_malam: "Malam",
  snack: "Snack",
  sahur: "Sahur",
  berbuka: "Berbuka",
};

const MAX_SIDE = 1024;

/** Fun portion stat, same as the web confirm card: 600 kcal = one geprek. */
const GEPREK_KCAL = 600;

/**
 * Cuts one item crop on device from the image we sent. Boxes are on a
 * 0-1000 grid, so they map straight onto the sent image's pixel size.
 * Returns null when the box is missing or collapses to nothing usable.
 */
async function cropFromBox(
  uri: string,
  width: number,
  height: number,
  box: number[],
): Promise<string | null> {
  const [ymin, xmin, ymax, xmax] = box;
  const left = Math.min(width - 1, Math.max(0, Math.round((xmin / 1000) * width)));
  const top = Math.min(height - 1, Math.max(0, Math.round((ymin / 1000) * height)));
  const cropWidth = Math.min(width - left, Math.round(((xmax - xmin) / 1000) * width));
  const cropHeight = Math.min(height - top, Math.round(((ymax - ymin) / 1000) * height));
  if (cropWidth < 8 || cropHeight < 8) return null;
  const rendered = await ImageManipulator.manipulate(uri)
    .crop({ originX: left, originY: top, width: cropWidth, height: cropHeight })
    .renderAsync();
  const saved = await rendered.saveAsync({ compress: 0.8, format: SaveFormat.JPEG });
  return saved.uri;
}

/** The signature reaction line — same thresholds as the web app. */
function reaction(totalKcal: number): string {
  if (totalKcal > 1100) return "Buset, yakin makan segitu bro?";
  if (totalKcal > 550) return "Buset, yakin makan segitu bro?";
  return "Aman, bro. Mantap.";
}

type Phase = "camera" | "confirm" | "done";

// Server answers in ~8-12 s since thinking is disabled; the copy advances on
// this rhythm so nothing promises "up to a minute".
const ANALYZE_STAGES = [
  "Mengirim foto…",
  "AI mengenali makananmu…",
  "Menghitung kalori…",
  "Hampir selesai…",
] as const;
const STAGE_MS = 2500;

function AnalyzingOverlay({ previewUri, onCancel }: { previewUri: string; onCancel: () => void }) {
  const [stage, setStage] = useState(0);
  useEffect(() => {
    const timer = setInterval(
      () => setStage((s) => Math.min(s + 1, ANALYZE_STAGES.length - 1)),
      STAGE_MS,
    );
    return () => clearInterval(timer);
  }, []);
  return (
    <View style={styles.analyzingOverlay}>
      <Image source={{ uri: previewUri }} style={styles.analyzingPreview} resizeMode="cover" />
      <View style={styles.analyzingShade}>
        <ActivityIndicator size="large" color="#FFFFFF" />
        <Text style={styles.analyzingText}>{ANALYZE_STAGES[stage]}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Batalkan analisis"
          onPress={onCancel}
          style={({ pressed }) => [styles.analyzingCancel, pressed && styles.shutterPressed]}
        >
          <Text style={styles.analyzingCancelText}>Batalkan</Text>
        </Pressable>
      </View>
    </View>
  );
}

export default function MakanAi() {
  const { theme } = useUnistyles();
  const gate = useSessionGate();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);

  const [phase, setPhase] = useState<Phase>("camera");
  const [items, setItems] = useState<AnalyzedItem[]>([]);
  const [drafts, setDrafts] = useState<{ kcal: string; include: boolean }[]>([]);
  // Exact bytes we sent to the model: reused for the one-shot save.
  const [sentImage, setSentImage] = useState<{
    base64: string;
    uri: string;
    width: number;
    height: number;
  } | null>(null);
  // Per-item crops cut on device from the sent image, parallel to items.
  const [crops, setCrops] = useState<Array<string | null>>([]);
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const profile = useQuery(orpc.profile.myProfile.queryOptions());
  const ramadan = effectiveRamadan(profile.data?.profile?.ramadanMode);
  const MEAL_KEYS = ALL_MEAL_KEYS.filter((key) => slotsFor(ramadan).includes(key));
  const [meal, setMeal] = useState<Meal>(() => suggestMealNow(new Date(), ramadan));
  const [flowError, setFlowError] = useState<string | null>(null);

  const analyze = useMutation(orpc.ai.analyzeFood.mutationOptions());
  const addScan = useMutation(orpc.food.addScan.mutationOptions());
  const logCorrections = useMutation(orpc.ai.logCorrections.mutationOptions());
  // Plate price autofill: one lookup per parse, prefill name/place/price.
  const lastPrice = useMutation(orpc.plate.lastPrice.mutationOptions());
  const [plateValues, setPlateValues] = useState<PlateValues>({
    name: "",
    place: "",
    price: "",
  });

  if (gate === "loading") {
    return <BootLoader />;
  }
  if (gate === "anon") {
    return <Redirect href="/login" />;
  }
  if (permission === null) {
    return <BootLoader />;
  }

  const resetToCamera = () => {
    setFlowError(null);
    setItems([]);
    setDrafts([]);
    setSentImage(null);
    setCrops([]);
    setPreviewUri(null);
    setPlateValues({ name: "", place: "", price: "" });
    analyze.reset();
    setPhase("camera");
  };

  /** Resize to MAX_SIDE, analyze, then enter confirm with drafts and crops. */
  const processImage = async (photoUri: string, photoWidth: number, photoHeight: number) => {
    setFlowError(null);
    let previewSet = false;
    try {
      // Show the shot immediately while the upload + AI run (~10 s total).
      setPreviewUri(photoUri);
      previewSet = true;
      // One resize + one JPEG encode: longest side to 1024 px, base64 once.
      let context = ImageManipulator.manipulate(photoUri);
      if (Math.max(photoWidth, photoHeight) > MAX_SIDE) {
        context =
          photoHeight >= photoWidth
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
        if (previewSet) setPreviewUri(null);
        return;
      }
      const result = await analyze.mutateAsync({
        imageBase64: saved.base64,
        mimeType: "image/jpeg",
        crops: true,
      });
      setItems(result.items);
      // Plate fields: default name = first item, then autofill the last price.
      const firstName = result.items[0]?.name;
      setPlateValues({ name: firstName ?? "", place: "", price: "" });
      if (firstName) {
        void lastPrice
          .mutateAsync({ name: firstName })
          .then((found) => {
            if (!found) return;
            setPlateValues((prev) => ({
              name: found.name || prev.name,
              place: found.place ?? prev.place,
              price: found.priceIdr > 0 ? String(found.priceIdr) : prev.price,
            }));
          })
          .catch(() => {});
      }
      // Keep exactly what we sent so the save reuses the same bytes.
      setSentImage({
        base64: saved.base64,
        uri: saved.uri,
        width: rendered.width,
        height: rendered.height,
      });
      setDrafts(
        result.items.map((item) => ({ kcal: String(Math.round(item.kcal)), include: true })),
      );
      setPhase("confirm");
      // Cut the per-item tiles in the background; rows update as they land.
      void Promise.all(
        result.items.map(async (item) =>
          item.box
            ? cropFromBox(saved.uri, rendered.width, rendered.height, item.box).catch(() => null)
            : null,
        ),
      ).then((uris) => {
        setCrops(uris);
      });
    } catch (e) {
      if (previewSet) setPreviewUri(null);
      setFlowError(errorMessage(e));
    }
  };

  const capture = async () => {
    try {
      const photo = await cameraRef.current?.takePictureAsync({ quality: 1 });
      if (!photo?.uri) {
        setFlowError("Gagal mengambil foto. Coba lagi.");
        return;
      }
      await processImage(photo.uri, photo.width, photo.height);
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
      await processImage(asset.uri, asset.width, asset.height);
    } catch (e) {
      setFlowError(errorMessage(e));
    }
  };

  const saveIncluded = async () => {
    setFlowError(null);
    const plate = plateInput(plateValues, items[0]?.name);
    const chosen = items
      .map((item, index) => ({ item, draft: drafts[index] }))
      .filter((entry) => entry.draft?.include);
    if (chosen.length === 0) {
      setFlowError("Pilih minimal satu makanan untuk dicatat.");
      return;
    }
    const invalid = chosen.find((entry) => (parseNum(entry.draft.kcal) ?? -1) < 0);
    if (invalid) {
      setFlowError(`Periksa kalori untuk ${invalid.item.name}.`);
      return;
    }
    try {
      if (!sentImage) {
        setFlowError("Foto pemindaian hilang. Foto ulang dulu.");
        return;
      }
      await addScan.mutateAsync({
        meal,
        imageBase64: sentImage.base64,
        mimeType: "image/jpeg",
        items: chosen.map(({ item, draft }) => ({
          name: item.name,
          kcal: parseNum(draft.kcal) ?? 0,
          protein: item.protein,
          carbs: item.carbs,
          fat: item.fat,
          fiber: item.fiber,
          box: item.box,
        })),
        itemsJson: JSON.stringify(items),
        ...(plate ? { plate } : {}),
      });
      // Miss log: AI estimate vs what the user kept. Never blocks the save.
      void logCorrections
        .mutateAsync({
          source: "native",
          items: chosen.map(({ item, draft }) => ({
            meal,
            dishName: item.name,
            aiKcal: Math.round(item.kcal),
            savedKcal: parseNum(draft.kcal) ?? 0,
            aiGrams: item.grams ?? null,
            aiConfidence: item.confidence ?? null,
          })),
        })
        .catch(() => {});
      queryClient.invalidateQueries();
      setPhase("done");
    } catch (e) {
      setFlowError(errorMessage(e));
    }
  };

  // ---- Camera phase (full-bleed, no card layout) ----
  if (phase === "camera") {
    if (!permission.granted) {
      return (
        <SafeAreaView style={styles.permissionSafe}>
          <View style={styles.permissionBody}>
            <View style={[styles.permissionIcon, { backgroundColor: theme.colors.muted }]}>
              <Ionicons name="camera-outline" size={26} color={theme.colors.mutedForeground} />
            </View>
            <Text style={styles.permissionTitle}>Kamera dibutuhkan</Text>
            <Text style={styles.permissionText}>
              {`JoyoRogo butuh izin kamera untuk memotret makananmu dan menghitung kalorinya dengan AI. ${
                profile.data?.profile?.keepPhotos
                  ? "Foto asli disimpan untukmu sendiri. Atur di Profil."
                  : "Foto tidak disimpan."
              }`}
            </Text>
            <View style={styles.permissionAction}>
              <Button label="Beri Izin Kamera" onPress={() => void requestPermission()} />
              <Button
                variant="secondary"
                label="Pilih dari Galeri"
                icon="images-outline"
                onPress={() => void pickFromGallery()}
              />
            </View>
          </View>
        </SafeAreaView>
      );
    }
    return (
      <View style={styles.cameraWrap}>
        <CameraView ref={cameraRef} style={styles.camera} facing="back" />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Tutup kamera"
          onPress={() => router.back()}
          style={styles.closeButton}
        >
          <Ionicons name="close" size={24} color="#FFFFFF" />
        </Pressable>
        {analyze.isPending && previewUri ? (
          <AnalyzingOverlay previewUri={previewUri} onCancel={resetToCamera} />
        ) : (
          <>
            <View style={styles.shutterRow}>
              <Text style={styles.shutterHint}>Potret piringmu, AI hitung kalorinya</Text>
              <View style={styles.shutterActions}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Pilih dari galeri"
                  disabled={analyze.isPending}
                  onPress={() => void pickFromGallery()}
                  style={({ pressed }) => [
                    styles.galleryButton,
                    analyze.isPending && styles.disabled,
                    pressed && styles.shutterPressed,
                  ]}
                >
                  <Ionicons name="images-outline" size={26} color="#FFFFFF" />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Potret makanan"
                  disabled={analyze.isPending}
                  onPress={() => void capture()}
                  style={({ pressed }) => [styles.shutterOuter, pressed && styles.shutterPressed]}
                >
                  <View style={styles.shutter}>
                    <View style={styles.shutterInner} />
                  </View>
                </Pressable>
              </View>
            </View>
            {flowError ? (
              <View style={styles.cameraError}>
                <Text style={styles.cameraErrorText}>{flowError}</Text>
                <View style={styles.cameraErrorActions}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Coba lagi"
                    onPress={() => void capture()}
                    style={({ pressed }) => [
                      styles.cameraRetry,
                      pressed && styles.cameraRetryPressed,
                    ]}
                  >
                    <Text style={styles.cameraRetryText}>Coba Lagi</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Tutup pesan galat"
                    onPress={() => setFlowError(null)}
                    hitSlop={8}
                  >
                    <Text style={styles.cameraErrorDismiss}>Tutup</Text>
                  </Pressable>
                </View>
              </View>
            ) : null}
          </>
        )}
      </View>
    );
  }

  // ---- Confirm phase: result as a bottom panel ----
  if (phase === "confirm") {
    const includedCount = drafts.filter((draft) => draft.include).length;
    // Live total of INCLUDED items — drives the big number + reaction.
    const totalKcal = drafts.reduce(
      (sum, draft) => (draft.include ? sum + (parseNum(draft.kcal) ?? 0) : sum),
      0,
    );
    return (
      <SafeAreaView style={styles.safeArea}>
        <ScrollView
          contentContainerStyle={styles.confirmContent}
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets={true}
        >
          {totalKcal > 0 && (
            <ConfettiCannon
              count={totalKcal > 1100 ? 160 : totalKcal > 550 ? 100 : 50}
              origin={{ x: -10, y: 0 }}
              autoStart
              fadeOut
            />
          )}
          <View style={styles.totalBlock}>
            <Text style={styles.totalLabel}>Total kalori foto ini</Text>
            <Num style={styles.totalValue} adjustsFontSizeToFit numberOfLines={1}>
              {totalKcal.toLocaleString("id-ID")}
            </Num>
            <Text style={styles.totalUnit}>kcal</Text>
            {totalKcal > 0 ? <Text style={styles.totalReaction}>{reaction(totalKcal)}</Text> : null}
            {totalKcal > 0 ? (
              <Text style={styles.totalGeprek}>
                Setara {Math.round(totalKcal / GEPREK_KCAL)} porsi geprek
              </Text>
            ) : null}
          </View>

          {/* Original photo + per-item crops cut on device */}
          {previewUri ? (
            <View style={styles.reviewPhotoBlock}>
              <Image
                source={{ uri: previewUri }}
                style={styles.reviewPhoto}
                resizeMode="cover"
                accessibilityLabel="Foto makanan yang dipindai"
              />
              {crops.some(Boolean) ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={styles.cropRow}>
                    {items.map((item, index) => (
                      <View key={`crop-${item.name}-${index}`} style={styles.cropTile}>
                        {crops[index] ? (
                          <Image
                            source={{ uri: crops[index] as string }}
                            style={styles.cropImage}
                            accessibilityLabel={`Potongan ${item.name}`}
                          />
                        ) : (
                          <View style={[styles.cropImage, styles.cropPending]}>
                            <ActivityIndicator size="small" color={theme.colors.mutedForeground} />
                          </View>
                        )}
                        <Text style={styles.cropLabel} numberOfLines={1}>
                          {item.name}
                        </Text>
                      </View>
                    ))}
                  </View>
                </ScrollView>
              ) : null}
            </View>
          ) : null}

          {/* Editable item rows */}
          <ListGroup>
            {items.map((item, index) => {
              const draft = drafts[index];
              if (!draft) return null;
              const meta = [
                item.portion,
                item.grams !== undefined ? `± ${Math.round(item.grams)} g` : null,
                item.confidence !== undefined
                  ? `yakin ${Math.round(item.confidence * 100)}%`
                  : "perkiraan AI",
              ]
                .filter(Boolean)
                .join(" • ");
              return (
                <ListRow
                  key={`${item.name}-${index}`}
                  icon={draft.include ? "checkmark-circle" : "ellipse-outline"}
                  iconTint={draft.include ? "makan" : "muted"}
                  thumb={
                    crops[index] ? (
                      <Image
                        source={{ uri: crops[index] as string }}
                        style={styles.cropThumb}
                        accessibilityLabel={`Potongan ${item.name}`}
                      />
                    ) : undefined
                  }
                  title={item.name}
                  subtitle={[
                    meta,
                    item.protein !== undefined ||
                    item.carbs !== undefined ||
                    item.fat !== undefined ||
                    item.fiber !== undefined
                      ? `P ${Math.round(item.protein ?? 0)} · K ${Math.round(item.carbs ?? 0)} · L ${Math.round(item.fat ?? 0)} · S ${Math.round(item.fiber ?? 0)} g`
                      : null,
                  ]
                    .filter(Boolean)
                    .join("\n")}
                  right={
                    <View style={styles.kcalEdit}>
                      <Input
                        value={draft.kcal}
                        keyboardType="number-pad"
                        onChangeText={(text) =>
                          setDrafts((prev) =>
                            prev.map((d, i) => (i === index ? { ...d, kcal: text } : d)),
                          )
                        }
                        style={styles.kcalInput}
                      />
                      <Text style={styles.kcalUnit}>kcal</Text>
                    </View>
                  }
                  onPress={() =>
                    setDrafts((prev) =>
                      prev.map((d, i) => (i === index ? { ...d, include: !d.include } : d)),
                    )
                  }
                />
              );
            })}
          </ListGroup>

          <View style={styles.mealBlock}>
            <Text style={styles.mealLabel}>Catat sebagai</Text>
            <Segmented
              options={MEAL_KEYS.map((key) => ({ value: key, label: MEAL_SHORT[key] }))}
              value={meal}
              onChange={(value) => setMeal(value)}
            />
          </View>

          <PlateFields values={plateValues} onChange={setPlateValues} />

          {flowError ? <Text style={styles.errorText}>{flowError}</Text> : null}
          <Button
            label={includedCount > 0 ? `Simpan ${includedCount} item` : "Pilih minimal satu item"}
            disabled={includedCount === 0}
            onPress={() => void saveIncluded()}
            loading={addScan.isPending}
          />
          <Button variant="secondary" label="Foto Ulang" onPress={resetToCamera} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ---- Done phase ----
  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.doneBody}>
        <View style={[styles.doneIcon, { backgroundColor: theme.colors.makanSoft }]}>
          <Ionicons name="checkmark" size={34} color={theme.colors.makanText} />
        </View>
        <Text style={styles.doneTitle}>Tercatat!</Text>
        <Text style={styles.doneText}>Makanan dari foto sudah masuk ke catatan hari ini.</Text>
        <View style={styles.doneActions}>
          <Button label="Lihat Daftar Makanan" onPress={() => router.replace("/makan")} />
          <Button variant="secondary" label="Foto Lagi" onPress={resetToCamera} />
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create((theme) => ({
  permissionSafe: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  permissionBody: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing.md,
    paddingHorizontal: theme.spacing.xl,
  },
  permissionIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  permissionTitle: {
    fontSize: theme.fontSize.xl,
    fontWeight: "800",
    color: theme.colors.foreground,
  },
  permissionText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
    textAlign: "center",
    lineHeight: 21,
  },
  permissionAction: {
    minWidth: 220,
    marginTop: theme.spacing.sm,
  },

  cameraWrap: {
    flex: 1,
    backgroundColor: "#000000",
  },
  camera: {
    flex: 1,
  },
  closeButton: {
    position: "absolute",
    top: 56,
    right: 20,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(0,0,0,0.4)",
    alignItems: "center",
    justifyContent: "center",
  },
  shutterRow: {
    position: "absolute",
    bottom: 48,
    left: 0,
    right: 0,
    alignItems: "center",
    gap: 14,
  },
  shutterHint: {
    color: "#FFFFFF",
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    backgroundColor: "rgba(0,0,0,0.4)",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: theme.radius.pill,
    overflow: "hidden",
  },
  shutterOuter: {
    width: 78,
    height: 78,
    borderRadius: 39,
    borderWidth: 4,
    borderColor: "rgba(255,255,255,0.5)",
    alignItems: "center",
    justifyContent: "center",
  },
  shutter: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  shutterInner: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: theme.colors.primary,
  },
  shutterPressed: {
    opacity: 0.7,
  },
  disabled: {
    opacity: 0.35,
  },
  shutterActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 28,
  },
  galleryButton: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  analyzingCancel: {
    minHeight: 44,
    paddingHorizontal: theme.spacing.lg,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.radius.pill,
    backgroundColor: "rgba(255,255,255,0.15)",
  },
  analyzingCancelText: {
    color: "#FFFFFF",
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
  },
  analyzingOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  analyzingPreview: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  analyzingShade: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing.md,
  },
  analyzingText: {
    color: "#FFFFFF",
    fontSize: theme.fontSize.base,
    fontWeight: "600",
    textAlign: "center",
    paddingHorizontal: theme.spacing.xl,
  },
  cameraError: {
    position: "absolute",
    bottom: 160,
    left: theme.spacing.lg,
    right: theme.spacing.lg,
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.card,
    padding: theme.spacing.lg,
    gap: theme.spacing.sm,
  },
  cameraErrorText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
  },
  cameraErrorActions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: theme.spacing.lg,
  },
  cameraRetry: {
    minHeight: 44,
    justifyContent: "center",
  },
  cameraRetryPressed: {
    opacity: 0.7,
  },
  cameraRetryText: {
    color: theme.colors.primary,
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
  },
  cameraErrorDismiss: {
    color: theme.colors.mutedForeground,
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    textAlign: "right",
  },

  safeArea: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  confirmContent: {
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    gap: theme.spacing.md,
    paddingBottom: theme.spacing.xxl,
  },
  totalBlock: {
    alignItems: "center",
    gap: 4,
    paddingVertical: theme.spacing.sm,
  },
  totalLabel: {
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    color: theme.colors.mutedForeground,
  },
  totalValue: {
    fontSize: theme.fontSize.display,
    fontWeight: "800",
    letterSpacing: -2,
    color: theme.colors.foreground,
  },
  totalUnit: {
    fontSize: theme.fontSize.base,
    color: theme.colors.mutedForeground,
  },
  totalReaction: {
    fontSize: theme.fontSize.lg,
    fontWeight: "700",
    color: theme.colors.makanText,
    marginTop: 6,
    textAlign: "center",
  },
  totalGeprek: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
    marginTop: 2,
  },
  reviewPhotoBlock: {
    gap: theme.spacing.sm,
  },
  reviewPhoto: {
    width: "100%",
    height: 200,
    borderRadius: theme.radius.card,
    backgroundColor: theme.colors.muted,
  },
  cropRow: {
    flexDirection: "row",
    gap: theme.spacing.md,
    paddingHorizontal: 2,
    paddingVertical: 2,
  },
  cropTile: {
    width: 96,
    gap: 4,
  },
  cropImage: {
    width: 96,
    height: 96,
    borderRadius: theme.radius.card,
    backgroundColor: theme.colors.muted,
  },
  cropPending: {
    alignItems: "center",
    justifyContent: "center",
  },
  cropLabel: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.mutedForeground,
    textAlign: "center",
  },
  cropThumb: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: theme.colors.muted,
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
  mealBlock: {
    gap: theme.spacing.sm,
  },
  mealLabel: {
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    color: theme.colors.mutedForeground,
  },
  errorText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.destructive,
  },
  doneBody: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing.md,
    paddingHorizontal: theme.spacing.xl,
  },
  doneIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  doneTitle: {
    fontSize: theme.fontSize["2xl"],
    fontWeight: "800",
    color: theme.colors.foreground,
  },
  doneText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
    textAlign: "center",
    lineHeight: 20,
  },
  doneActions: {
    alignSelf: "stretch",
    gap: theme.spacing.md,
    marginTop: theme.spacing.md,
  },
}));
