import { Ionicons } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { MEAL_LABELS } from "@joyorogo/api/lib/engine";
import type { Meal } from "@joyorogo/api/lib/engine";
import { foodSavedKey, moveId, plateSavedKey } from "@joyorogo/api/lib/saved-foods";
import type { AppRouterClient } from "@joyorogo/api/routers/index";
import type { TFunction } from "@joyorogo/i18n";

import { Button, Chip, Input, ListGroup, ListRow, Sheet, Text } from "@/components/ui";
import { FoodSticker, StickerMini } from "@/components/sticker";
import { MacroLine } from "@/components/macro-line";
import { useToast } from "@/components/toast";
import { OptimisticCache, useDelayedDelete, useOptimisticMutation } from "@/lib/optimistic";
import { fmtIdr, fmtInt, fmtKcalLabel, kcalUnit, parseNum } from "@/utils/format";
import { client, orpc } from "@/utils/orpc";

type SavedListOutput = Awaited<ReturnType<AppRouterClient["savedFood"]["list"]>>;
type RelogOutput = Awaited<ReturnType<AppRouterClient["savedFood"]["relog"]>>;
type DayList = Awaited<ReturnType<AppRouterClient["food"]["listByDate"]>>;
type OfferOutput = Awaited<ReturnType<AppRouterClient["savedFood"]["offer"]>>;
type RecentOutput = Awaited<ReturnType<AppRouterClient["food"]["recent"]>>;

/** One Favorit (saved food or plate) with its parsed components. */
export type SavedFood = SavedListOutput["items"][number];
/** The food or combo logged 3+ times in 14 days that is worth saving as a favorite. */
export type FavoriteOffer = NonNullable<OfferOutput["offer"]>;
/** One recent chip of food.recent. */
export type RecentFoodRow = RecentOutput["items"][number];
/** One diary row, as food.listByDate returns it. */
export type DiaryRow = DayList["items"][number];
/** A diary plate header's identity, for starring a whole plate. */
export type FavoritPlate = { id: string; name: string; place: string | null };

type SavedList = { items: SavedFood[] };
type RelogInput = { saved: SavedFood; date: string; meal: Meal };
type SaveInput = { target: { foodId: string } | { plateId: string }; draft: SavedFood };

const listKey = () => orpc.savedFood.list.queryOptions().queryKey;
const dayKey = (date: string) => orpc.food.listByDate.queryOptions({ input: { date } }).queryKey;

/** Favorit state and actions returned by useFavorites. */
export interface Favorites {
  items: SavedFood[];
  /** Recently logged foods for the chips (hidden ones and one-food favorites left out), newest first. */
  recent: RecentFoodRow[];
  /** How many of the newest names the user hid from the recent chips. */
  hiddenCount: number;
  /** The food or combo logged 3+ times in 14 days that is worth saving; null = nothing to offer. */
  offer: FavoriteOffer | null;
  isFoodSaved: (row: DiaryRow) => boolean;
  isPlateSaved: (plate: FavoritPlate, rows: ReadonlyArray<DiaryRow>) => boolean;
  toggleFood: (row: DiaryRow) => void;
  togglePlate: (plate: FavoritPlate, rows: ReadonlyArray<DiaryRow>) => void;
  /** Logs a favorite to `date` + `meal` in one tap. */
  relog: (saved: SavedFood, date: string, meal: Meal) => void;
  relogPending: boolean;
  /** Delayed delete with an undo toast. */
  remove: (saved: SavedFood) => void;
  /** One place up (-1) or down (+1) in the user's own order. */
  move: (id: string, step: -1 | 1) => void;
  /** A favorite typed in by hand; `onDone` runs once it is saved. */
  create: (input: { name: string; kcal: number }, onDone: () => void) => void;
  createPending: boolean;
  /** A new name and/or total kcal; `onDone` runs once it is saved. */
  update: (id: string, patch: { name?: string; kcal?: number }, onDone: () => void) => void;
  saveRecent: (food: RecentFoodRow) => void;
  hideRecent: (name: string) => void;
  restoreRecent: () => void;
  saveOffer: () => void;
  dismissOffer: () => void;
}

/**
 * Favorit list, star toggles, one-tap re-log, rename and delayed delete on the
 * shared optimistic helpers. Mount once per screen (pending deletes flush on unmount).
 */
