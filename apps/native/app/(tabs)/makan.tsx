import "@/unistyles";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
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
import { formatIdrInput, idrKeystroke, parseIdrInput } from "@joyorogo/api/lib/format";

import { BelanjaSection } from "@/components/plate/belanja";
import { PlateHeader } from "@/components/plate/plate-header";
import { PlateEditSheet } from "@/components/plate/plate-edit-sheet";
import { DaySwitcher } from "@/components/day-switcher";
import { Cerita } from "@/components/cerita";
import { FoodPortionSheet } from "@/components/food-portion-sheet";
import type { CeritaPhase } from "@/components/cerita";
import { StickerMini, StickerViewer, stickerUrl } from "@/components/sticker";
import { FoodRow } from "@/components/makan/food-row";
import { FitnessCard } from "@/components/makan/fitness-card";
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
import { client, orpc, queryClient } from "@/utils/orpc";
import { OptimisticCache, useDelayedDelete, useOptimisticMutation } from "@/lib/optimistic";
import type { QueryKey } from "@tanstack/react-query";
import { FavoritChips, FavoritManageSheet, useFavorites } from "@/components/favorit";
import type { SummaryDelta } from "@joyorogo/api/lib/optimistic";
import { FOOD_KIND_LABELS, foodKind, matchesKind } from "@joyorogo/api/lib/food-kind";
import type { FoodKindFilter } from "@joyorogo/api/lib/food-kind";
import type { MakanView } from "@joyorogo/api/lib/diary-view";
import { KalenderView } from "@/components/makan/kalender-view";
import { KindChips } from "@/components/makan/kind-chips";
import { MonthScrubber } from "@/components/makan/month-scrubber";
import { StikerView } from "@/components/makan/stiker-view";
import { Timeline } from "@/components/makan/timeline";
import { KindPicker, SnackAdviceSection } from "@/components/makan/snack-advice";
import type { PickableKind } from "@/components/makan/snack-advice";
import { MakanViewSwitcher } from "@/components/makan/view-switcher";
import { PlacesView } from "@/components/places/places-view";
import { SaveLocationToggle } from "@/components/places/location-toggle";
import { loadMakanPrefs, saveMakanKind, saveMakanView } from "@/src/lib/makan-prefs";
import { usePlaceLocation } from "@/src/lib/location";

const ALL_MEAL_KEYS = Object.keys(MEAL_LABELS) as Meal[];

const MEAL_SHORT: Record<Meal, string> = {
  sarapan: "Sarapan",
  makan_siang: "Siang",
  makan_malam: "Malam",
  snack: "Snack",
  sahur: "Sahur",
  berbuka: "Berbuka",
};

