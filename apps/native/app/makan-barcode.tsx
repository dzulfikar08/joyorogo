import "@/unistyles";
import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Image, Linking, Pressable, View } from "react-native";
import { KeyboardAwareScrollView, KeyboardStickyView } from "react-native-keyboard-controller";
import type { KeyboardAwareScrollViewRef } from "react-native-keyboard-controller";
import { SafeAreaView } from "react-native-safe-area-context";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { MEAL_LABELS, effectiveRamadan, jakartaToday, slotsFor, suggestMealNow } from "@joyorogo/api/lib/engine";
import { eatenAtClock, eatenAtFromClock } from "@joyorogo/api/lib/eaten-at";
import type { Meal } from "@joyorogo/api/lib/engine";
import { normalizeBarcode } from "@joyorogo/api/lib/barcode";
import { MAX_GRAMS, portionFromGrams } from "@joyorogo/api/lib/portion";
import { foodKind } from "@joyorogo/api/lib/food-kind";

import { Disclosure } from "@/components/disclosure";
import { EatenAtField } from "@/components/plate/eaten-at-field";
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
import { useCameraActive } from "@/src/lib/use-camera-active";
import { CONTENT_MAX_WIDTH, useLayout } from "@/src/lib/layout";
import { errorMessage, fmtInt, fmtKcalLabel, parseNum } from "@/utils/format";
import { FoodSafetyNotes } from "@/components/maternal/flag-notes";
import { KindPicker, SnackAdviceSection } from "@/components/makan/snack-advice";
import type { PickableKind } from "@/components/makan/snack-advice";
import { client, orpc, queryClient } from "@/utils/orpc";
import { ConfirmSheet } from "@/components/confirm-sheet";
import { fmtNumber } from "@joyorogo/i18n";
import { CommunityCheckCard, LabelFlow, LabelThanks } from "@/components/makan/label-flow";
import type { ContributeOutcome } from "@/components/makan/label-flow";

const ALL_MEAL_KEYS = Object.keys(MEAL_LABELS) as Meal[];