export function useFavorites(): Favorites {
  const { t } = useTranslation("makan");
  const queryClient = useQueryClient();
  const query = useQuery(orpc.savedFood.list.queryOptions());
  const items = query.data?.items ?? [];

  const saveMutation = useOptimisticMutation<SaveInput, SavedFood>({
    mutationFn: ({ target }) => client.savedFood.save(target),
    patch: ({ draft }, cache) => {
      cache.value<SavedList>(listKey(), (old) =>
        old && !old.items.some((row) => row.key === draft.key)
          ? { ...old, items: [draft, ...old.items] }
          : old,
      );
    },
    invalidate: () => [orpc.savedFood.key()],
    success: (_input, row) => ({
      message: t("favorites.toast.saved", { name: row.name }),
      undo: () => {
        new OptimisticCache(queryClient).value<SavedList>(listKey(), (old) =>
          old ? { ...old, items: old.items.filter((item) => item.id !== row.id) } : old,
        );
        void client.savedFood
          .remove({ id: row.id })
          .finally(() => void queryClient.invalidateQueries({ queryKey: orpc.savedFood.key() }));
      },
    }),
  });

  const removeMutation = useDelayedDelete<SavedFood>({
    remove: (row) => client.savedFood.remove({ id: row.id }),
    patch: (row, cache) =>
      cache.value<SavedList>(listKey(), (old) =>
        old ? { ...old, items: old.items.filter((item) => item.id !== row.id) } : old,
      ),
    label: (row) => t("favorites.deletedLabel", { name: row.name }),
    invalidate: () => [orpc.savedFood.key()],
  });

  const offerKey = () => orpc.savedFood.offer.queryOptions().queryKey;
  const recentKey = () => orpc.food.recent.queryOptions().queryKey;
  const offerQuery = useQuery(orpc.savedFood.offer.queryOptions());
  const recentQuery = useQuery(orpc.food.recent.queryOptions());

  // Catat cepat > Atur: the user's own order of the favorites, shown at once and confirmed by the server.
  const arrange = useOptimisticMutation<{ ids: string[] }, unknown>({
    mutationFn: ({ ids }) => client.savedFood.reorder({ ids }),
    patch: ({ ids }, cache) => {
      const rank = new Map(ids.map((id, index) => [id, index]));
      cache.value<SavedList>(listKey(), (old) =>
        old
          ? {
              ...old,
              items: [...old.items].sort((a, b) => (rank.get(a.id) ?? ids.length) - (rank.get(b.id) ?? ids.length)),
            }
          : old,
      );
    },
    invalidate: () => [orpc.savedFood.key()],
  });

  const create = useOptimisticMutation<{ name: string; kcal: number }, SavedFood>({
    mutationFn: (input) => client.savedFood.create(input),
    invalidate: () => [orpc.savedFood.key(), orpc.food.key()],
    success: (_input, row) => ({ message: t("favorites.toast.created", { name: row.name }) }),
  });

  const update = useOptimisticMutation<{ id: string; name?: string; kcal?: number }, SavedFood>({
    mutationFn: (input) => client.savedFood.update(input),
    invalidate: () => [orpc.savedFood.key()],
    success: () => ({ message: t("favorites.toast.updated") }),
  });

  // A recent food becomes a favorite; the chip leaves the recent list.
  const promote = useOptimisticMutation<{ id: string; name: string }, SavedFood>({
    mutationFn: ({ id }) => client.savedFood.save({ foodId: id }),
    patch: ({ name }, cache) =>
      cache.value<RecentOutput>(recentKey(), (old) =>
        old ? { ...old, items: old.items.filter((row) => row.name !== name) } : old,
      ),
    invalidate: () => [orpc.savedFood.key(), orpc.food.key(), orpc.savedFood.offer.key()],
    success: (_input, row) => ({ message: t("favorites.toast.saved", { name: row.name }) }),
  });

  const saveOffered = useOptimisticMutation<FavoriteOffer, SavedFood>({
    mutationFn: (offer) =>
      client.savedFood.save(offer.kind === "plate" ? { plateId: offer.targetId } : { foodId: offer.targetId }),
    patch: (_offer, cache) => cache.value<OfferOutput>(offerKey(), () => ({ offer: null })),
    invalidate: () => [orpc.savedFood.key(), orpc.food.key(), orpc.savedFood.offer.key()],
    success: (_offer, row) => ({ message: t("favorites.toast.saved", { name: row.name }) }),
  });

  const dismissOffered = useOptimisticMutation<FavoriteOffer, unknown>({
    mutationFn: (offer) => client.savedFood.dismissOffer({ key: offer.key }),
    patch: (_offer, cache) => cache.value<OfferOutput>(offerKey(), () => ({ offer: null })),
    invalidate: () => [orpc.savedFood.offer.key()],
  });

  const hide = useOptimisticMutation<{ name: string }, unknown>({
    mutationFn: ({ name }) => client.food.hideRecent({ name }),
    patch: ({ name }, cache) =>
      cache.value<RecentOutput>(recentKey(), (old) =>
        old ? { items: old.items.filter((row) => row.name !== name), hiddenCount: old.hiddenCount + 1 } : old,
      ),
    invalidate: () => [orpc.food.key()],
    success: ({ name }) => ({ message: t("favorites.toast.hidden", { name }) }),
  });

  const restore = useOptimisticMutation<void, unknown>({
    mutationFn: () => client.food.restoreRecent(),
    invalidate: () => [orpc.food.key()],
    success: () => ({ message: t("favorites.toast.restored") }),
  });

  const relogMutation = useOptimisticMutation<RelogInput, RelogOutput>({
    mutationFn: ({ saved, date, meal }) => client.savedFood.relog({ id: saved.id, date, meal }),
    patch: ({ saved, date, meal }, cache) => {
      for (const item of saved.items) {
        const row: DiaryRow = {
          id: `temp-${crypto.randomUUID()}`,
          userId: "",
          date,
          meal,
          name: item.name,
          kcal: item.kcal,
          protein: item.protein,
          carbs: item.carbs,
          fat: item.fat,
          fiber: item.fiber,
          grams: item.grams,
          source: item.scanId ? "ai" : "manual",
          itemsJson: null,
          scanId: item.scanId,
          plateScanId: null,
          photoId: item.photoId,
          plateId: null,
          eatenAt: null,
          createdAt: new Date(),
        };
        cache.value<DayList>(dayKey(date), (old) =>
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
        cache.summary({
          date,
          meal,
          kcal: item.kcal,
          ...(item.protein ? { protein: item.protein } : {}),
          ...(item.carbs ? { carbs: item.carbs } : {}),
          ...(item.fat ? { fat: item.fat } : {}),
          meals: 1,
        });
      }
    },
    invalidate: () => [orpc.food.key(), orpc.plate.key(), orpc.day.key(), orpc.savedFood.key()],
    success: ({ saved, meal }, result) => ({
      message: t("favorites.toast.relogged", { name: saved.name, meal: MEAL_LABELS[meal] }),
      undo: () => {
        void Promise.all(result.items.map((row) => client.food.remove({ id: row.id }))).finally(
          () => {
            for (const key of [orpc.food.key(), orpc.plate.key(), orpc.day.key()]) {
              void queryClient.invalidateQueries({ queryKey: key });
            }
          },
        );
      },
    }),
  });

  const byKey = new Map(items.map((row) => [row.key, row]));

  /** Provisional favorite shown until the server row replaces it. */
  const draft = (
    name: string,
    place: string | null,
    key: string,
    rows: ReadonlyArray<DiaryRow>,
  ): SavedFood => ({
    id: `tmp-${key}`,
    userId: "",
    name,
    place,
    priceIdr: null,
    kcal: rows.reduce((sum, row) => sum + row.kcal, 0),
    key,
    useCount: 0,
    lastUsedAt: null,
    sortOrder: null,
    createdAt: new Date(),
    items: rows.map((row) => ({
      name: row.name,
      grams: row.grams,
      kcal: row.kcal,
      protein: row.protein,
      carbs: row.carbs,
      fat: row.fat,
      fiber: row.fiber,
      scanId: row.scanId,
      photoId: row.photoId,
    })),
  });

  const offer = offerQuery.data?.offer ?? null;
  return {
    items,
    recent: recentQuery.data?.items ?? [],
    hiddenCount: recentQuery.data?.hiddenCount ?? 0,
    offer,
    isFoodSaved: (row) => byKey.has(foodSavedKey(row.name, row.kcal)),
    isPlateSaved: (plate, rows) => byKey.has(plateSavedKey(plate.name, plate.place, rows)),
    toggleFood: (row) => {
      const key = foodSavedKey(row.name, row.kcal);
      const existing = byKey.get(key);
      if (existing) return removeMutation(existing);
      saveMutation.mutate({ target: { foodId: row.id }, draft: draft(row.name, null, key, [row]) });
    },
    togglePlate: (plate, rows) => {
      const key = plateSavedKey(plate.name, plate.place, rows);
      const existing = byKey.get(key);
      if (existing) return removeMutation(existing);
      saveMutation.mutate({
        target: { plateId: plate.id },
        draft: draft(plate.name, plate.place, key, rows),
      });
    },
    relog: (saved, date, meal) => relogMutation.mutate({ saved, date, meal }),
    relogPending: relogMutation.isPending,
    remove: removeMutation,
    move: (id, step) => arrange.mutate({ ids: moveId(items.map((row) => row.id), id, step) }),
    create: (input, onDone) => create.mutate(input, { onSuccess: onDone }),
    createPending: create.isPending,
    update: (id, patch, onDone) => update.mutate({ id, ...patch }, { onSuccess: onDone }),
    saveRecent: (food) => promote.mutate({ id: food.id, name: food.name }),
    hideRecent: (name) => hide.mutate({ name }),
    restoreRecent: () => restore.mutate(),
    saveOffer: () => offer && saveOffered.mutate(offer),
    dismissOffer: () => offer && dismissOffered.mutate(offer),
  };
}

/** One-tap chips: tapping logs the favorite to the given day and slot. */
export function FavoritChips({
  favorites,
  date,
  meal,
  onManage,
  showManage = true,
}: {
  favorites: Favorites;
  date: string;
  meal: Meal;
  onManage: () => void;
  /** The "Atur" chip at the end; Catat cepat has its own button in the card header. */
  showManage?: boolean;
}) {
  const { t } = useTranslation("makan");
  if (favorites.items.length === 0) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
      {favorites.items.map((saved) => (
        <Chip
          key={saved.id}
          label={`${saved.name} · ${fmtInt(saved.kcal)}`}
          leading={
            saved.items[0]?.scanId ? (
              <StickerMini scanId={saved.items[0].scanId} size={32} />
            ) : undefined
          }
          disabled={favorites.relogPending || saved.id.startsWith("tmp-")}
          onPress={() => favorites.relog(saved, date, meal)}
        />
      ))}
      {showManage ? <Chip label={t("favorites.manage")} onPress={onManage} /> : null}
    </ScrollView>
  );
}

