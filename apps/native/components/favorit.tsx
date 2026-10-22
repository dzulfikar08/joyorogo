import { Ionicons } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { MEAL_LABELS } from "@joyorogo/api/lib/engine";
import type { Meal } from "@joyorogo/api/lib/engine";
import { foodSavedKey, plateSavedKey } from "@joyorogo/api/lib/saved-foods";
import type { AppRouterClient } from "@joyorogo/api/routers/index";
import type { TFunction } from "@joyorogo/i18n";

import { Chip, Input, ListGroup, ListRow, Sheet, Text } from "@/components/ui";
import { FoodSticker, StickerMini } from "@/components/sticker";
import { MacroLine } from "@/components/macro-line";
import { useToast } from "@/components/toast";
import { OptimisticCache, useDelayedDelete, useOptimisticMutation } from "@/lib/optimistic";
import { fmtIdr, fmtInt, fmtKcalLabel } from "@/utils/format";
import { client, orpc } from "@/utils/orpc";

type SavedListOutput = Awaited<ReturnType<AppRouterClient["savedFood"]["list"]>>;
type RelogOutput = Awaited<ReturnType<AppRouterClient["savedFood"]["relog"]>>;
type DayList = Awaited<ReturnType<AppRouterClient["food"]["listByDate"]>>;

/** One Favorit (saved food or plate) with its parsed components. */
export type SavedFood = SavedListOutput["items"][number];
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
  isFoodSaved: (row: DiaryRow) => boolean;
  isPlateSaved: (plate: FavoritPlate, rows: ReadonlyArray<DiaryRow>) => boolean;
  toggleFood: (row: DiaryRow) => void;
  togglePlate: (plate: FavoritPlate, rows: ReadonlyArray<DiaryRow>) => void;
  /** Logs a favorite to `date` + `meal` in one tap. */
  relog: (saved: SavedFood, date: string, meal: Meal) => void;
  relogPending: boolean;
  rename: (id: string, name: string) => void;
  /** Delayed delete with an undo toast. */
  remove: (saved: SavedFood) => void;
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

  const renameMutation = useOptimisticMutation<{ id: string; name: string }, unknown>({
    mutationFn: (input) => client.savedFood.rename(input),
    patch: ({ id, name }, cache) =>
      cache.value<SavedList>(listKey(), (old) =>
        old
          ? { ...old, items: old.items.map((row) => (row.id === id ? { ...row, name } : row)) }
          : old,
      ),
    invalidate: () => [orpc.savedFood.key()],
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

  return {
    items,
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
    rename: (id, name) => renameMutation.mutate({ id, name }),
    remove: removeMutation,
  };
}

/** One-tap chips: tapping logs the favorite to the given day and slot. */
export function FavoritChips({
  favorites,
  date,
  meal,
  onManage,
}: {
  favorites: Favorites;
  date: string;
  meal: Meal;
  onManage: () => void;
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
      <Chip label={t("favorites.manage")} onPress={onManage} />
    </ScrollView>
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

/** Rename and delete (with undo) the saved list. */
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

  const commit = (saved: SavedFood) => {
    const name = draftName.trim();
    setEditing(null);
    if (name.length === 0) {
      toast.error(t("favorites.toast.nameEmpty"));
      return;
    }
    if (name !== saved.name) favorites.rename(saved.id, name);
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={t("favorites.sheet.title")}>
      {favorites.items.length === 0 ? (
        <Text style={styles.empty}>
          {t("favorites.sheet.empty")}
        </Text>
      ) : (
        <ListGroup>
          {favorites.items.map((saved) => {
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
                      accessibilityLabel={t("favorites.sheet.rename", { name: saved.name })}
                      onPress={() => {
                        setDraftName(saved.name);
                        setEditing(saved.id);
                      }}
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
  editRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  editInput: { flex: 1 },
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
}));