export default function MakanBarcode() {
  const { t } = useTranslation(["barcode", "makan", "common"]);
  const { theme } = useUnistyles();
  const gate = useSessionGate();
  // Day forwarded from the makan screen (same contract as makan-ai).
  const params = useLocalSearchParams<{ date?: string | string[]; meal?: string | string[] }>();
  const logDate = typeof params.date === "string" ? params.date : undefined;
  const startMeal = ALL_MEAL_KEYS.find((key) => key === params.meal);
  const [permission, requestPermission] = useCameraPermissions();
  const cameraActive = useCameraActive();
  const profile = useQuery(orpc.profile.myProfile.queryOptions());
  const ramadan = effectiveRamadan(profile.data?.profile?.ramadanMode);
  const MEAL_KEYS = ALL_MEAL_KEYS.filter((key) => slotsFor(ramadan).includes(key));
  const [meal, setMeal] = useState<Meal>(() => startMeal ?? suggestMealNow(new Date(), ramadan));

  const [code, setCode] = useState<string | null>(null);
  const [typing, setTyping] = useState(false);
  const lay = useLayout();
  // Measured height of the bottom panel: on a short window the viewfinder sits above it, not behind it.
  const [panelH, setPanelH] = useState(0);
  const [typed, setTyped] = useState("");
  const [scanError, setScanError] = useState<string | null>(null);
  // The camera fires many callbacks per second for one barcode; take the first.
  const handled = useRef(false);

  const [grams, setGrams] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  // Optional "Jam makan" (unix ms); null = now, nothing is sent.
  const [eatenAt, setEatenAt] = useState<number | null>(null);
  const [manualName, setManualName] = useState("");
  const [manualKcal, setManualKcal] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  // Item kind: the name heuristic until the user taps a pill. Advice only.
  const [kindOverride, setKindOverride] = useState<PickableKind | null>(null);
  // The field "Setengah porsi" rescaled, with its text before, so one tap undoes it.
  const [halfUndo, setHalfUndo] = useState<{ field: "grams" | "kcal"; value: string } | null>(null);
  const [saved, setSaved] = useState<{ name: string; kcal: number } | null>(null);
  const [labelOpen, setLabelOpen] = useState(false);
  const [thanks, setThanks] = useState<{ outcome: ContributeOutcome; contributors: number } | null>(
    null,
  );
  // The cutout of the pack photo the person chose to keep in the label flow (opt-in); it becomes the logged meal's sticker.
  const [keptSticker, setKeptSticker] = useState<string | null>(null);
  const scrollRef = useRef<KeyboardAwareScrollViewRef>(null);
  const bodyY = useRef(0);

  const lookup = useQuery({
    ...orpc.barcode.lookup.queryOptions({ input: { code: code ?? "" } }),
    enabled: code !== null,
    retry: false,
    staleTime: Infinity,
  });
  const addFood = useMutation(orpc.food.add.mutationOptions());
  // Same barcode logged again within 15 minutes: ask before adding a second row.
  const [repeatAsk, setRepeatAsk] = useState<{ name: string; ago: number; add: () => void } | null>(null);

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
    setEatenAt(null);
    setManualKcal("");
    setFormError(null);
    setSaved(null);
    setKindOverride(null);
    setLabelOpen(false);
    setThanks(null);
    setKeptSticker(null);
    setHalfUndo(null);
    setRepeatAsk(null);
    addFood.reset();
  };

  const accept = (raw: string) => {
    const normalized = normalizeBarcode(raw);
    if (!normalized) {
      setScanError(t("entry.invalid"));
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

  const eatenAtInput = () =>
    eatenAt === null
      ? {}
      : { eatenAt: eatenAtFromClock(logDate ?? jakartaToday(), eatenAtClock(eatenAt)) ?? undefined };

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
          <Text style={styles.doneTitle}>{t("done.title")}</Text>
          <Text style={styles.doneText}>
            {t("done.text", {
              name: saved.name,
              kcal: fmtKcalLabel(saved.kcal),
              meal: MEAL_LABELS[meal],
            })}
          </Text>
          <View style={styles.doneActions}>
            <Button label={t("done.viewList")} onPress={() => router.replace("/makan")} />
            <Button variant="secondary" label={t("done.scanAgain")} onPress={reset} />
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
        setFormError(t("manual.nameRequired"));
        return;
      }
      if (kcal === null || kcal < 0) {
        setFormError(t("manual.kcalRequired"));
        return;
      }
      setFormError(null);
      addFood.mutate(
        { ...(logDate ? { date: logDate } : {}), meal, name, kcal, source: "manual", ...eatenAtInput() },
        { onSuccess: () => finishSave(name, kcal) },
      );
    };

    const mealPicker =
      MEAL_KEYS.length > 1 ? (
        <Segmented
          options={MEAL_KEYS.map((key) => ({
            value: key,
            label: t(`makan:diary.mealShort.${key}`),
          }))}
          value={meal}
          onChange={setMeal}
        />
      ) : null;

    const manualKind = kindOverride ?? foodKind(manualName);
    const undoHalf = () => {
      if (!halfUndo) return;
      if (halfUndo.field === "kcal") setManualKcal(halfUndo.value);
      else setGrams(halfUndo.value);
      setHalfUndo(null);
    };

    const fallback = (
      <View style={styles.block}>
        <Button label={t("fallback.label")} icon="camera-outline" onPress={() => setLabelOpen(true)} />
        <Disclosure plain title={t("result.notes")}>
          <Text style={styles.caption}>{t("fallback.labelNote")}</Text>
        </Disclosure>
        <Button
          variant="secondary"
          label={t("fallback.photo")}
          icon="camera-outline"
          onPress={photoScan}
        />
        <Disclosure plain title={t("fallback.notes")}>
          <Text style={styles.caption}>{t("fallback.photoNote")}</Text>
        </Disclosure>
        {manualOpen ? (
          <View style={styles.block}>
            <Field label={t("manual.name")}>
              <Input
                value={manualName}
                onChangeText={setManualName}
                placeholder={t("manual.namePlaceholder")}
              />
            </Field>
            <Field label={t("manual.kcal")}>
              <Input
                value={manualKcal}
                onChangeText={setManualKcal}
                keyboardType="number-pad"
                placeholder="350"
              />
            </Field>
            <KindPicker value={manualKind} onChange={setKindOverride} />
            <SnackAdviceSection
              date={logDate}
              kcal={parseNum(manualKcal) ?? 0}
              kind={manualKind}
              slot={meal}
              name={manualName.trim() || undefined}
              onHalf={() => {
                const kcal = parseNum(manualKcal);
                if (kcal === null) return;
                setHalfUndo({ field: "kcal", value: manualKcal });
                setManualKcal(String(Math.round(kcal / 2)));
              }}
              halfApplied={halfUndo !== null}
              onUndoHalf={undoHalf}
            />
            <FoodSafetyNotes names={manualName.trim() ? [manualName.trim()] : []} addToDay />
            {mealPicker}
            <EatenAtField date={logDate ?? jakartaToday()} meal={meal} value={eatenAt} onChange={setEatenAt} />
            {formError ? <Text style={styles.errorText}>{formError}</Text> : null}
            {addFood.isError ? (
              <Text style={styles.errorText}>{errorMessage(addFood.error)}</Text>
            ) : null}
            <Button label={t("save.button")} onPress={saveManual} loading={addFood.isPending} />
          </View>
        ) : (
          <Button
            variant="secondary"
            label={t("fallback.manual")}
            onPress={() => {
              setManualName(product?.name ?? "");
              setManualOpen(true);
            }}
          />
        )}
        <Button variant="ghost" label={t("fallback.scanAnother")} onPress={reset} />
      </View>
    );

    let body: React.ReactNode;
    if (lookup.isPending) {
      body = (
        <View style={styles.centerBlock}>
          <Text style={styles.loadingText}>{t("lookup.searching", { code })}</Text>
        </View>
      );
    } else if (lookup.isError || !data) {
      body = (
        <View style={styles.block}>
          <Text style={styles.title}>{t("lookup.failed.title")}</Text>
          <Text style={styles.caption}>{errorMessage(lookup.error)}</Text>
          <Button label={t("common:actions.retry")} onPress={() => void lookup.refetch()} />
          {fallback}
        </View>
      );
    } else if (data.status === "not_found") {
      body = (
        <View style={styles.block}>
          <Text style={styles.title}>{t("lookup.notFound.title")}</Text>
          <Text style={styles.caption}>{t("lookup.notFound.body", { code: data.code })}</Text>
          {fallback}
        </View>
      );
    } else if (data.status === "incomplete") {
      body = (
        <View style={styles.block}>
          <Text style={styles.title}>{data.product.name}</Text>
          <Text style={styles.caption}>
            {t("lookup.incomplete.body", {
              reason: t(`lookup.incomplete.reason.${data.reason}`),
            })}
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
      const servingLabel = data.servingSize ? `${fmtInt(data.servingSize)} ${unit}` : "";
      const save = async () => {
        if (!scaled || !gramsOk) {
          setFormError(t("quantity.range", { max: MAX_GRAMS, unit }));
          return;
        }
        setFormError(null);
        const add = () =>
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
              ...(keptSticker ? { scanId: keptSticker } : {}),
              ...eatenAtInput(),
              itemsJson: JSON.stringify({
                barcode: data.code,
                brand: data.product.brand,
                source: data.source,
              }),
            },
            { onSuccess: () => finishSave(data.product.name, scaled.kcal) },
          );
        try {
          const { loggedAt } = await client.barcode.recentLog({ code: data.code });
          if (loggedAt !== null) {
            setRepeatAsk({
              name: data.product.name,
              ago: Math.max(1, Math.round((Date.now() - loggedAt) / 60_000)),
              add,
            });
            return;
          }
        } catch {
          // The guard is a courtesy; never block logging on it.
        }
        add();
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
                <Ionicons name="barcode-outline" size={24} color={theme.colors.mutedForeground} />
              </View>
            )}
            <View style={styles.flexOne}>
              <Text style={styles.title}>{data.product.name}</Text>
              <Text style={styles.caption}>
                {[data.product.brand, data.product.quantity].filter(Boolean).join(" · ") ||
                  t("result.unknownProduct", { code: data.code })}
              </Text>
            </View>
          </View>

          <Card style={styles.infoCard}>
            <View style={styles.nutriRow}>
              <View style={styles.nutriCol}>
                <Text style={styles.infoLabel}>{t("result.per100", { unit })}</Text>
                <Num style={styles.infoKcal}>{fmtKcalLabel(base.kcal)}</Num>
                <MacroLine
                  protein={base.protein}
                  carbs={base.carbs}
                  fat={base.fat}
                  fiber={base.fiber}
                />
              </View>
              {data.perServing && data.servingSize ? (
                <View style={styles.nutriCol}>
                  <Text style={styles.infoLabel}>
                    {t("result.perServing", { size: servingLabel })}
                  </Text>
                  <Num style={styles.infoKcal}>{fmtKcalLabel(data.perServing.kcal)}</Num>
                  <MacroLine
                    protein={data.perServing.protein}
                    carbs={data.perServing.carbs}
                    fat={data.perServing.fat}
                    fiber={data.perServing.fiber}
                  />
                </View>
              ) : null}
            </View>
          </Card>
          {data.sugar100 !== null ? (
            <Text style={styles.caption}>
              {t("result.sugar", { value: fmtNumber(data.sugar100, 1), unit })}
            </Text>
          ) : null}
          {data.kcalFromMacros ? <Text style={styles.caption}>{t("result.kcalFromMacros")}</Text> : null}
          {data.source === "label_photo" && data.mine !== true ? (
            <CommunityCheckCard code={data.code} onWrong={() => setLabelOpen(true)} />
          ) : null}

          <Field label={t("quantity.label", { unit })}>
            <Input
              value={gramsText}
              onChangeText={setGrams}
              keyboardType="decimal-pad"
              accessibilityLabel={t("quantity.aria", { unit })}
            />
          </Field>
          <View style={styles.chipRow}>
            {data.servingSize ? (
              <Chip
                label={t("quantity.serving", { size: servingLabel })}
                selected={gramsNum === data.servingSize}
                onPress={() => setGrams(String(data.servingSize))}
              />
            ) : null}
            <Chip
              label={t("quantity.hundred", { unit })}
              selected={gramsNum === 100}
              onPress={() => setGrams("100")}
            />
          </View>

          {scaled ? (
            <View style={styles.totalBlock}>
              <Text style={styles.infoLabel}>{t("total.label")}</Text>
              <Num style={styles.totalValue}>{fmtKcalLabel(scaled.kcal)}</Num>
              <MacroLine
                protein={scaled.protein}
                carbs={scaled.carbs}
                fat={scaled.fat}
                fiber={scaled.fiber}
              />
            </View>
          ) : (
            <Text style={styles.errorText}>{t("quantity.range", { max: MAX_GRAMS, unit })}</Text>
          )}

          {mealPicker}
          <EatenAtField date={logDate ?? jakartaToday()} meal={meal} value={eatenAt} onChange={setEatenAt} />
          {formError ? <Text style={styles.errorText}>{formError}</Text> : null}
          {addFood.isError ? (
            <Text style={styles.errorText}>{errorMessage(addFood.error)}</Text>
          ) : null}
          <Button
            label={t("save.button")}
            onPress={save}
            loading={addFood.isPending}
            disabled={!gramsOk}
          />

          <KindPicker value={kindOverride ?? foodKind(data.product.name)} onChange={setKindOverride} />
          <SnackAdviceSection
            date={logDate}
            kcal={scaled?.kcal ?? 0}
            kind={kindOverride ?? foodKind(data.product.name)}
            slot={meal}
            name={data.product.name}
            onHalf={() => {
              if (gramsNum === null) return;
              setHalfUndo({ field: "grams", value: gramsText });
              setGrams(String(Math.max(1, Math.round(gramsNum / 2))));
            }}
            halfApplied={halfUndo !== null}
            onUndoHalf={undoHalf}
          />
          <FoodSafetyNotes names={[data.product.name]} addToDay />
          <Button variant="ghost" label={t("fallback.scanAnother")} onPress={reset} />
          <Disclosure plain title={t("result.notes")}>
            <View style={styles.block}>
              {data.missing.length > 0 ? (
                <Text style={styles.caption}>
                  {t("result.missing", {
                    fields: data.missing.map((key) => t(`macro.${key}`)).join(", "),
                  })}
                </Text>
              ) : null}
              <Text style={styles.caption}>
                {data.source === "off"
                  ? t("result.sources.off")
                  : data.source === "label_photo"
                    ? data.contributors >= 2
                      ? t("result.sources.labelPhotoConfirmed", { count: data.contributors })
                      : t("result.sources.labelPhoto")
                    : data.source === "usda"
                      ? t("result.sources.usda")
                      : t("result.sources.other", { source: data.source })}
              </Text>
              {data.source === "off" ? (
                <Button
                  variant="ghost"
                  label={t("result.sources.offLink")}
                  onPress={() => void Linking.openURL(`https://world.openfoodfacts.org/product/${data.code}`)}
                />
              ) : null}
            </View>
          </Disclosure>
        </View>
      );
    }

    if (labelOpen) {
      body = (
        <LabelFlow
          code={code}
          initial={product ?? undefined}
          onCancel={() => setLabelOpen(false)}
          onSaved={(response, stickerScanId) => {
            setLabelOpen(false);
            setKeptSticker(stickerScanId);
            setThanks({ outcome: response.outcome, contributors: response.contributors });
          }}
        />
      );
    }
    return (
      <SafeAreaView style={styles.safeArea}>
        <KeyboardAwareScrollView
          ref={scrollRef}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.topRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("page.backToScanner")}
              onPress={reset}
              hitSlop={8}
              style={styles.backButton}
            >
              <Ionicons name="chevron-back" size={24} color={theme.colors.foreground} />
            </Pressable>
            <Text style={styles.screenTitle}>{t("page.resultTitle")}</Text>
          </View>
          {thanks ? (
            <LabelThanks
              outcome={thanks.outcome}
              contributors={thanks.contributors}
              onContinue={() => scrollRef.current?.scrollTo({ y: bodyY.current, animated: true })}
            />
          ) : null}
          <View onLayout={(event) => (bodyY.current = event.nativeEvent.layout.y)}>{body}</View>
        </KeyboardAwareScrollView>
        <ConfirmSheet
          visible={repeatAsk !== null}
          onClose={() => setRepeatAsk(null)}
          title={t("repeat.title", { ago: repeatAsk?.ago ?? 0 })}
          message={t("repeat.body", { name: repeatAsk?.name ?? "", ago: repeatAsk?.ago ?? 0 })}
          confirmLabel={t("repeat.confirm")}
          cancelLabel={t("repeat.cancel")}
          destructive={false}
          onConfirm={() => {
            const add = repeatAsk?.add;
            setRepeatAsk(null);
            add?.();
          }}
        />
      </SafeAreaView>
    );
  }

  // ---- Scanner ----
  const typedPanel = (
    <View style={styles.typePanel}>
      <Field label={t("entry.number")}>
        <Input
          value={typed}
          onChangeText={setTyped}
          keyboardType="number-pad"
          placeholder="8996001600146"
          maxLength={20}
          accessibilityLabel={t("entry.number")}
          onSubmitEditing={() => accept(typed)}
        />
      </Field>
      {scanError ? <Text style={styles.errorText}>{scanError}</Text> : null}
      <Button label={t("entry.search")} onPress={() => accept(typed)} disabled={typed.trim() === ""} />
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
              accessibilityLabel={t("common:actions.close")}
              onPress={() => router.back()}
              hitSlop={8}
              style={styles.backButton}
            >
              <Ionicons name="close" size={24} color={theme.colors.foreground} />
            </Pressable>
            <Text style={styles.screenTitle}>{t("page.title")}</Text>
          </View>
          <View style={styles.block}>
            <Text style={styles.title}>{t("camera.permissionTitle")}</Text>
            <Disclosure plain title={t("camera.notes")}>
              <Text style={styles.caption}>{t("camera.privacyNative")}</Text>
            </Disclosure>
            <Button label={t("camera.grant")} onPress={() => void requestPermission()} />
            <Text style={styles.caption}>{t("camera.orType")}</Text>
            {typedPanel}
          </View>
        </KeyboardAwareScrollView>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.cameraWrap}>
      {cameraActive ? (
        <CameraView
          style={styles.camera}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ["ean13", "ean8", "upc_a"] }}
          onBarcodeScanned={onScanned}
        />
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("camera.close")}
        onPress={() => router.back()}
        style={styles.closeButton}
      >
        <Ionicons name="close" size={24} color="#FFFFFF" />
      </Pressable>
      <View
        style={[styles.finderWrap, lay.short && { paddingBottom: panelH }]}
        pointerEvents="none"
      >
        <View style={styles.finder} />
      </View>
      {/* The panel is absolutely positioned at the bottom of the full-screen camera: it rides on top of
          the keyboard. A KeyboardAwareScrollView here (auto-height, not reaching under the keyboard)
          padded and scrolled its content out of view, leaving a blank panel. */}
      <KeyboardStickyView
        style={[
          styles.bottomPanel,
          // Wide windows: the panel is a centred card, not a full-width bar.
          { width: lay.contentWidth, alignSelf: "center" },
          lay.short && { paddingBottom: theme.spacing.lg },
        ]}
        offset={{ closed: 0, opened: 24 }}
        onLayout={(event) => setPanelH(event.nativeEvent.layout.height)}
      >
        {typing ? (
          typedPanel
        ) : (
          <>
            <Text style={styles.hint}>{scanError ?? t("camera.aim")}</Text>
            <Button
              variant="secondary"
              label={t("entry.type")}
              icon="keypad-outline"
              onPress={() => setTyping(true)}
            />
          </>
        )}
      </KeyboardStickyView>
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
    "@sm": {
      maxWidth: CONTENT_MAX_WIDTH,
      alignSelf: "center",
      width: "100%",
    },
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
    width: 56,
    height: 56,
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
  nutriRow: {
    flexDirection: "row",
    gap: theme.spacing.md,
  },
  nutriCol: {
    flex: 1,
    gap: 4,
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
    maxWidth: 420,
    height: 150,
    borderRadius: theme.radius.card,
    borderWidth: 3,
    borderColor: "rgba(255,255,255,0.85)",
  },
  bottomPanel: {
    position: "absolute",
    bottom: 0,
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