/**
 * "Simpan sebagai favorit": the food or combo the user has logged 3 times in 14 days, offered once. Simpan stars it,
 * Nanti dismisses it for good; neither shows it again.
 */
export function FavoritOffer({ favorites }: { favorites: Favorites }) {
  const { t } = useTranslation("makan");
  const offer = favorites.offer;
  if (!offer) return null;
  return (
    <View
      accessibilityRole="summary"
      accessibilityLabel={t("favorites.offer.title")}
      style={styles.offer}
    >
      <Text style={styles.offerTitle}>{t("favorites.offer.title")}</Text>
      <Text style={styles.offerBody}>
        {t("favorites.offer.body", { name: offer.name, count: offer.count, kcal: fmtKcalLabel(offer.kcal) })}
      </Text>
      <View style={styles.offerActions}>
        <Button size="sm" icon="star" label={t("favorites.offer.save")} onPress={favorites.saveOffer} />
        <Button size="sm" variant="ghost" label={t("favorites.offer.later")} onPress={favorites.dismissOffer} />
      </View>
    </View>
  );
}

function describe(saved: SavedFood, t: TFunction<"makan">): string {
  const parts = [fmtKcalLabel(saved.kcal)];
  if (saved.items.length > 1) {
    parts.push(t("favorites.itemCount", { count: saved.items.length }));
  }
  if (saved.priceIdr !== null) parts.push(fmtIdr(saved.priceIdr));
  return parts.join(" · ");
}

