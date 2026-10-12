import "@/unistyles";
import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Image, Modal, Pressable, ScrollView, View } from "react-native";
import { useRef, useState } from "react";
import { Redirect } from "expo-router";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import {
  MEAL_LABELS,
  effectiveRamadan,
  jakartaToday,
  slotsFor,
  suggestMealNow,
} from "@joyorogo/api/lib/engine";
import type { Meal } from "@joyorogo/api/lib/engine";

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
// Must stay named `ENV`: varlock's babel plugin only inlines `ENV.X` reads;
// anything else hits the runtime proxy, which throws in release builds.
import { ENV } from "../../src/env";
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
  const [name, setName] = useState("");
  const [kcal, setKcal] = useState("");
  const [protein, setProtein] = useState("");
  const [carbs, setCarbs] = useState("");
  const [fat, setFat] = useState("");
  const [macrosOpen, setMacrosOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [viewer, setViewer] = useState<{ uri: string; name: string; kcal: number } | null>(null);
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

  const closeSheet = () => {
    setSheetMeal(null);
    setFormError(null);
    setName("");
    setKcal("");
    setProtein("");
    setCarbs("");
    setFat("");
    setMacrosOpen(false);
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
                    <Pressable
                      accessibilityRole="imagebutton"
                      accessibilityLabel={`Lihat stiker ${item.name}`}
                      onPress={() =>
                        setViewer({
                          uri: `${ENV.EXPO_PUBLIC_SERVER_URL}/sticker/${item.scanId}`,
                          name: item.name,
                          kcal: item.kcal,
                        })
                      }
                    >
                      <Image
                        source={{
                          uri: `${ENV.EXPO_PUBLIC_SERVER_URL}/sticker/${item.scanId}`,
                        }}
                        style={styles.itemSticker}
                        accessibilityLabel={item.name}
                      />
                    </Pressable>
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
          color={theme.colors.makan}
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

      {/* Add form lives in a bottom sheet */}
      <Sheet
        visible={sheetMeal !== null}
        onClose={closeSheet}
        title="Tambah Makanan"
        footer={
          <Button
            label="Tambah"
            onPress={submit}
            loading={addFood.isPending}
            disabled={sheetMeal === null}
          />
        }
      >
        {sheetMeal !== null && MEAL_KEYS.length > 1 ? (
          <Segmented
            options={MEAL_KEYS.map((key) => ({ value: key, label: MEAL_SHORT[key] }))}
            value={sheetMeal}
            onChange={(value) => setSheetMeal(value)}
          />
        ) : null}
        {recentQuery.data && recentQuery.data.items.length > 0 ? (
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
        <Field label="Nama makanan">
          <Input value={name} onChangeText={setName} placeholder="Nasi goreng" />
        </Field>
        <Field label="Kalori (kcal)">
          <Input value={kcal} onChangeText={setKcal} keyboardType="number-pad" placeholder="350" />
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
        {addFood.isError ? <Text style={styles.error}>{errorMessage(addFood.error)}</Text> : null}
      </Sheet>

      {/* Sticker viewer */}
      <Modal
        visible={viewer !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setViewer(null)}
        accessibilityViewIsModal
      >
        <Pressable style={styles.viewerBackdrop} onPress={() => setViewer(null)}>
          <View style={styles.viewerBody}>
            <Image source={{ uri: viewer?.uri }} style={styles.viewerImage} resizeMode="contain" />
            <Text style={styles.viewerCaption}>
              {viewer?.name} · {fmtKcal(viewer?.kcal ?? 0)} kcal
            </Text>
          </View>
        </Pressable>
      </Modal>
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
  itemSticker: {
    width: 40,
    height: 40,
    borderRadius: 20,
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
  error: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.destructive,
  },
  viewerBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.85)",
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing.lg,
  },
  viewerBody: {
    alignItems: "center",
    gap: theme.spacing.md,
    width: "100%",
  },
  viewerImage: {
    width: "100%",
    height: 360,
    borderRadius: theme.radius.card,
  },
  viewerCaption: {
    color: "#FFFFFF",
    fontSize: theme.fontSize.base,
    fontWeight: "600",
  },
}));
