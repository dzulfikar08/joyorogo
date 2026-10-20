import { MEAL_LABELS } from "@joyorogo/api/lib/engine";
import type { Meal } from "@joyorogo/api/lib/engine";
import { foodSavedKey, plateSavedKey } from "@joyorogo/api/lib/saved-foods";
import type { TFunction } from "@joyorogo/i18n";
import { removeById } from "@joyorogo/api/lib/optimistic";
import { Button } from "@joyorogo/ui/components/button";
import { Input } from "@joyorogo/ui/components/input";
import { Sheet } from "@joyorogo/ui/components/sheet";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Pencil, Star, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Chip } from "@/components/chip";
import { ListGroup, ListRow } from "@/components/kit/surface";
import { FoodThumb, STICKER_FILTER, stickerUrl } from "@/components/sticker";
import type { FoodItem, SavedFood, SavedFoodRelog } from "@/lib/api-types";
import { fmtRupiah } from "@/lib/app-config";
import { fmtKcalLabel } from "@/lib/format";
import { insertFoodRow, OptimisticCache, useDelayedDelete, useOptimisticMutation } from "@/lib/optimistic";
import { client, orpc } from "@/utils/orpc";

type SavedList = { items: SavedFood[] };

const listKey = () => orpc.savedFood.list.queryOptions().queryKey;
const dayKey = (date: string) => orpc.food.listByDate.queryOptions({ input: { date } }).queryKey;

/** A diary plate as PlateDiary hands it to its action slot. */
export type FavoritPlate = { id: string; name: string; place: string | null };

type RelogInput = { saved: SavedFood; date: string; meal: Meal };
type SaveInput = { target: { foodId: string } | { plateId: string }; draft: SavedFood };

/**
 * Favorit state shared by Makan, the add sheet and the star actions: the
 * list, star toggles for rows and plates, one-tap re-log, rename, and a
 * delayed delete. Mount once per page (pending deletes flush on unmount).
 */