/** Catat cepat > Atur: reorder, edit, remove and add favorites; hide or promote the recent chips. */
export function FavoritManageSheet({
  visible,
  favorites,
  onClose,
}: {
  visible: boolean;
  favorites: Favorites;
  onClose: () => void;
}) {
  const { t } = useTranslation("makan");
  const { theme } = useUnistyles();
  const toast = useToast();
  const [editing, setEditing] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftKcal, setDraftKcal] = useState("");
  const [adding, setAdding] = useState(false);
  const [addName, setAddName] = useState("");
  const [addKcal, setAddKcal] = useState("");

  /** The trimmed name and a whole, positive kcal, or a toast saying which one is wrong. */
  const checked = (nameText: string, kcalText: string): { name: string; kcal: number } | null => {
    const name = nameText.trim();
    const kcal = parseNum(kcalText);
    if (name.length === 0) {
      toast.error(t("favorites.toast.nameEmpty"));
      return null;
    }
    if (kcal === null || !(kcal >= 1)) {
      toast.error(t("favorites.toast.kcalInvalid"));
      return null;
    }
    return { name, kcal: Math.round(kcal) };
  };

  const startEdit = (saved: SavedFood) => {
    setDraftName(saved.name);
    setDraftKcal(String(Math.round(saved.kcal)));
    setEditing(saved.id);
  };

  const commit = (saved: SavedFood) => {
    const next = checked(draftName, draftKcal);
    if (!next) return;
    const patch = {
      ...(next.name !== saved.name ? { name: next.name } : {}),
      ...(next.kcal !== Math.round(saved.kcal) ? { kcal: next.kcal } : {}),
    };
    if (Object.keys(patch).length === 0) {
      setEditing(null);
      return;
    }
    favorites.update(saved.id, patch, () => setEditing(null));
  };

  const submitAdd = () => {
    const next = checked(addName, addKcal);
    if (!next) return;
    favorites.create(next, () => {
      setAddName("");
      setAddKcal("");
      setAdding(false);
    });
  };

  const last = favorites.items.length - 1;
  return (
    <Sheet visible={visible} onClose={onClose} title={t("favorites.sheet.title")}>
      <Text style={styles.description}>{t("favorites.sheet.description")}</Text>
      <Text style={styles.sectionTitle}>{t("favorites.sheet.favoritesTitle")}</Text>
      {favorites.items.length === 0 ? (
        <Text style={styles.empty}>{t("favorites.sheet.empty")}</Text>
      ) : (
        <ListGroup>
          {favorites.items.map((saved, index) => {
            if (editing === saved.id) {
              return (
                <View key={saved.id} style={styles.editRow}>
                  <Input
                    value={draftName}
                    onChangeText={setDraftName}
                    maxLength={200}
                    autoFocus
                    accessibilityLabel={t("favorites.sheet.newName", { name: saved.name })}
                    onSubmitEditing={() => commit(saved)}
                    style={styles.editInput}
                  />
                  <Input
                    value={draftKcal}
                    onChangeText={setDraftKcal}
                    keyboardType="number-pad"
                    maxLength={5}
                    accessibilityLabel={t("favorites.sheet.kcalAria", { name: saved.name })}
                    onSubmitEditing={() => commit(saved)}
                    style={styles.kcalInput}
                  />
                  <Text style={styles.subtitleText}>{kcalUnit()}</Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t("favorites.sheet.saveName", { name: saved.name })}
                    onPress={() => commit(saved)}
                    style={({ pressed }) => [styles.starButton, pressed && styles.pressed]}
                  >
                    <Ionicons name="checkmark" size={20} color={theme.colors.makanText} />
                  </Pressable>
                </View>
              );
            }
            return (
              <ListRow
                key={saved.id}
                title={saved.name}
                subtitle={
                  <View style={styles.subtitle}>
                    <Text style={styles.subtitleText}>{describe(saved, t)}</Text>
                    <MacroLine
                      compact
                      protein={saved.items.reduce((sum, i) => sum + (i.protein ?? 0), 0)}
                      carbs={saved.items.reduce((sum, i) => sum + (i.carbs ?? 0), 0)}
                      fat={saved.items.reduce((sum, i) => sum + (i.fat ?? 0), 0)}
                    />
                  </View>
                }
                wrapTitle
                thumb={<FoodSticker scanId={saved.items[0]?.scanId} name={saved.name} size={52} />}
                right={
                  <View style={styles.actions}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t("favorites.sheet.moveUp", { name: saved.name })}
                      disabled={index === 0}
                      onPress={() => favorites.move(saved.id, -1)}
                      style={({ pressed }) => [styles.starButton, index === 0 && styles.disabled, pressed && styles.pressed]}
                    >
                      <Ionicons name="chevron-up" size={18} color={theme.colors.mutedForeground} />
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t("favorites.sheet.moveDown", { name: saved.name })}
                      disabled={index === last}
                      onPress={() => favorites.move(saved.id, 1)}
                      style={({ pressed }) => [styles.starButton, index === last && styles.disabled, pressed && styles.pressed]}
                    >
                      <Ionicons name="chevron-down" size={18} color={theme.colors.mutedForeground} />
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t("favorites.sheet.rename", { name: saved.name })}
                      onPress={() => startEdit(saved)}
                      style={({ pressed }) => [styles.starButton, pressed && styles.pressed]}
                    >
                      <Ionicons name="pencil" size={18} color={theme.colors.mutedForeground} />
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t("favorites.sheet.remove", { name: saved.name })}
                      onPress={() => favorites.remove(saved)}
                      style={({ pressed }) => [styles.starButton, pressed && styles.pressed]}
                    >
                      <Ionicons name="trash-outline" size={18} color={theme.colors.destructive} />
                    </Pressable>
                  </View>
                }
              />
            );
          })}
        </ListGroup>
      )}
      {adding ? (
        <View style={styles.addForm}>
          <Input
            value={addName}
            onChangeText={setAddName}
            maxLength={200}
            autoFocus
            placeholder={t("favorites.sheet.addNamePlaceholder")}
            accessibilityLabel={t("favorites.sheet.addName")}
            style={styles.editInput}
          />
          <Input
            value={addKcal}
            onChangeText={setAddKcal}
            keyboardType="number-pad"
            maxLength={5}
            placeholder={kcalUnit()}
            accessibilityLabel={t("favorites.sheet.addKcal")}
            onSubmitEditing={submitAdd}
            style={styles.kcalInput}
          />
          <Button size="sm" label={t("favorites.sheet.addSave")} onPress={submitAdd} loading={favorites.createPending} />
        </View>
      ) : (
        <View style={styles.addRow}>
          <Button
            variant="secondary"
            size="sm"
            icon="add"
            label={t("favorites.sheet.add")}
            onPress={() => setAdding(true)}
          />
        </View>
      )}

      {favorites.recent.length > 0 || favorites.hiddenCount > 0 ? (
        <>
          <Text style={styles.sectionTitle}>{t("favorites.sheet.recentTitle")}</Text>
          <Text style={styles.description}>{t("favorites.sheet.recentHint")}</Text>
          {favorites.recent.length > 0 ? (
            <ListGroup>
              {favorites.recent.map((food) => (
                <ListRow
                  key={food.name}
                  title={food.name}
                  subtitle={<Text style={styles.subtitleText}>{fmtKcalLabel(food.kcal)}</Text>}
                  wrapTitle
                  thumb={<FoodSticker scanId={food.scanId} name={food.name} size={52} />}
                  right={
                    <View style={styles.actions}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t("favorites.sheet.recentSave", { name: food.name })}
                        onPress={() => favorites.saveRecent(food)}
                        style={({ pressed }) => [styles.starButton, pressed && styles.pressed]}
                      >
                        <Ionicons name="star-outline" size={20} color={theme.colors.mutedForeground} />
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t("favorites.sheet.recentHide", { name: food.name })}
                        onPress={() => favorites.hideRecent(food.name)}
                        style={({ pressed }) => [styles.starButton, pressed && styles.pressed]}
                      >
                        <Ionicons name="eye-off-outline" size={20} color={theme.colors.mutedForeground} />
                      </Pressable>
                    </View>
                  }
                />
              ))}
            </ListGroup>
          ) : null}
          {favorites.hiddenCount > 0 ? (
            <View style={styles.addRow}>
              <Button
                variant="ghost"
                size="sm"
                label={t("favorites.sheet.showHidden", { count: favorites.hiddenCount })}
                onPress={favorites.restoreRecent}
              />
            </View>
          ) : null}
        </>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  starButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.3 },
  chips: {
    gap: theme.spacing.sm,
    paddingRight: theme.spacing.lg,
  },
  empty: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
    textAlign: "center",
    paddingVertical: theme.spacing.lg,
  },
  description: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
    marginBottom: theme.spacing.sm,
  },
  sectionTitle: {
    fontSize: theme.fontSize.md,
    fontWeight: "700",
    color: theme.colors.foreground,
    marginTop: theme.spacing.md,
    marginBottom: theme.spacing.xs,
  },
  editRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  editInput: { flex: 1 },
  kcalInput: { width: 76, textAlign: "right" },
  addForm: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    marginTop: theme.spacing.md,
  },
  addRow: {
    flexDirection: "row",
    marginTop: theme.spacing.md,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
  },
  subtitle: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    columnGap: theme.spacing.sm,
  },
  subtitleText: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.mutedForeground,
  },
  offer: {
    backgroundColor: theme.colors.makanSoft,
    borderRadius: 20,
    padding: theme.spacing.md,
    gap: theme.spacing.xs,
  },
  offerTitle: {
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
    color: theme.colors.makanText,
  },
  offerBody: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.makanText,
  },
  offerActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing.sm,
    marginTop: theme.spacing.sm,
  },
}));