export default function Makan() {
  const { theme } = useUnistyles();
  const gate = useSessionGate();
  const today = jakartaToday();
  const [date, setDate] = useState(today);
  const isToday = date === today;

  const profile = useQuery(orpc.profile.myProfile.queryOptions());

  // Last chosen view and kind chip live on the device; the saved pair loads
  // once, unless the user already picked something while it was reading.
  const [view, setView] = useState<MakanView>("daftar");
  const [kind, setKind] = useState<FoodKindFilter>("semua");
  const chosen = useRef(false);
  useEffect(() => {
    void loadMakanPrefs().then((saved) => {
      if (chosen.current) return;
      if (saved.view) setView(saved.view);
      if (saved.kind) setKind(saved.kind);
    });
  }, []);
  const chooseView = (next: MakanView) => {
    chosen.current = true;
    setView(next);
    void saveMakanView(next);
  };
  const chooseKind = (next: FoodKindFilter) => {
    chosen.current = true;
    setKind(next);
    void saveMakanKind(next);
  };
  const openDaftar = (target: string) => {
    setDate(target);
    chooseView("daftar");
  };
  /** Kalender and Stiker read their own queries; nudge them after an edit. */
  const refreshDiary = () => void queryClient.invalidateQueries({ queryKey: orpc.diary.key() });
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
  const favorites = useFavorites();
  const [manageOpen, setManageOpen] = useState(false);
  // Plate prices for the diary's plate grouping (plate.byDate) and inline edit.
  const plateDayQuery = useQuery({
    ...orpc.plate.byDate.queryOptions({ input: { date } }),
    placeholderData: (prev) => prev,
  });
  // Cache keys for the day this screen shows.
  type FoodRow = NonNullable<NonNullable<typeof listQuery.data>["items"]>[number];
  type PlateRow = {
    id: string;
    date: string;
    meal: string;
    name: string;
    place: string | null;
    priceIdr: number | null;
    lat: number | null;
    lng: number | null;
  };
  /** Fields of a plate.update payload as they look in the cache. */
  const plateFieldPatch = (input: Parameters<typeof client.plate.update>[0]) => ({
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.place !== undefined ? { place: input.place } : {}),
    ...(input.priceIdr !== undefined ? { priceIdr: input.priceIdr } : {}),
    ...(input.lat !== undefined ? { lat: input.lat } : {}),
    ...(input.lng !== undefined ? { lng: input.lng } : {}),
  });
  const foodListKey = orpc.food.listByDate.queryOptions({ input: { date } }).queryKey;
  const plateDayKey = orpc.plate.byDate.queryOptions({ input: { date } }).queryKey;

  type Totals = { kcal: number; protein: number; carbs: number; fat: number; fiber: number };

  /** food.listByDate caches hold { items, totals }: land a row and lift the totals. */
  const insertFoodRow = (cache: OptimisticCache, listKey: QueryKey, row: FoodRow) => {
    cache.value<{ items: FoodRow[]; totals: Totals }>(listKey, (old) =>
      old
        ? {
            ...old,
            items: [...old.items, row],
            totals: {
              kcal: old.totals.kcal + row.kcal,
              protein: old.totals.protein + (row.protein ?? 0),
              carbs: old.totals.carbs + (row.carbs ?? 0),
              fat: old.totals.fat + (row.fat ?? 0),
              fiber: old.totals.fiber + (row.fiber ?? 0),
            },
          }
        : old,
    );
  };

  /** food.listByDate caches hold { items, totals }: strip one row and pull
   * the rendered totals down with it (clamped, they are display values). */
  const stripFoodRow = (cache: OptimisticCache, listKey: QueryKey, row: FoodRow) => {
    cache.value<{ items: FoodRow[]; totals: Totals }>(listKey, (old) => {
      if (!old || !old.items.some((item) => item.id === row.id)) return old;
      return {
        ...old,
        items: old.items.filter((item) => item.id !== row.id),
        totals: {
          kcal: Math.max(0, old.totals.kcal - row.kcal),
          protein: Math.max(0, old.totals.protein - (row.protein ?? 0)),
          carbs: Math.max(0, old.totals.carbs - (row.carbs ?? 0)),
          fat: Math.max(0, old.totals.fat - (row.fat ?? 0)),
          fiber: Math.max(0, old.totals.fiber - (row.fiber ?? 0)),
        },
      };
    });
  };

  /** Signed food delta for the day-summary caches; fiber rides the refetch. */
  const foodSummaryDelta = (
    row: {
      date: string;
      meal: string;
      kcal: number;
      protein?: number | null;
      carbs?: number | null;
      fat?: number | null;
    },
    sign: 1 | -1,
  ): SummaryDelta => ({
    date: row.date,
    meal: row.meal,
    kcal: sign * row.kcal,
    ...(row.protein ? { protein: sign * row.protein } : {}),
    ...(row.carbs ? { carbs: sign * row.carbs } : {}),
    ...(row.fat ? { fat: sign * row.fat } : {}),
    meals: sign,
  });

  const addFood = useOptimisticMutation<Parameters<typeof client.food.add>[0], FoodRow>({
    mutationFn: async (input) => {
      const row = await client.food.add(input);
      if (!row) throw new Error("Gagal menyimpan.");
      return row;
    },
    patch: (input, cache) => {
      const rowDate = input.date ?? today;
      insertFoodRow(cache, foodListKey, {
        id: `temp-${Date.now()}`,
        userId: "",
        date: rowDate,
        meal: input.meal,
        name: input.name,
        kcal: input.kcal,
        protein: input.protein ?? null,
        carbs: input.carbs ?? null,
        fat: input.fat ?? null,
        fiber: input.fiber ?? null,
        grams: input.grams ?? null,
        source: input.source ?? "manual",
        itemsJson: input.itemsJson ?? null,
        scanId: input.scanId ?? null,
        photoId: null,
        plateId: null,
        createdAt: new Date(),
      });
      cache.summary(foodSummaryDelta({ ...input, date: rowDate }, 1));
    },
    success: (input, data) => {
      // The quick-add chips flip this ref so a half-typed manual entry
      // survives a one-tap add.
      if (!quickAddRef.current) {
        setName("");
        setKcal("");
        setKindOverride(null);
        setFullPortion(null);
        setProtein("");
        setCarbs("");
        setFat("");
        setPlatePriceManual("");
        setManualPlace("");
        setMacrosOpen(false);
      }
      quickAddRef.current = false;
      setFormError(null);
      return {
        message: `${input.name} dicatat`,
        undo: () => {
          // Undo deletes the just-created row; quiet, then targeted refetch.
          void client.food.remove({ id: data.id }).then(() => {
            void queryClient.invalidateQueries({ queryKey: orpc.food.key() });
            void queryClient.invalidateQueries({ queryKey: orpc.plate.key() });
            void queryClient.invalidateQueries({ queryKey: orpc.day.key() });
          });
        },
      };
    },
    invalidate: () => [orpc.food.key(), orpc.plate.key(), orpc.day.key(), orpc.diary.key()],
  });

  const deleteFood = useDelayedDelete<FoodRow>({
    remove: (row) => client.food.remove({ id: row.id }),
    patch: (row, cache) => {
      const listKey = orpc.food.listByDate.queryOptions({ input: { date: row.date } }).queryKey;
      let lastOfPlate = false;
      stripFoodRow(cache, listKey, row);
      const remaining = queryClient.getQueryData<{ items: FoodRow[] }>(listKey)?.items ?? [];
      lastOfPlate = row.plateId !== null && !remaining.some((item) => item.plateId === row.plateId);
      cache.summary(foodSummaryDelta(row, -1));
      if (row.plateId !== null && lastOfPlate) {
        const plateKey = orpc.plate.byDate.queryOptions({ input: { date: row.date } }).queryKey;
        cache.value<PlateRow[]>(plateKey, (plates) =>
          (plates ?? []).filter((plate) => plate.id !== row.plateId),
        );
      }
    },
    label: (row) => row.name,
    fallback: "Catatan",
    invalidate: () => [orpc.food.key(), orpc.plate.key(), orpc.day.key(), orpc.diary.key()],
  });

  const updatePlate = useOptimisticMutation<
    Parameters<typeof client.plate.update>[0],
    unknown,
    PlateRow | null
  >({
    mutationFn: (input) => client.plate.update(input),
    patch: (input, cache) => {
      const previous =
        (queryClient.getQueryData<PlateRow[]>(plateDayKey) ?? []).find(
          (plate) => plate.id === input.id,
        ) ?? null;
      if (input.date && previous && input.date !== previous.date) {
        // Date move: relocate the plate row and every component row between
        // the two day caches, with matching summary deltas on both days.
        const moveDate = input.date;
        const oldKey = orpc.plate.byDate.queryOptions({ input: { date: previous.date } }).queryKey;
        const newKey = orpc.plate.byDate.queryOptions({ input: { date: moveDate } }).queryKey;
        cache.value<PlateRow[]>(oldKey, (plates) =>
          (plates ?? []).filter((plate) => plate.id !== input.id),
        );
        cache.value<PlateRow[]>(newKey, (plates) => [
          ...(plates ?? []),
          { ...previous, ...plateFieldPatch(input), date: moveDate },
        ]);
        const rows = (
          queryClient.getQueryData<{ items: FoodRow[] }>(foodListKey)?.items ?? []
        ).filter((item) => item.plateId === input.id);
        for (const row of rows) {
          const moved = { ...row, date: moveDate };
          stripFoodRow(cache, foodListKey, row);
          insertFoodRow(
            cache,
            orpc.food.listByDate.queryOptions({ input: { date: input.date } }).queryKey,
            moved,
          );
          cache.summary(foodSummaryDelta(row, -1));
          cache.summary(foodSummaryDelta(moved, 1));
        }
        return previous;
      }
      cache.value<PlateRow[]>(plateDayKey, (plates) =>
        (plates ?? []).map((plate) =>
          plate.id === input.id ? { ...plate, ...plateFieldPatch(input) } : plate,
        ),
      );
      return previous;
    },
    success: (input, _data, context) => {
      const previous = context ?? null;
      const restore = previous
        ? {
            id: input.id,
            name: previous.name,
            place: previous.place,
            priceIdr: previous.priceIdr,
            lat: previous.lat,
            lng: previous.lng,
          }
        : null;
      if (input.date && previous && input.date !== previous.date) {
        return {
          message: `Dipindah ke ${relativeDayLabel(input.date, today)}`,
          undo: () => void client.plate.update({ ...restore!, date: previous.date }),
        };
      }
      return {
        message: "Piring diperbarui",
        undo: restore === null ? undefined : () => void client.plate.update(restore),
      };
    },
    invalidate: () => [orpc.plate.key(), orpc.food.key(), orpc.day.key(), orpc.diary.key()],
  });

  const [sheetMeal, setSheetMeal] = useState<Meal | null>(null);
  const [editRow, setEditRow] = useState<FoodRow | null>(null);
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
  // Item kind for the advice card: the name heuristic until a pill is tapped.
  const [kindOverride, setKindOverride] = useState<PickableKind | null>(null);
  // Manual fields as typed before "Setengah porsi", so one tap restores them.
  const [fullPortion, setFullPortion] = useState<{
    kcal: string;
    protein: string;
    carbs: string;
    fat: string;
  } | null>(null);
  // Manual form's optional plate price, and the diary's inline plate editor.
  const [platePriceManual, setPlatePriceManual] = useState("");
  const [manualPlace, setManualPlace] = useState("");
  const placeLocation = usePlaceLocation();
  // Caret inside the manual price input, so backspacing a separator drops the
  // digit instead of letting the separator snap back.
  const priceCaret = useRef(0);
  // Plate whose edit sheet is open; the sheet reads the live row from the cache.
  const [plateEditId, setPlateEditId] = useState<string | null>(null);
  const editPlate = plateEditId
    ? ((plateDayQuery.data ?? []).find((row) => row.id === plateEditId) ?? null)
    : null;
  const editPlateRows = (listQuery.data?.items ?? []).filter((row) => row.plateId === plateEditId);
  const [formError, setFormError] = useState<string | null>(null);
  const [viewer, setViewer] = useState<StickerViewerTarget | null>(null);
  const [shareTarget, setShareTarget] = useState<null | {
    kind: "makan";
    refId: string;
    title: string;
    preview: string;
  }>(null);
  const quickAddRef = useRef(false);

  if (gate === "loading") {
    return <BootLoader />;
  }
  if (gate === "anon") {
    return <Redirect href="/login" />;
  }
  if (view === "daftar" && listQuery.isPending) {
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
  if (view === "daftar" && listQuery.isError) {
    return (
      <Screen>
        <PageHeader title="Makan" />
        <ErrorState message={errorMessage(listQuery.error)} onRetry={() => listQuery.refetch()} />
      </Screen>
    );
  }

  const items = listQuery.data?.items ?? [];
  const totals = listQuery.data?.totals ?? { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 };
  const visibleItems = items.filter((item) => matchesKind(item.name, kind));
  const targets = summaryQuery.data?.targets ?? null;
  const eatenKcal = summaryQuery.data?.eatenKcal ?? totals.kcal;
  // Carb/fat/fiber floors from the engine; same reference as the web card.
  const macroBudgets = targets ? macroTargets(targets.eatKcal, 70) : null;

  const manualKind = kindOverride ?? foodKind(name);
  const halveManual = () => {
    const half = (value: string) => {
      const n = parseNum(value);
      return n === null ? value : String(Math.round((n / 2) * 10) / 10);
    };
    setFullPortion({ kcal, protein, carbs, fat });
    setKcal(String(Math.round((parseNum(kcal) ?? 0) / 2)));
    setProtein(half(protein));
    setCarbs(half(carbs));
    setFat(half(fat));
  };
  const undoHalfManual = () => {
    if (!fullPortion) return;
    setKcal(fullPortion.kcal);
    setProtein(fullPortion.protein);
    setCarbs(fullPortion.carbs);
    setFat(fullPortion.fat);
    setFullPortion(null);
  };

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
    const priceNum = parseIdrInput(platePriceManual);
    if (platePriceManual.trim() !== "" && priceNum === null) {
      setFormError("Harga piringnya angka rupiah bulat, contoh: 28000.");
      return;
    }
    const placeClean = manualPlace.trim();
    const plate =
      priceNum !== null || placeClean !== ""
        ? {
            name: name.trim(),
            ...(priceNum !== null ? { priceIdr: Math.round(priceNum) } : {}),
            ...(placeClean !== "" ? { place: placeClean } : {}),
            // Coordinates ride along only with a place name and only when opted in.
            ...(placeClean !== "" && placeLocation.enabled && placeLocation.coords
              ? placeLocation.coords
              : {}),
          }
        : undefined;
    setFormError(null);
    addFood.mutate({
      date,
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
    refreshDiary();
  };

  /** Open a day's cutout in the full-size viewer. */
  const viewSticker = (item: FoodRow) => {
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
  };

  const closeSheet = () => {
    setSheetMeal(null);
    setFormError(null);
    setName("");
    setKindOverride(null);
    setFullPortion(null);
    setKcal("");
    setProtein("");
    setCarbs("");
    setFat("");
    setPlatePriceManual("");
    setManualPlace("");
    setMacrosOpen(false);
    setManualOpen(false);
    setCeritaPhase("input");
    quickAddRef.current = false;
  };

  const renderSlot = (key: Meal) => {
    const slotItems = visibleItems.filter((item) => item.meal === key);
    const slotKcal = slotItems.reduce((sum, item) => sum + item.kcal, 0);
    return (
      <View key={key}>
        <View style={styles.slotHeader}>
          <View style={styles.slotDot} />
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
                const segmentKcal = segment.rows.reduce((sum, item) => sum + item.kcal, 0);
                const anyMacro = segment.rows.some(
                  (item) =>
                    item.protein !== null ||
                    item.carbs !== null ||
                    item.fat !== null ||
                    item.fiber !== null,
                );
                const sumMacro = (pick: (item: (typeof segment.rows)[number]) => number | null) =>
                  anyMacro ? segment.rows.reduce((sum, item) => sum + (pick(item) ?? 0), 0) : null;
                return (
                  <View key={segment.plateId ?? `plain-${segmentIndex}`}>
                    {plateRow ? (
                      <PlateHeader
                        name={plateRow.name}
                        priceIdr={plateRow.priceIdr}
                        kcal={segmentKcal}
                        protein={sumMacro((item) => item.protein)}
                        carbs={sumMacro((item) => item.carbs)}
                        fat={sumMacro((item) => item.fat)}
                        fiber={sumMacro((item) => item.fiber)}
                        onEdit={() => setPlateEditId(plateRow.id)}
                        disabled={updatePlate.isPending}
                      />
                    ) : null}
                    {segment.rows.map((item) => (
                      <FoodRow
                        key={item.id}
                        item={item}
                        onEdit={() => setEditRow(item)}
                        onDelete={() => deleteFood(item)}
                        onViewSticker={() => viewSticker(item)}
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
      <PageHeader
        title="Makan"
        caption={isToday && view === "daftar" ? "Catat piringmu" : undefined}
      />

      <MakanViewSwitcher value={view} onChange={chooseView} />
      {view !== "tempat" ? <KindChips value={kind} onChange={chooseKind} /> : null}

      {view === "daftar" ? (
        <>
          <MonthScrubber date={date} kind={kind} onPick={setDate} />

          {/* Day switcher */}
          <DaySwitcher date={date} onChange={setDate} />

          {/* Summary strip: ring + per-macro progress bars (same budgets as web) */}
          <Card style={styles.summaryCard}>
            <Ring
              size={110}
              stroke={12}
              value={eatenKcal}
              max={
                targets !== null && targets.eatKcal > 0 ? targets.eatKcal : Math.max(eatenKcal, 1)
              }
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
                macro="protein"
                label="Protein"
                eaten={totals.protein}
                budget={summaryQuery.data?.protein?.targetG ?? null}
              />
              <MacroBar
                macro="carbs"
                label="Karbo"
                eaten={totals.carbs}
                budget={macroBudgets?.carbsG ?? null}
              />
              <MacroBar
                macro="fat"
                label="Lemak"
                eaten={totals.fat}
                budget={macroBudgets?.fatG ?? null}
              />
              <MacroBar
                macro="fiber"
                label="Serat"
                eaten={totals.fiber}
                budget={macroBudgets?.fiberG ?? null}
              />
            </View>
          </Card>

          {/* Skor JoyoFit untuk hari yang dipilih; kosong kalau JoyoFit belum mengirim */}
          <FitnessCard date={date} />

          {/* Belanja: angkanya selalu hari ini */}
          {isToday ? <BelanjaSection /> : null}

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

          {favorites.items.length > 0 ? (
            <Card style={styles.favCard}>
              <Text style={styles.recentLabel}>
                Favorit · tap untuk catat ke {MEAL_LABELS[suggestMealNow(new Date(), ramadan)]}
                {isToday ? "" : `, ${fmtDateId(date)}`}
              </Text>
              <FavoritChips
                favorites={favorites}
                date={date}
                meal={suggestMealNow(new Date(), ramadan)}
                onManage={() => setManageOpen(true)}
              />
            </Card>
          ) : null}

          {items.length === 0 ? (
            <EmptyState
              pose="ready"
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
            <Timeline title={relativeDayLabel(date, today)} count={visibleItems.length}>
              {MEAL_KEYS.map(renderSlot)}
            </Timeline>
          )}
        </>
      ) : null}

      {view === "kalender" ? (
        <KalenderView date={date} kind={kind} onSelect={setDate}>
          <Timeline
            title={relativeDayLabel(date, today)}
            count={visibleItems.length}
            trailing={
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Buka di Daftar"
                onPress={() => chooseView("daftar")}
                hitSlop={8}
                style={({ pressed }) => [styles.openDaftar, pressed && styles.pressedSoft]}
              >
                <Text style={styles.openDaftarLabel}>Buka di Daftar</Text>
                <Ionicons name="chevron-forward" size={16} color={theme.colors.primary} />
              </Pressable>
            }
          >
            {listQuery.isPending ? (
              <Skeleton width="100%" height={96} radius={24} />
            ) : visibleItems.length > 0 ? (
              <ListGroup>
                {visibleItems.map((item) => (
                  <FoodRow
                    key={item.id}
                    item={item}
                    onEdit={() => setEditRow(item)}
                    onDelete={() => deleteFood(item)}
                    onViewSticker={() => viewSticker(item)}
                  />
                ))}
              </ListGroup>
            ) : (
              <Text style={styles.slotEmpty}>
                {kind === "semua"
                  ? "Belum ada catatan di hari ini."
                  : `Tidak ada ${FOOD_KIND_LABELS[kind].toLowerCase()} di hari ini.`}
              </Text>
            )}
          </Timeline>
        </KalenderView>
      ) : null}

      {view === "stiker" ? <StikerView date={date} kind={kind} onOpen={setEditRow} /> : null}

      {view === "tempat" ? <PlacesView onOpenDate={openDaftar} /> : null}

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
        {ceritaPhase === "input" && sheetMeal !== null && favorites.items.length > 0 ? (
          <View style={styles.recentBox}>
            <Text style={styles.recentLabel}>
              Favorit · tap untuk masuk ke {MEAL_LABELS[sheetMeal]}
            </Text>
            <FavoritChips
              favorites={favorites}
              date={date}
              meal={sheetMeal}
              onManage={() => {
                closeSheet();
                setManageOpen(true);
              }}
            />
          </View>
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
                  leading={food.scanId ? <StickerMini scanId={food.scanId} size={32} /> : undefined}
                  disabled={addFood.isPending}
                  onPress={() => {
                    quickAddRef.current = true;
                    addFood.mutate({
                      date,
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
              router.push(isToday ? "/makan-ai" : { pathname: "/makan-ai", params: { date } });
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
        {ceritaPhase === "input" ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Pindai barcode kemasan"
            onPress={() => {
              const meal = sheetMeal;
              closeSheet();
              router.push({
                pathname: "/makan-barcode",
                params: { ...(isToday ? {} : { date }), ...(meal ? { meal } : {}) },
              });
            }}
            style={({ pressed }) => [styles.photoLink, pressed && styles.pressedSoft]}
          >
            <View style={styles.photoIcon}>
              <Ionicons name="barcode-outline" size={20} color={theme.colors.makanText} />
            </View>
            <View style={styles.ceritaTexts}>
              <Text style={styles.photoTitle}>Pindai barcode kemasan</Text>
              <Text style={styles.ceritaSub}>Ambil angka gizi dari Open Food Facts.</Text>
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
            <KindPicker value={manualKind} onChange={setKindOverride} />
            <SnackAdviceSection
              date={date}
              kcal={parseNum(kcal) ?? 0}
              kind={manualKind}
              slot={sheetMeal ?? "snack"}
              name={name.trim() || undefined}
              onHalf={halveManual}
              halfApplied={fullPortion !== null}
              onUndoHalf={undoHalfManual}
            />
            <Field label="Harga piring ini (Rp, opsional)">
              <Input
                value={formatIdrInput(platePriceManual)}
                onChangeText={(text) =>
                  setPlatePriceManual(
                    idrKeystroke(text, formatIdrInput(platePriceManual), priceCaret.current),
                  )
                }
                onSelectionChange={({ nativeEvent: { selection } }) => {
                  priceCaret.current = selection.start;
                }}
                keyboardType="number-pad"
                maxLength={13}
                placeholder="Rp0"
                accessibilityLabel="Harga piring ini dalam rupiah"
              />
            </Field>
            <Field label="Tempat (opsional)">
              <Input
                value={manualPlace}
                onChangeText={setManualPlace}
                maxLength={200}
                placeholder="Warung Bu Siti"
                accessibilityLabel="Tempat membeli"
              />
            </Field>
            <SaveLocationToggle
              enabled={placeLocation.enabled}
              status={placeLocation.status}
              onChange={placeLocation.setEnabled}
            />
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
      <FavoritManageSheet
        visible={manageOpen}
        favorites={favorites}
        onClose={() => setManageOpen(false)}
      />
      {editRow ? (
        <FoodPortionSheet
          key={editRow.id}
          row={editRow}
          onClose={() => {
            setEditRow(null);
            refreshDiary();
          }}
          favorite={favorites.isFoodSaved(editRow)}
          onFavorite={() => favorites.toggleFood(editRow)}
          onShare={() => {
            setShareTarget({
              kind: "makan",
              refId: editRow.id,
              title: editRow.name,
              preview: `${fmtKcal(editRow.kcal)} kcal${
                editRow.protein !== null ? ` · P ${fmtKcal(editRow.protein ?? 0)}g` : ""
              }`,
            });
            setEditRow(null);
          }}
          onDelete={() => {
            deleteFood(editRow);
            setEditRow(null);
          }}
        />
      ) : null}

      {editPlate ? (
        <PlateEditSheet
          key={editPlate.id}
          plate={{
            id: editPlate.id,
            name: editPlate.name,
            place: editPlate.place,
            priceIdr: editPlate.priceIdr,
            date: editPlate.date,
            lat: editPlate.lat,
            lng: editPlate.lng,
            scanId: editPlateRows.find((row) => row.scanId)?.scanId ?? null,
          }}
          saving={updatePlate.isPending}
          favorite={favorites.isPlateSaved(editPlate, editPlateRows)}
          onFavorite={() => favorites.togglePlate(editPlate, editPlateRows)}
          onSave={(input) => updatePlate.mutate(input)}
          onClose={() => setPlateEditId(null)}
        />
      ) : null}

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
  pressedSoft: {
    opacity: 0.7,
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
  slotDot: {
    position: "absolute",
    left: -21,
    top: 15,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.colors.primary,
    opacity: 0.5,
  },
  openDaftar: {
    marginLeft: "auto",
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  openDaftarLabel: {
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
    color: theme.colors.primary,
  },
  slotEmpty: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
    paddingHorizontal: theme.spacing.xs,
  },
  favCard: {
    gap: theme.spacing.sm,
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