export function useFavorites() {
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
        const cache = new OptimisticCache(queryClient);
        cache.value<SavedList>(listKey(), (old) =>
          old ? { ...old, items: removeById(old.items, row.id) } : old,
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
        old ? { ...old, items: removeById(old.items, row.id) } : old,
      ),
    label: (row) => t("favorites.deletedLabel", { name: row.name }),
    invalidate: () => [orpc.savedFood.key()],
  });

  const rename = useOptimisticMutation<{ id: string; name: string }, unknown>({
    mutationFn: (input) => client.savedFood.rename(input),
    patch: ({ id, name }, cache) =>
      cache.value<SavedList>(listKey(), (old) =>
        old
          ? { ...old, items: old.items.map((row) => (row.id === id ? { ...row, name } : row)) }
          : old,
      ),
    invalidate: () => [orpc.savedFood.key()],
  });

  const relogMutation = useOptimisticMutation<RelogInput, SavedFoodRelog>({
    mutationFn: ({ saved, date, meal }) => client.savedFood.relog({ id: saved.id, date, meal }),
    patch: ({ saved, date, meal }, cache) => {
      for (const item of saved.items) {
        const row = {
          id: crypto.randomUUID(),
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
          source: item.scanId ? ("ai" as const) : ("manual" as const),
          itemsJson: null,
          scanId: item.scanId,
          photoId: item.photoId,
          plateId: null,
          eatenAt: null,
          createdAt: new Date(),
        } as FoodItem;
        insertFoodRow(cache, dayKey(date), row);
        cache.summary({
          date,
          kcal: item.kcal,
          protein: item.protein ?? undefined,
          carbs: item.carbs ?? undefined,
          fat: item.fat ?? undefined,
          meal,
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
    priceIdr: number | null,
    key: string,
    rows: ReadonlyArray<FoodItem>,
  ): SavedFood =>
    ({
      id: `tmp-${key}`,
      userId: "",
      name,
      place,
      priceIdr,
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
    }) as SavedFood;

  return {
    items,
    isPending: query.isPending,
    isFoodSaved: (row: FoodItem) => byKey.has(foodSavedKey(row.name, row.kcal)),
    isPlateSaved: (plate: FavoritPlate, rows: ReadonlyArray<FoodItem>) =>
      byKey.has(plateSavedKey(plate.name, plate.place, rows)),
    toggleFood: (row: FoodItem) => {
      const key = foodSavedKey(row.name, row.kcal);
      const existing = byKey.get(key);
      if (existing) return removeMutation(existing);
      saveMutation.mutate({ target: { foodId: row.id }, draft: draft(row.name, null, null, key, [row]) });
    },
    togglePlate: (plate: FavoritPlate, rows: ReadonlyArray<FoodItem>) => {
      const key = plateSavedKey(plate.name, plate.place, rows);
      const existing = byKey.get(key);
      if (existing) return removeMutation(existing);
      saveMutation.mutate({
        target: { plateId: plate.id },
        draft: draft(plate.name, plate.place, null, key, rows),
      });
    },
    relog: (saved: SavedFood, date: string, meal: Meal) => relogMutation.mutate({ saved, date, meal }),
    relogPending: relogMutation.isPending,
    rename: (id: string, name: string) => rename.mutate({ id, name }),
    remove: removeMutation,
  };
}

/** Favorit state and actions returned by useFavorites. */
export interface Favorites {
  items: SavedFood[];
  isPending: boolean;
  isFoodSaved: (row: FoodItem) => boolean;
  isPlateSaved: (plate: FavoritPlate, rows: ReadonlyArray<FoodItem>) => boolean;
  toggleFood: (row: FoodItem) => void;
  togglePlate: (plate: FavoritPlate, rows: ReadonlyArray<FoodItem>) => void;
  /** Logs a favorite to `date` + `meal` in one tap. */
  relog: (saved: SavedFood, date: string, meal: Meal) => void;
  relogPending: boolean;
  rename: (id: string, name: string) => void;
  /** Delayed delete with an undo toast. */
  remove: (saved: SavedFood) => void;
}

function describe(saved: SavedFood, t: TFunction<"makan">): string {
  const parts = [fmtKcalLabel(saved.kcal)];
  if (saved.items.length > 1) {
    parts.push(t("favorites.itemCount", { count: saved.items.length }));
  }
  return parts.join(" · ");
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
    <div className="flex flex-wrap gap-2">
      {favorites.items.map((saved) => (
        <Chip
          key={saved.id}
          className={`max-w-full ${saved.items[0]?.scanId ? "gap-1.5 pl-1.5" : ""}`}
          disabled={favorites.relogPending || saved.id.startsWith("tmp-")}
          onClick={() => favorites.relog(saved, date, meal)}
        >
          {saved.items[0]?.scanId ? (
            <img
              src={stickerUrl(saved.items[0].scanId)}
              alt=""
              loading="lazy"
              className="size-8 shrink-0 object-contain"
              style={STICKER_FILTER}
            />
          ) : (
            <Star className="mr-1.5 size-3.5 shrink-0 fill-current text-makan-ink" aria-hidden />
          )}
          <span className="truncate">
            {saved.name} · {fmtKcalLabel(saved.kcal)}
          </span>
        </Chip>
      ))}
      <Chip onClick={onManage} className="bg-transparent text-muted-foreground">
        {t("favorites.manage")}
      </Chip>
    </div>
  );
}

/** Rename and delete (with undo) the saved list. */
export function FavoritManageSheet({
  favorites,
  onClose,
}: {
  favorites: Favorites;
  onClose: () => void;
}) {
  const { t } = useTranslation("makan");
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
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t("favorites.sheet.title")}
      description={t("favorites.sheet.description")}
    >
      {favorites.items.length === 0 ? (
        <p className="rounded-2xl bg-muted px-4 py-5 text-center text-sm text-muted-foreground">
          {t("favorites.sheet.empty")}
        </p>
      ) : (
        <ListGroup className="bg-muted/50">
          {favorites.items.map((saved) => {
            const first = saved.items[0];
            const isEditing = editing === saved.id;
            return (
              <ListRow
                key={saved.id}
                wrapTitle
                icon={
                  <FoodThumb
                    scanId={first?.scanId}
                    photoId={first?.photoId}
                    name={saved.name}
                    className="size-14"
                    iconClassName="size-5"
                  />
                }
                title={
                  isEditing ? (
                    <Input
                      autoFocus
                      value={draftName}
                      maxLength={200}
                      aria-label={t("favorites.sheet.newName", { name: saved.name })}
                      onChange={(event) => setDraftName(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") commit(saved);
                        if (event.key === "Escape") setEditing(null);
                      }}
                      onClick={(event) => event.stopPropagation()}
                    />
                  ) : (
                    saved.name
                  )
                }
                subtitle={
                  <span className="flex flex-col">
                    <span className="tabular-nums">{describe(saved, t)}</span>
                    {saved.priceIdr != null && (
                      <span className="tabular-nums">{fmtRupiah(saved.priceIdr)}</span>
                    )}
                  </span>
                }
                trailing={
                  <>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={
                        isEditing
                          ? t("favorites.sheet.saveName", { name: saved.name })
                          : t("favorites.sheet.rename", { name: saved.name })
                      }
                      onClick={() => {
                        if (isEditing) {
                          commit(saved);
                        } else {
                          setDraftName(saved.name);
                          setEditing(saved.id);
                        }
                      }}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      {isEditing ? <Check /> : <Pencil />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("favorites.sheet.remove", { name: saved.name })}
                      onClick={() => favorites.remove(saved)}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 />
                    </Button>
                  </>
                }
              />
            );
          })}
        </ListGroup>
      )}
    </Sheet>
  );
}
