import "@/unistyles";
import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Pressable, ScrollView, View } from "react-native";
import { useRef, useState } from "react";
import { Redirect, router } from "expo-router";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import {
  MEAL_LABELS,
  eatTone,
  effectiveRamadan,
  jakartaToday,
  relativeDayLabel,
  slotsFor,
  suggestMealNow,
} from "@joyorogo/api/lib/engine";
import type { Meal } from "@joyorogo/api/lib/engine";

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
import { errorMessage, fmtDateId, fmtKcal, parseNum } from "@/utils/format";
import { orpc, queryClient } from "@/utils/orpc";

/** Ring arc from 90% of the eat budget (yellow); red once over it. */
const EAT_NEAR_COLOR = "#E5A50A";

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
  const [formError, setFormError] = useState<string | null>(null);
  const [viewer, setViewer] = useState<StickerViewerTarget | null>(null);
  const quickAddRef = useRef(false);

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
    setFormError(null);
    addFood.mutate({
      meal,
      name: name.trim(),
      kcal: kcalNum,
      protein: proteinNum ?? undefined,
      carbs: carbsNum ?? undefined,
      fat: fatNum ?? undefined,
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
          <Text style={styles.slotEmpty}>Belum ada catatan.</Text>
        ) : (
          <ListGroup>
            {slotItems.map((item) => (
              <ListRow
                key={item.id}
                title={item.name}
                subtitle={
                  item.protein !== null || item.carbs !== null || item.fat !== null
                    ? `P ${fmtKcal(item.protein ?? 0)} · K ${fmtKcal(item.carbs ?? 0)} · L ${fmtKcal(item.fat ?? 0)} g`
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
                        });
                      }}
                    />
                  ) : undefined
                }
                right={
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Hapus ${item.name}`}
                    onPress={() => removeFood.mutate({ id: item.id })}
                    style={({ pressed }) => [styles.deleteButton, pressed && styles.pressedSoft]}
                  >
                    <Ionicons name="trash-outline" size={18} color={theme.colors.destructive} />
                  </Pressable>
                }
              />
            ))}
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
        <Text style={styles.dayLabel}>{isToday ? "Hari ini" : fmtDateId(date)}</Text>
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

      {/* Summary strip: ring + P/K/L pills */}
      <Card style={styles.summaryCard}>
        <Ring
          size={72}
          stroke={9}
          value={eatenKcal}
          max={targets?.eatKcal ?? eatenKcal}
          color={
            {
              ok: theme.colors.makan,
              near: EAT_NEAR_COLOR,
              over: theme.colors.destructive,
            }[eatTone(eatenKcal, targets?.eatKcal ?? 0)]
          }
          track={theme.colors.makanSoft}
        >
          <Num style={styles.summaryPct} adjustsFontSizeToFit numberOfLines={1}>
            {targets && targets.eatKcal > 0
              ? `${Math.round((eatenKcal / targets.eatKcal) * 100)}%`
              : "–"}
          </Num>
        </Ring>
        <View style={styles.summaryInfo}>
          <View style={styles.summaryLine}>
            <Num style={styles.summaryKcal}>{fmtKcal(eatenKcal)}</Num>
            <Text style={styles.summaryTarget}>
              / {targets ? fmtKcal(targets.eatKcal) : "?"} kcal
            </Text>
          </View>
          <View style={styles.pillRow}>
            <View style={[styles.macroPill, { backgroundColor: theme.colors.makanSoft }]}>
              <Text style={[styles.macroPillText, { color: theme.colors.makanText }]}>
                P {fmtKcal(totals.protein)}g
              </Text>
            </View>
            <View style={[styles.macroPill, { backgroundColor: theme.colors.tidurSoft }]}>
              <Text style={[styles.macroPillText, { color: theme.colors.tidurText }]}>
                K {fmtKcal(totals.carbs)}g
              </Text>
            </View>
            <View style={[styles.macroPill, { backgroundColor: theme.colors.bakarSoft }]}>
              <Text style={[styles.macroPillText, { color: theme.colors.bakarText }]}>
                L {fmtKcal(totals.fat)}g
              </Text>
            </View>
          </View>
        </View>
      </Card>

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
    </Screen>
  );
}

const styles = StyleSheet.create((theme) => ({
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
  summaryPct: {
    fontSize: theme.fontSize.base,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  summaryInfo: {
    flex: 1,
    gap: theme.spacing.sm,
  },
  summaryLine: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 4,
  },
  summaryKcal: {
    fontSize: theme.fontSize["2xl"],
    fontWeight: "800",
    color: theme.colors.foreground,
  },
  summaryTarget: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
  },
  pillRow: {
    flexDirection: "row",
    gap: theme.spacing.sm,
    flexWrap: "wrap",
  },
  macroPill: {
    borderRadius: theme.radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  macroPillText: {
    fontSize: theme.fontSize.xs,
    fontWeight: "700",
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
}));
