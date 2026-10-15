import "@/unistyles";
import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useRef, useState } from "react";
import { Image, Pressable, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { SafeAreaView } from "react-native-safe-area-context";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { MEAL_LABELS, effectiveRamadan, slotsFor, suggestMealNow } from "@joyorogo/api/lib/engine";
import type { Meal } from "@joyorogo/api/lib/engine";
import { normalizeBarcode } from "@joyorogo/api/lib/barcode";
import { MAX_GRAMS, portionFromGrams } from "@joyorogo/api/lib/portion";

import { MacroLine } from "@/components/macro-line";
import {
  BootLoader,
  Button,
  Card,
  Chip,
  Field,
  Input,
  Num,
  Segmented,
  Text,
} from "@/components/ui";
import { useSessionGate } from "@/lib/use-session-gate";
import { errorMessage, fmtKcal, parseNum } from "@/utils/format";
import { orpc, queryClient } from "@/utils/orpc";

const ALL_MEAL_KEYS = Object.keys(MEAL_LABELS) as Meal[];

const MEAL_SHORT: Record<Meal, string> = {
  sarapan: "Sarapan",
  makan_siang: "Siang",
  makan_malam: "Malam",
  snack: "Snack",
  sahur: "Sahur",
  berbuka: "Berbuka",
};

const MACRO_NAMES = {
  protein: "protein",
  carbs: "karbo",
  fat: "lemak",
  fiber: "serat",
} as const;

export default function MakanBarcode() {
  const { theme } = useUnistyles();
  const gate = useSessionGate();
  // Day forwarded from the makan screen (same contract as makan-ai).
  const params = useLocalSearchParams<{ date?: string | string[]; meal?: string | string[] }>();
  const logDate = typeof params.date === "string" ? params.date : undefined;
  const startMeal = ALL_MEAL_KEYS.find((key) => key === params.meal);
  const [permission, requestPermission] = useCameraPermissions();
  const profile = useQuery(orpc.profile.myProfile.queryOptions());
  const ramadan = effectiveRamadan(profile.data?.profile?.ramadanMode);
  const MEAL_KEYS = ALL_MEAL_KEYS.filter((key) => slotsFor(ramadan).includes(key));
  const [meal, setMeal] = useState<Meal>(() => startMeal ?? suggestMealNow(new Date(), ramadan));

  const [code, setCode] = useState<string | null>(null);
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState("");
  const [scanError, setScanError] = useState<string | null>(null);
  // The camera fires many callbacks per second for one barcode; take the first.
  const handled = useRef(false);

  const [grams, setGrams] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualName, setManualName] = useState("");
  const [manualKcal, setManualKcal] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ name: string; kcal: number } | null>(null);

  const lookup = useQuery({
    ...orpc.barcode.lookup.queryOptions({ input: { code: code ?? "" } }),
    enabled: code !== null,
    retry: false,
    staleTime: Infinity,
  });
  const addFood = useMutation(orpc.food.add.mutationOptions());

  if (gate === "loading" || permission === null) return <BootLoader />;
  if (gate === "anon") return <Redirect href="/login" />;

  const reset = () => {
    handled.current = false;
    setCode(null);
    setTyping(false);
    setTyped("");
    setScanError(null);
    setGrams(null);
    setManualOpen(false);
    setManualName("");
    setManualKcal("");
    setFormError(null);
    setSaved(null);
    addFood.reset();
  };

  const accept = (raw: string) => {
    const normalized = normalizeBarcode(raw);
    if (!normalized) {
      setScanError("Nomor barcode tidak valid. Cek lagi angkanya.");
      // Let the camera try again shortly; a misread should not lock the screen.
      setTimeout(() => {
        handled.current = false;
      }, 1500);
      return;
    }
    setScanError(null);
    setCode(normalized);
  };

  const onScanned = ({ data }: { data: string }) => {
    if (handled.current) return;
    handled.current = true;
    accept(data);
  };

  const finishSave = (name: string, kcal: number) => {
    queryClient.invalidateQueries();
    setSaved({ name, kcal });
  };

  const photoScan = () =>
    router.replace(logDate ? { pathname: "/makan-ai", params: { date: logDate } } : "/makan-ai");

  // ---- Done ----
  if (saved) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.doneBody}>
          <View style={[styles.doneIcon, { backgroundColor: theme.colors.makanSoft }]}>
            <Ionicons name="checkmark" size={34} color={theme.colors.makanText} />
          </View>
          <Text style={styles.doneTitle}>Tercatat!</Text>
          <Text style={styles.doneText}>
            {`${saved.name} (${fmtKcal(saved.kcal)} kcal) sudah masuk ke ${MEAL_LABELS[meal]}.`}
          </Text>
          <View style={styles.doneActions}>
            <Button label="Lihat Daftar Makanan" onPress={() => router.replace("/makan")} />
            <Button variant="secondary" label="Pindai Lagi" onPress={reset} />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // ---- Result (lookup in flight, failed, or answered) ----
  if (code !== null) {
    const data = lookup.data;
    const product = data && data.status !== "not_found" ? data.product : null;
    const unit = product?.unit ?? "g";

    const saveManual = () => {
      const name = manualName.trim();
      const kcal = parseNum(manualKcal);
      if (name === "") {
        setFormError("Isi dulu nama makanannya.");
        return;
      }
      if (kcal === null || kcal < 0) {
        setFormError("Isi jumlah kalorinya, contoh: 350.");
        return;
      }
      setFormError(null);
      addFood.mutate(
        { ...(logDate ? { date: logDate } : {}), meal, name, kcal, source: "manual" },
        { onSuccess: () => finishSave(name, kcal) },
      );
    };

    const mealPicker =
      MEAL_KEYS.length > 1 ? (
        <Segmented
          options={MEAL_KEYS.map((key) => ({ value: key, label: MEAL_SHORT[key] }))}
          value={meal}
          onChange={setMeal}
        />
      ) : null;

    const fallback = (
      <View style={styles.block}>
        <Button
          label="Foto produknya, AI perkirakan"
          icon="camera-outline"
          onPress={photoScan}
        />
        <Text style={styles.caption}>
          AI memperkirakan dari foto, bukan membaca angka di label. Kalau kamu punya angka dari
          label, isi sendiri.
        </Text>
        {manualOpen ? (
          <View style={styles.block}>
            <Field label="Nama makanan">
              <Input value={manualName} onChangeText={setManualName} placeholder="Nama produk" />
            </Field>
            <Field label="Kalori (kcal)">
              <Input
                value={manualKcal}
                onChangeText={setManualKcal}
                keyboardType="number-pad"
                placeholder="350"
              />
            </Field>
            {mealPicker}
            {formError ? <Text style={styles.errorText}>{formError}</Text> : null}
            {addFood.isError ? (
              <Text style={styles.errorText}>{errorMessage(addFood.error)}</Text>
            ) : null}
            <Button label="Catat" onPress={saveManual} loading={addFood.isPending} />
          </View>
        ) : (
          <Button
            variant="secondary"
            label="Isi kalori sendiri"
            onPress={() => {
              setManualName(product?.name ?? "");
              setManualOpen(true);
            }}
          />
        )}
        <Button variant="ghost" label="Pindai barcode lain" onPress={reset} />
      </View>
    );

    let body: React.ReactNode;
    if (lookup.isPending) {
      body = (
        <View style={styles.centerBlock}>
          <Text style={styles.loadingText}>Mencari {code} di Open Food Facts…</Text>
        </View>
      );
    } else if (lookup.isError || !data) {
      body = (
        <View style={styles.block}>
          <Text style={styles.title}>Pencarian gagal</Text>
          <Text style={styles.caption}>{errorMessage(lookup.error)}</Text>
          <Button label="Coba lagi" onPress={() => void lookup.refetch()} />
          {fallback}
        </View>
      );
    } else if (data.status === "not_found") {
      body = (
        <View style={styles.block}>
          <Text style={styles.title}>Produk belum ada di Open Food Facts</Text>
          <Text style={styles.caption}>
            {`Barcode ${data.code} belum terdaftar di basis data komunitas itu, jadi kami tidak punya angka gizinya. Kamu bisa foto produknya atau isi kalorinya sendiri.`}
          </Text>
          {fallback}
        </View>
      );
    } else if (data.status === "incomplete") {
      body = (
        <View style={styles.block}>
          <Text style={styles.title}>{data.product.name}</Text>
          <Text style={styles.caption}>
            {`${data.reason} Karena itu produk ini tidak kami catat otomatis. Kamu bisa foto produknya atau isi kalorinya sendiri dari label.`}
          </Text>
          {fallback}
        </View>
      );
    } else {
      const base = data.per100;
      const gramsText = grams ?? String(data.servingSize ?? 100);
      const gramsNum = parseNum(gramsText);
      const gramsOk = gramsNum !== null && gramsNum >= 1 && gramsNum <= MAX_GRAMS;
      const scaled = gramsOk ? portionFromGrams(base, gramsNum) : null;
      const save = () => {
        if (!scaled || !gramsOk) {
          setFormError(`Isi takaran antara 1 dan ${MAX_GRAMS} ${unit}.`);
          return;
        }
        setFormError(null);
        addFood.mutate(
          {
            ...(logDate ? { date: logDate } : {}),
            meal,
            name: data.product.name,
            grams: scaled.grams ?? gramsNum,
            kcal: scaled.kcal,
            ...(scaled.protein !== null ? { protein: scaled.protein } : {}),
            ...(scaled.carbs !== null ? { carbs: scaled.carbs } : {}),
            ...(scaled.fat !== null ? { fat: scaled.fat } : {}),
            ...(scaled.fiber !== null ? { fiber: scaled.fiber } : {}),
            source: "barcode",
            itemsJson: JSON.stringify({
              barcode: data.code,
              brand: data.product.brand,
              source: "openfoodfacts",
            }),
          },
          { onSuccess: () => finishSave(data.product.name, scaled.kcal) },
        );
      };
      body = (
        <View style={styles.block}>
          <View style={styles.productHead}>
            {data.product.imageUrl ? (
              <Image
                source={{ uri: data.product.imageUrl }}
                style={styles.productImage}
                accessibilityIgnoresInvertColors
              />
            ) : (
              <View style={[styles.productImage, styles.productImageEmpty]}>
                <Ionicons name="barcode-outline" size={28} color={theme.colors.mutedForeground} />
              </View>
            )}
            <View style={styles.flexOne}>
              <Text style={styles.title}>{data.product.name}</Text>
              <Text style={styles.caption}>
                {[data.product.brand, data.product.quantity].filter(Boolean).join(" · ") ||
                  `Barcode ${data.code}`}
              </Text>
            </View>
          </View>

          <Card style={styles.infoCard}>
            <Text style={styles.infoLabel}>{`Per 100 ${unit}`}</Text>
            <Num style={styles.infoKcal}>{`${fmtKcal(base.kcal)} kcal`}</Num>
            <MacroLine
              protein={base.protein}
              carbs={base.carbs}
              fat={base.fat}
              fiber={base.fiber}
            />
            {data.perServing && data.servingSize ? (
              <>
                <Text style={[styles.infoLabel, styles.infoGap]}>
                  {`Per sajian (${fmtKcal(data.servingSize)} ${unit})`}
                </Text>
                <Num style={styles.infoKcal}>{`${fmtKcal(data.perServing.kcal)} kcal`}</Num>
                <MacroLine
                  protein={data.perServing.protein}
                  carbs={data.perServing.carbs}
                  fat={data.perServing.fat}
                  fiber={data.perServing.fiber}
                />
              </>
            ) : null}
          </Card>

          {data.missing.length > 0 ? (
            <Text style={styles.caption}>
              {`Open Food Facts belum punya data ${data.missing
                .map((key) => MACRO_NAMES[key])
                .join(", ")} untuk produk ini; yang kosong dicatat sebagai tidak diketahui, bukan nol.`}
            </Text>
          ) : null}

          <Field label={`Berapa banyak yang kamu makan (${unit})`}>
            <Input
              value={gramsText}
              onChangeText={setGrams}
              keyboardType="decimal-pad"
              accessibilityLabel={`Takaran dalam ${unit}`}
            />
          </Field>
          <View style={styles.chipRow}>
            {data.servingSize ? (
              <Chip
                label={`1 sajian · ${fmtKcal(data.servingSize)} ${unit}`}
                selected={gramsNum === data.servingSize}
                onPress={() => setGrams(String(data.servingSize))}
              />
            ) : null}
            <Chip
              label={`100 ${unit}`}
              selected={gramsNum === 100}
              onPress={() => setGrams("100")}
            />
          </View>

          {scaled ? (
            <View style={styles.totalBlock}>
              <Text style={styles.infoLabel}>Yang dicatat</Text>
              <Num style={styles.totalValue}>{`${fmtKcal(scaled.kcal)} kcal`}</Num>
              <MacroLine
                protein={scaled.protein}
                carbs={scaled.carbs}
                fat={scaled.fat}
                fiber={scaled.fiber}
              />
            </View>
          ) : null}

          {mealPicker}
          {formError ? <Text style={styles.errorText}>{formError}</Text> : null}
          {addFood.isError ? (
            <Text style={styles.errorText}>{errorMessage(addFood.error)}</Text>
          ) : null}
          <Button label="Catat" onPress={save} loading={addFood.isPending} disabled={!gramsOk} />
          <Button variant="ghost" label="Pindai barcode lain" onPress={reset} />
          <Text style={styles.caption}>
            Sumber: Open Food Facts, basis data komunitas. Angkanya bisa beda dari label kemasanmu;
            cek lagi kalau ragu.
          </Text>
        </View>
      );
    }

    return (
      <SafeAreaView style={styles.safeArea}>
        <KeyboardAwareScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.topRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Kembali ke pemindai"
              onPress={reset}
              hitSlop={8}
              style={styles.backButton}
            >
              <Ionicons name="chevron-back" size={24} color={theme.colors.foreground} />
            </Pressable>
            <Text style={styles.screenTitle}>Hasil Barcode</Text>
          </View>
          {body}
        </KeyboardAwareScrollView>
      </SafeAreaView>
    );
  }

  // ---- Scanner ----
  const typedPanel = (
    <View style={styles.typePanel}>
      <Field label="Nomor barcode">
        <Input
          value={typed}
          onChangeText={setTyped}
          keyboardType="number-pad"
          placeholder="8996001600146"
          maxLength={20}
          accessibilityLabel="Nomor barcode"
          onSubmitEditing={() => accept(typed)}
        />
      </Field>
      {scanError ? <Text style={styles.errorText}>{scanError}</Text> : null}
      <Button label="Cari" onPress={() => accept(typed)} disabled={typed.trim() === ""} />
    </View>
  );

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <KeyboardAwareScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.topRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Tutup"
              onPress={() => router.back()}
              hitSlop={8}
              style={styles.backButton}
            >
              <Ionicons name="close" size={24} color={theme.colors.foreground} />
            </Pressable>
            <Text style={styles.screenTitle}>Pindai Barcode</Text>
          </View>
          <View style={styles.block}>
            <Text style={styles.title}>Kamera dibutuhkan</Text>
            <Text style={styles.caption}>
              JoyoRogo butuh izin kamera untuk membaca barcode di kemasan. Barcode dibaca di
              perangkatmu; fotonya tidak dikirim ke mana pun.
            </Text>
            <Button label="Beri Izin Kamera" onPress={() => void requestPermission()} />
            <Text style={styles.caption}>Atau ketik nomornya:</Text>
            {typedPanel}
          </View>
        </KeyboardAwareScrollView>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.cameraWrap}>
      <CameraView
        style={styles.camera}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ["ean13", "ean8", "upc_a"] }}
        onBarcodeScanned={onScanned}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Tutup kamera"
        onPress={() => router.back()}
        style={styles.closeButton}
      >
        <Ionicons name="close" size={24} color="#FFFFFF" />
      </Pressable>
      <View style={styles.finderWrap} pointerEvents="none">
        <View style={styles.finder} />
      </View>
      <View style={styles.bottomPanel}>
        {typing ? (
          <KeyboardAwareScrollView keyboardShouldPersistTaps="handled">
            {typedPanel}
          </KeyboardAwareScrollView>
        ) : (
          <>
            <Text style={styles.hint}>
              {scanError ?? "Arahkan kamera ke barcode di kemasan"}
            </Text>
            <Button
              variant="secondary"
              label="Ketik nomor barcode"
              icon="keypad-outline"
              onPress={() => setTyping(true)}
            />
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  safeArea: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  content: {
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    gap: theme.spacing.md,
    paddingBottom: theme.spacing.xxl,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
  },
  backButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  screenTitle: {
    fontSize: theme.fontSize.lg,
    fontWeight: "800",
    color: theme.colors.foreground,
  },
  block: {
    gap: theme.spacing.md,
  },
  centerBlock: {
    alignItems: "center",
    paddingVertical: theme.spacing.xxl,
  },
  loadingText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
    textAlign: "center",
  },
  title: {
    fontSize: theme.fontSize.xl,
    fontWeight: "800",
    color: theme.colors.foreground,
  },
  caption: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
    lineHeight: 20,
  },
  errorText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.destructive,
  },
  flexOne: {
    flex: 1,
    gap: 2,
  },
  productHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
  },
  productImage: {
    width: 72,
    height: 72,
    borderRadius: theme.radius.card,
    backgroundColor: theme.colors.muted,
  },
  productImageEmpty: {
    alignItems: "center",
    justifyContent: "center",
  },
  infoCard: {
    gap: 4,
  },
  infoLabel: {
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    color: theme.colors.mutedForeground,
  },
  infoGap: {
    marginTop: theme.spacing.sm,
  },
  infoKcal: {
    fontSize: theme.fontSize.xl,
    fontWeight: "800",
    color: theme.colors.foreground,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing.sm,
  },
  totalBlock: {
    alignItems: "center",
    gap: 4,
    paddingVertical: theme.spacing.sm,
  },
  totalValue: {
    fontSize: theme.fontSize.title,
    fontWeight: "800",
    letterSpacing: -1,
    color: theme.colors.foreground,
  },
  typePanel: {
    gap: theme.spacing.md,
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
  finderWrap: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  finder: {
    width: "78%",
    height: 150,
    borderRadius: theme.radius.card,
    borderWidth: 3,
    borderColor: "rgba(255,255,255,0.85)",
  },
  bottomPanel: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    maxHeight: "60%",
    gap: theme.spacing.md,
    padding: theme.spacing.lg,
    paddingBottom: 40,
    backgroundColor: theme.colors.background,
    borderTopLeftRadius: theme.radius.card,
    borderTopRightRadius: theme.radius.card,
  },
  hint: {
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    color: theme.colors.foreground,
    textAlign: "center",
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
