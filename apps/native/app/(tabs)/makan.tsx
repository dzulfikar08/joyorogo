import "@/unistyles";
import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Pressable, ScrollView, View } from "react-native";
import { useEffect, useRef, useState } from "react";
import { Redirect, router } from "expo-router";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import {
  MEAL_LABELS,
  eatTone,
  effectiveRamadan,
  jakartaToday,
  macroTargets,
  relativeDayLabel,
  slotsFor,
  suggestMealNow,
} from "@joyorogo/api/lib/engine";
import type { Meal } from "@joyorogo/api/lib/engine";

import { BelanjaSection } from "@/components/plate/belanja";
import { PlateHeader } from "@/components/plate/plate-header";
import { Cerita } from "@/components/cerita";
import type { CeritaPhase } from "@/components/cerita";
import { FoodSticker, StickerViewer, stickerUrl } from "@/components/sticker";
import type { StickerViewerTarget } from "@/components/sticker";
import {
  BootLoader,
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorState,
  Field,
  Input,
  ListGroup,
  MacroBar,
  ListRow,
  Num,
  PageHeader,
  Ring,
  Screen,
  Segmented,
  Sheet,
  Skeleton,
  Text,
} from "@/components/ui";
import { useSessionGate } from "@/lib/use-session-gate";
import { ShareToFeedSheet } from "@/components/feed/share-to-feed";
import { errorMessage, fmtDateId, fmtKcal, parseNum } from "@/utils/format";
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

function shiftDate(date: string, days: number): string {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, 10);
}

/** Fields needed to re-add a deleted row verbatim via food.add. */
type UndoItem = {
  id: string;
  date: string;
  meal: string;
  name: string;
  kcal: number;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  fiber: number | null;
  source: string;
  itemsJson: string | null;
};

export default function Makan() {
  const { theme } = useUnistyles();
  const gate = useSessionGate();
  const today = jakartaToday();
  const [date, setDate] = useState(today);
  const isToday = date === today;

  const profile = useQuery(orpc.profile.myProfile.queryOptions());
  const ramadan = effectiveRamadan(profile.data?.profile?.ramadanMode);
  const MEAL_KEYS = ALL_MEAL_KEYS.filter((key) => slotsFor(ramadan).includes(key));

  const listQuery = useQuery({
    ...orpc.food.listByDate.queryOptions({ input: { date } }),
    placeholderData: (prev) => prev,
  });
  const summaryQuery = useQuery({
    ...orpc.day.summary.queryOptions({ input: { date } }),
    placeholderData: (prev) => prev,
  });
  const recentQuery = useQuery(orpc.food.recent.queryOptions());
  // Plate prices for the diary's plate grouping (plate.byDate) and inline edit.
  const plateDayQuery = useQuery({
    ...orpc.plate.byDate.queryOptions({ input: { date } }),
    placeholderData: (prev) => prev,
  });
  const updatePlate = useMutation(
    orpc.plate.update.mutationOptions({
      onSuccess: () => {
        setPlateEdit(null);
        queryClient.invalidateQueries();
      },
    }),
  );

  const [sheetMeal, setSheetMeal] = useState<Meal | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [ceritaPhase, setCeritaPhase] = useState<CeritaPhase>("input");
  const [ceritaOpen, setCeritaOpen] = useState(false);
  const [ceritaFeedback, setCeritaFeedback] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [kcal, setKcal] = useState("");
  const [protein, setProtein] = useState("");
  const [carbs, setCarbs] = useState("");
  const [fat, setFat] = useState("");
  const [macrosOpen, setMacrosOpen] = useState(false);
  // Manual form's optional plate price, and the diary's inline plate editor.
  const [platePriceManual, setPlatePriceManual] = useState("");
  const [plateEdit, setPlateEdit] = useState<{ id: string; name: string; price: string } | null>(
    null,
  );
  const [formError, setFormError] = useState<string | null>(null);
  const [viewer, setViewer] = useState<StickerViewerTarget | null>(null);
  const [shareTarget, setShareTarget] = useState<
    null | { kind: "makan"; refId: string; title: string; preview: string }
  >(null);
  const [undoItem, setUndoItem] = useState<UndoItem | null>(null);
  const quickAddRef = useRef(false);

  // Undo window: 6 s after a delete, same as the web toast.
  useEffect(() => {
    if (undoItem === null) return;
    const timer = setTimeout(() => setUndoItem(null), 6000);
    return () => clearTimeout(timer);
  }, [undoItem]);

  const addFood = useMutation(
    orpc.food.add.mutationOptions({
      onSuccess: () => {
        // The quick-add chips flip this ref so a half-typed manual entry
        // survives a one-tap add.
        if (!quickAddRef.current) {
          setName("");
          setKcal("");
          setProtein("");
          setCarbs("");
          setFat("");
          setPlatePriceManual("");
          setMacrosOpen(false);
        }
        quickAddRef.current = false;
        setFormError(null);
        queryClient.invalidateQueries();
      },
    }),
  );
  const removeFood = useMutation(
    orpc.food.remove.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries(),
    }),
  );

  /** Capture the row before removal so "Urungkan" can re-add it verbatim. */
  const handleDelete = (item: UndoItem) => {
    setUndoItem(item);
    removeFood.mutate({ id: item.id });
  };

  const undoDelete = () => {
    const item = undoItem;
    if (item === null) return;
    setUndoItem(null);
    addFood.mutate({
      date: item.date,
      meal: item.meal as Meal,
      name: item.name,
      kcal: item.kcal,
      protein: item.protein ?? undefined,
      carbs: item.carbs ?? undefined,
      fat: item.fat ?? undefined,
      fiber: item.fiber ?? undefined,
      source: item.source === "ai" ? "ai" : "manual",
      itemsJson: item.itemsJson ?? undefined,
    });
  };

  if (gate === "loading") {
    return <BootLoader />;
  }
  if (gate === "anon") {
    return <Redirect href="/login" />;
  }
  if (listQuery.isPending) {
    return (
      <Screen>
        <PageHeader title="Makan" />
        <Skeleton width="100%" height={52} radius={26} />
        <Skeleton width="100%" height={120} radius={24} />
        <Skeleton width="100%" height={160} radius={24} />
        <Skeleton width="100%" height={160} radius={24} />
      </Screen>
    );
  }
  if (listQuery.isError) {
    return (
      <Screen>
        <PageHeader title="Makan" />
        <ErrorState message={errorMessage(listQuery.error)} onRetry={() => listQuery.refetch()} />
      </Screen>
    );
  }

  const items = listQuery.data.items;
  const totals = listQuery.data.totals;
  const targets = summaryQuery.data?.targets ?? null;
  const eatenKcal = summaryQuery.data?.eatenKcal ?? totals.kcal;
  // Carb/fat/fiber floors from the engine; same reference as the web card.
  const macroBudgets = targets ? macroTargets(targets.eatKcal, 70) : null;

  const submit = () => {
    const meal = sheetMeal;
    if (meal === null) return;
    const kcalNum = parseNum(kcal);
    if (name.trim() === "") {
      setFormError("Isi dulu nama makanannya.");
      return;
    }
    if (kcalNum === null || kcalNum < 0) {
      setFormError("Isi jumlah kalorinya, contoh: 350.");
      return;
    }
    const proteinNum = parseNum(protein);
    const carbsNum = parseNum(carbs);
    const fatNum = parseNum(fat);
    const priceNum = platePriceManual.trim() === "" ? null : parseNum(platePriceManual);
    if (priceNum !== null && (priceNum < 0 || !Number.isInteger(priceNum))) {
      setFormError("Harga piringnya angka rupiah bulat, contoh: 28000.");
      return;
    }
    const plate =
      priceNum !== null ? { name: name.trim(), priceIdr: Math.round(priceNum) } : undefined;
    setFormError(null);
    addFood.mutate({
      meal,
      name: name.trim(),
      kcal: kcalNum,
      protein: proteinNum ?? undefined,
      carbs: carbsNum ?? undefined,
      fat: fatNum ?? undefined,
      ...(plate ? { plate } : {}),
    });
  };

  /** Day-named feedback after a story save, e.g. "2 makanan dicatat ke Hari ini dan Kemarin." */
  const showFeedback = (result: { count: number; dates: string[] }) => {
    const labels = result.dates.map((d) => relativeDayLabel(d, today));
    setCeritaFeedback(`${result.count} makanan dicatat ke ${labels.join(" dan ")}.`);
  };

  const closeSheet = () => {
    setSheetMeal(null);
    setFormError(null);
    setName("");
    setKcal("");
    setProtein("");
    setCarbs("");
    setFat("");
    setPlatePriceManual("");
    setMacrosOpen(false);
    setManualOpen(false);
    setCeritaPhase("input");
    quickAddRef.current = false;
  };

  const renderSlot = (key: Meal) => {
    const slotItems = items.filter((item) => item.meal === key);
    const slotKcal = slotItems.reduce((sum, item) => sum + item.kcal, 0);
    return (
      <View key={key}>
        <View style={styles.slotHeader}>
          <Text style={styles.slotTitle}>{MEAL_LABELS[key]}</Text>
          <View style={styles.slotRight}>
            {slotKcal > 0 ? <Num style={styles.slotKcal}>{fmtKcal(slotKcal)} kcal</Num> : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Tambah ${MEAL_LABELS[key]}`}
              onPress={() => {
                setSheetMeal(key);
                setFormError(null);
              }}
              style={({ pressed }) => [styles.slotAdd, pressed && styles.pressedSoft]}
            >
              <Ionicons name="add" size={20} color={theme.colors.primary} />
            </Pressable>
          </View>
        </View>
        {slotItems.length === 0 ? (
          <Text style={styles.slotEmpty}>
            Belum ada catatan. Tekan tambah di atas, atau pindai fotonya.
          </Text>
        ) : (
          <ListGroup>
            {slotItems
              .reduce<Array<{ plateId: string | null; rows: typeof slotItems }>>(
                (segments, item) => {
                  const last = segments[segments.length - 1];
                  if (item.plateId !== null && last?.plateId === item.plateId) {
                    last.rows.push(item);
                  } else {
                    segments.push({ plateId: item.plateId, rows: [item] });
                  }
                  return segments;
                },
                [],
              )
              .map((segment, segmentIndex) => {
                const plateRow =
                  segment.plateId !== null
                    ? ((plateDayQuery.data ?? []).find((row) => row.id === segment.plateId) ?? null)
                    : null;
                return (
                  <View key={segment.plateId ?? `plain-${segmentIndex}`}>
                    {plateRow ? (
                      <PlateHeader
                        plate={{
                          id: plateRow.id,
                          name: plateRow.name,
                          priceIdr: plateRow.priceIdr,
                        }}
                        edit={plateEdit}
                        onEdit={setPlateEdit}
                        onSave={(id, editName, price) => {
                          const priceNum = parseNum(price);
                          updatePlate.mutate({
                            id,
                            ...(editName.trim() !== "" ? { name: editName.trim() } : {}),
                            ...(price.trim() === ""
                              ? { priceIdr: null }
                              : priceNum !== null && priceNum >= 0
                                ? { priceIdr: Math.round(priceNum) }
                                : {}),
                          });
                        }}
                        saving={updatePlate.isPending}
                      />
                    ) : null}
                    {segment.rows.map((item) => (
                      <ListRow
                        key={item.id}
                        title={item.name}
                        subtitle={
                          item.protein !== null || item.carbs !== null || item.fat !== null
                            ? `P ${fmtKcal(item.protein ?? 0)} · K ${fmtKcal(item.carbs ?? 0)} · L ${fmtKcal(item.fat ?? 0)} g`
                            : item.source === "ai"
                              ? "Dari pindai AI"
                              : undefined
                        }
                        value={`${fmtKcal(item.kcal)}`}
                        thumb={
                          item.scanId ? (
                            <FoodSticker
                              scanId={item.scanId}
                              name={item.name}
                              onPress={() => {
                                const scanId = item.scanId;
                                if (!scanId) return;
                                setViewer({
                                  uri: stickerUrl(scanId),
                                  name: item.name,
                                  kcal: item.kcal,
                                  photoId: item.photoId,
                                  protein: item.protein,
                                  carbs: item.carbs,
                                  fat: item.fat,
                                });
                              }}
                            />
                          ) : undefined
                        }
                        right={
                          <View style={styles.rowActions}>
                            <Pressable
                              accessibilityRole="button"
                              accessibilityLabel={`Bagikan ${item.name} ke feed`}
                              onPress={() =>
                                setShareTarget({
                                  kind: "makan",
                                  refId: item.id,
                                  title: item.name,
                                  preview: `${fmtKcal(item.kcal)} kcal${
                                    item.protein !== null
                                      ? ` · P ${fmtKcal(item.protein ?? 0)}g`
                                      : ""
                                  }`,
                                })
                              }
                              style={({ pressed }) => [
                                styles.deleteButton,
                                pressed && styles.pressedSoft,
                              ]}
                            >
                              <Ionicons name="share-social-outline" size={18} />
                            </Pressable>
                            <Pressable
                              accessibilityRole="button"
                              accessibilityLabel={`Hapus ${item.name}`}
                              onPress={() => handleDelete(item)}
                              style={({ pressed }) => [
                                styles.deleteButton,
                                pressed && styles.pressedSoft,
                              ]}
                            >
                              <Ionicons
                                name="trash-outline"
                                size={18}
                                color={theme.colors.destructive}
                              />
                            </Pressable>
                          </View>
                        }
                      />
                    ))}
                  </View>
                );
              })}
          </ListGroup>
        )}
      </View>
    );
  };

  return (
    <Screen>
      <PageHeader title="Makan" caption={isToday ? "Catat piringmu" : undefined} />

      {/* Day switcher */}
      <View style={styles.dayRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Hari sebelumnya"
          onPress={() => setDate(shiftDate(date, -1))}
          style={({ pressed }) => [styles.dayArrow, pressed && styles.pressedSoft]}
        >
          <Ionicons name="chevron-back" size={20} color={theme.colors.foreground} />
        </Pressable>
        <Text style={styles.dayLabel}>
          {isToday ? "Hari ini" : date === shiftDate(today, -1) ? "Kemarin" : fmtDateId(date)}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Hari berikutnya"
          disabled={isToday}
          onPress={() => setDate(shiftDate(date, 1))}
          style={({ pressed }) => [
            styles.dayArrow,
            isToday && styles.disabled,
            pressed && styles.pressedSoft,
          ]}
        >
          <Ionicons name="chevron-forward" size={20} color={theme.colors.foreground} />
        </Pressable>
      </View>

      {/* Summary strip: ring + per-macro progress bars (same budgets as web) */}
      <Card style={styles.summaryCard}>
        <Ring
          size={110}
          stroke={12}
          value={eatenKcal}
          max={targets !== null && targets.eatKcal > 0 ? targets.eatKcal : Math.max(eatenKcal, 1)}
          color={
            {
              ok: theme.colors.makan,
              near: theme.colors.eatNear,
              over: theme.colors.destructive,
            }[eatTone(eatenKcal, targets?.eatKcal ?? 0)]
          }
          track={theme.colors.makanSoft}
        >
          <View style={styles.ringCenter}>
            <Num style={styles.ringKcal} adjustsFontSizeToFit numberOfLines={1}>
              {fmtKcal(eatenKcal)}
            </Num>
            <Text style={styles.ringUnit}>kcal</Text>
            {targets !== null && targets.eatKcal > 0 ? (
              <Text
                style={[
                  styles.ringTarget,
                  eatenKcal > targets.eatKcal && { color: theme.colors.bakarText },
                ]}
              >
                {eatenKcal > targets.eatKcal
                  ? `+${fmtKcal(eatenKcal - targets.eatKcal)} lebih`
                  : `dari ${fmtKcal(targets.eatKcal)}`}
              </Text>
            ) : null}
          </View>
        </Ring>
        <View style={styles.summaryInfo}>
          <MacroBar
            label="Protein"
            eaten={totals.protein}
            budget={summaryQuery.data?.protein?.targetG ?? null}
          />
          <MacroBar label="Karbo" eaten={totals.carbs} budget={macroBudgets?.carbsG ?? null} />
          <MacroBar label="Lemak" eaten={totals.fat} budget={macroBudgets?.fatG ?? null} />
          <MacroBar label="Serat" eaten={totals.fiber} budget={macroBudgets?.fiberG ?? null} />
        </View>
      </Card>

      {/* Belanja makan: pengeluaran + anggaran + nilai terbaik */}
      <BelanjaSection />

      {/* Global story entry: several meals, even another day, in one go */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Ceritakan makananmu"
        onPress={() => {
          setCeritaFeedback(null);
          setCeritaOpen(true);
        }}
        style={({ pressed }) => [styles.ceritaBar, pressed && styles.pressedSoft]}
      >
        <View style={styles.ceritaMic}>
          <Ionicons name="mic" size={20} color={theme.colors.primaryForeground} />
        </View>
        <View style={styles.ceritaTexts}>
          <Text style={styles.ceritaTitle}>Ceritakan makananmu</Text>
          <Text style={styles.ceritaSub}>Ketik atau ucapkan, AI yang hitung kalorinya.</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={theme.colors.mutedForeground} />
      </Pressable>

      {ceritaFeedback ? (
        <View style={styles.feedbackBox}>
          <Ionicons name="checkmark-circle" size={20} color={theme.colors.makanText} />
          <Text style={styles.feedbackText}>{ceritaFeedback}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Tutup pemberitahuan"
            onPress={() => setCeritaFeedback(null)}
            style={({ pressed }) => [styles.feedbackClose, pressed && styles.pressedSoft]}
          >
            <Ionicons name="close" size={18} color={theme.colors.makanText} />
          </Pressable>
        </View>
      ) : null}

      {undoItem ? (
        <View style={styles.undoBar}>
          <Text style={styles.undoText} numberOfLines={1}>
            {undoItem.name} dihapus.
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Urungkan hapus"
            onPress={undoDelete}
            style={({ pressed }) => [styles.undoAction, pressed && styles.pressedSoft]}
          >
            <Text style={styles.undoActionText}>Urungkan</Text>
          </Pressable>
        </View>
      ) : null}

      {items.length === 0 ? (
        <EmptyState
          icon="restaurant-outline"
          title="Belum ada makanan"
          description={`Catat makan pertamamu untuk ${isToday ? "hari ini" : fmtDateId(date)}, atau foto piringmu lewat tombol kamera.`}
          action={
            <Button
              label="Tambah makanan"
              icon="add"
              onPress={() => setSheetMeal(suggestMealNow(new Date(), ramadan))}
            />
          }
        />
      ) : (
        MEAL_KEYS.map(renderSlot)
      )}

      {/* Add form lives in a bottom sheet; Ceritakan leads, manual hides behind a toggle */}
      <Sheet
        visible={sheetMeal !== null}
        onClose={closeSheet}
        title="Tambah Makanan"
        footer={
          manualOpen ? (
            <Button
              label="Tambah"
              onPress={submit}
              loading={addFood.isPending}
              disabled={sheetMeal === null}
            />
          ) : undefined
        }
      >
        {sheetMeal !== null ? (
          <Cerita
            meal={sheetMeal}
            date={date}
            slots={MEAL_KEYS}
            onPhaseChange={setCeritaPhase}
            onSaved={(result) => {
              closeSheet();
              showFeedback(result);
            }}
          />
        ) : null}
        {sheetMeal !== null && ceritaPhase === "input" && MEAL_KEYS.length > 1 ? (
          <Segmented
            options={MEAL_KEYS.map((key) => ({ value: key, label: MEAL_SHORT[key] }))}
            value={sheetMeal}
            onChange={(value) => setSheetMeal(value)}
          />
        ) : null}
        {ceritaPhase === "input" && recentQuery.data && recentQuery.data.items.length > 0 ? (
          <View style={styles.recentBox}>
            <Text style={styles.recentLabel}>Catat cepat</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.recentRow}
            >
              {recentQuery.data.items.map((food) => (
                <Chip
                  key={food.name}
                  label={`${food.name} · ${fmtKcal(food.kcal)}`}
                  disabled={addFood.isPending}
                  onPress={() => {
                    quickAddRef.current = true;
                    addFood.mutate({
                      meal: sheetMeal ?? "sarapan",
                      name: food.name,
                      kcal: food.kcal,
                    });
                  }}
                />
              ))}
            </ScrollView>
          </View>
        ) : null}
        {ceritaPhase === "input" ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Pindai pakai foto"
            onPress={() => {
              closeSheet();
              router.push("/makan-ai");
            }}
            style={({ pressed }) => [styles.photoLink, pressed && styles.pressedSoft]}
          >
            <View style={styles.photoIcon}>
              <Ionicons name="camera-outline" size={20} color={theme.colors.makanText} />
            </View>
            <View style={styles.ceritaTexts}>
              <Text style={styles.photoTitle}>Pindai pakai foto</Text>
              <Text style={styles.ceritaSub}>AI hitung kalorinya, kamu cek dulu.</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={theme.colors.mutedForeground} />
          </Pressable>
        ) : null}
        {ceritaPhase === "input" && !manualOpen ? (
          <Button
            variant="ghost"
            size="sm"
            label="Isi kalori sendiri"
            onPress={() => setManualOpen(true)}
            style={styles.manualToggle}
          />
        ) : null}
        {ceritaPhase === "input" && manualOpen ? (
          <View style={styles.manualBox}>
            <Field label="Nama makanan">
              <Input value={name} onChangeText={setName} placeholder="Nasi goreng" />
            </Field>
            <Field label="Kalori (kcal)">
              <Input
                value={kcal}
                onChangeText={setKcal}
                keyboardType="number-pad"
                placeholder="350"
              />
            </Field>
            <Field label="Harga piring ini (Rp, opsional)">
              <Input
                value={platePriceManual}
                onChangeText={setPlatePriceManual}
                keyboardType="number-pad"
                maxLength={9}
                placeholder="28000"
                accessibilityLabel="Harga piring ini dalam rupiah"
              />
            </Field>
            {macrosOpen ? (
              <View style={styles.macroRow}>
                <Input
                  value={protein}
                  onChangeText={setProtein}
                  keyboardType="decimal-pad"
                  placeholder="Protein"
                  style={styles.macroInput}
                />
                <Input
                  value={carbs}
                  onChangeText={setCarbs}
                  keyboardType="decimal-pad"
                  placeholder="Karbo"
                  style={styles.macroInput}
                />
                <Input
                  value={fat}
                  onChangeText={setFat}
                  keyboardType="decimal-pad"
                  placeholder="Lemak"
                  style={styles.macroInput}
                />
              </View>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                label="Tambah detail makro (opsional)"
                onPress={() => setMacrosOpen(true)}
              />
            )}
            {formError ? <Text style={styles.error}>{formError}</Text> : null}
            {addFood.isError ? (
              <Text style={styles.error}>{errorMessage(addFood.error)}</Text>
            ) : null}
          </View>
        ) : null}
      </Sheet>

      {/* Global Ceritakan: cerita bebas, bisa beberapa waktu makan sekaligus */}
      <Sheet visible={ceritaOpen} onClose={() => setCeritaOpen(false)} title="Ceritakan makananmu">
        <Cerita
          date={date}
          slots={MEAL_KEYS}
          onSaved={(result) => {
            setCeritaOpen(false);
            showFeedback(result);
          }}
        />
      </Sheet>

      {/* Sticker viewer */}
      <StickerViewer viewer={viewer} onClose={() => setViewer(null)} />
      <ShareToFeedSheet
        visible={shareTarget !== null}
        onClose={() => setShareTarget(null)}
        title={shareTarget?.title ?? ""}
        preview={shareTarget?.preview ?? ""}
        kind={shareTarget?.kind ?? "makan"}
        refId={shareTarget?.refId ?? ""}
      />
    </Screen>
  );
}

const styles = StyleSheet.create((theme) => ({
  rowActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
  },
  pressedSoft: {
    opacity: 0.7,
  },
  disabled: {
    opacity: 0.35,
  },
  dayRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing.sm,
  },
  dayArrow: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.colors.card,
    alignItems: "center",
    justifyContent: "center",
  },
  dayLabel: {
    fontSize: theme.fontSize.base,
    fontWeight: "700",
    color: theme.colors.foreground,
    minWidth: 120,
    textAlign: "center",
  },
  summaryCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.lg,
  },
  ringCenter: {
    alignItems: "center",
    gap: 1,
    maxWidth: 76,
  },
  ringKcal: {
    fontSize: theme.fontSize.xl,
    fontWeight: "800",
    color: theme.colors.foreground,
  },
  ringUnit: {
    fontSize: 10,
    fontWeight: "600",
    color: theme.colors.mutedForeground,
  },
  ringTarget: {
    fontSize: 10,
    fontWeight: "600",
    color: theme.colors.mutedForeground,
  },
  summaryInfo: {
    flex: 1,
    gap: theme.spacing.md,
  },
  slotHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: theme.spacing.sm,
  },
  slotTitle: {
    fontSize: theme.fontSize.md,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  slotRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
  },
  slotKcal: {
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    color: theme.colors.mutedForeground,
  },
  slotAdd: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: theme.colors.makanSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  slotEmpty: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
    paddingHorizontal: theme.spacing.xs,
  },
  deleteButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    marginRight: -12,
  },
  recentBox: {
    gap: theme.spacing.sm,
  },
  recentLabel: {
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    color: theme.colors.mutedForeground,
  },
  recentRow: {
    gap: theme.spacing.sm,
    paddingRight: theme.spacing.lg,
  },
  macroRow: {
    flexDirection: "row",
    gap: theme.spacing.sm,
  },
  macroInput: {
    flex: 1,
    minHeight: 44,
  },
  manualToggle: {
    alignSelf: "flex-start",
  },
  manualBox: {
    gap: theme.spacing.md,
  },
  photoLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    backgroundColor: theme.colors.muted,
    borderRadius: theme.radius.card,
    padding: theme.spacing.lg,
  },
  photoIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: theme.colors.card,
    alignItems: "center",
    justifyContent: "center",
  },
  photoTitle: {
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  ceritaBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.card,
    padding: theme.spacing.lg,
  },
  ceritaMic: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: theme.colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  ceritaTexts: {
    flex: 1,
    gap: 2,
  },
  ceritaTitle: {
    fontSize: theme.fontSize.base,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  ceritaSub: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
  },
  feedbackBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    backgroundColor: theme.colors.makanSoft,
    borderRadius: theme.radius.card,
    paddingLeft: theme.spacing.lg,
    paddingRight: theme.spacing.xs,
    paddingVertical: theme.spacing.sm,
  },
  feedbackText: {
    flex: 1,
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    color: theme.colors.makanText,
  },
  feedbackClose: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  error: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.destructive,
  },
  undoBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    backgroundColor: theme.colors.muted,
    borderRadius: theme.radius.card,
    paddingLeft: theme.spacing.lg,
    paddingRight: theme.spacing.xs,
    paddingVertical: theme.spacing.xs,
  },
  undoText: {
    flex: 1,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
  },
  undoAction: {
    minHeight: 44,
    paddingHorizontal: theme.spacing.md,
    justifyContent: "center",
  },
  undoActionText: {
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
    color: theme.colors.primary,
  },
}));
