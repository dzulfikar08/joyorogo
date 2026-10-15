import { MEAL_LABELS } from "@joyorogo/api/lib/engine";
import type { Meal } from "@joyorogo/api/lib/engine";
import { foodSavedKey, plateSavedKey } from "@joyorogo/api/lib/saved-foods";
import { removeById } from "@joyorogo/api/lib/optimistic";
import { Button } from "@joyorogo/ui/components/button";
import { Input } from "@joyorogo/ui/components/input";
import { Sheet } from "@joyorogo/ui/components/sheet";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Pencil, Star, Trash2, Utensils } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Chip } from "@/components/chip";
import { ListGroup, ListRow } from "@/components/kit/surface";
import { Sticker } from "@/components/sticker";
import type { FoodItem, SavedFood, SavedFoodRelog } from "@/lib/api-types";
import { fmtRupiah } from "@/lib/app-config";
import { fmtInt } from "@/lib/format";
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
      message: `${row.name} masuk Favorit`,
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
    label: (row) => `${row.name} dari Favorit`,
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
      message: `${saved.name} dicatat ke ${MEAL_LABELS[meal]}`,
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
  /** Delayed delete with an Urungkan toast. */
  remove: (saved: SavedFood) => void;
}

function describe(saved: SavedFood): string {
  const parts = [`${fmtInt(saved.kcal)} kcal`];
  if (saved.items.length > 1) parts.push(`${saved.items.length} item`);
  return parts.join(" · ");
}

/** Star toggle for a diary row or plate header. */
export function FavoritStar({
  active,
  label,
  onToggle,
}: {
  active: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={active ? `Hapus ${label} dari Favorit` : `Simpan ${label} ke Favorit`}
      aria-pressed={active}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
      className={active ? "text-makan-ink" : "text-muted-foreground hover:text-foreground"}
    >
      <Star className={active ? "fill-current" : undefined} />
    </Button>
  );
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
  if (favorites.items.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {favorites.items.map((saved) => (
        <Chip
          key={saved.id}
          disabled={favorites.relogPending || saved.id.startsWith("tmp-")}
          onClick={() => favorites.relog(saved, date, meal)}
        >
          <Star className="mr-1.5 size-3.5 fill-current text-makan-ink" aria-hidden />
          {saved.name} · {fmtInt(saved.kcal)} kcal
        </Chip>
      ))}
      <Chip onClick={onManage} className="bg-transparent text-muted-foreground">
        Kelola
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
  const [editing, setEditing] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");

  const commit = (saved: SavedFood) => {
    const name = draftName.trim();
    setEditing(null);
    if (name.length === 0) {
      toast.error("Nama tidak boleh kosong");
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
      title="Kelola Favorit"
      description="Ganti nama atau hapus. Hapus bisa dibatalkan beberapa detik."
    >
      {favorites.items.length === 0 ? (
        <p className="rounded-2xl bg-muted px-4 py-5 text-center text-sm text-muted-foreground">
          Belum ada favorit. Tekan bintang di makanan atau piring untuk menyimpannya.
        </p>
      ) : (
        <ListGroup className="bg-muted/50">
          {favorites.items.map((saved) => {
            const first = saved.items[0];
            const utensil = (
              <span
                className="flex size-9 items-center justify-center rounded-full bg-makan-soft"
                aria-hidden
              >
                <Utensils className="size-4 text-makan-ink" />
              </span>
            );
            const isEditing = editing === saved.id;
            return (
              <ListRow
                key={saved.id}
                icon={
                  first?.scanId ? (
                    <Sticker
                      scanId={first.scanId}
                      photoId={first.photoId}
                      name={saved.name}
                      className="block size-10"
                      fallback={utensil}
                    />
                  ) : (
                    utensil
                  )
                }
                title={
                  isEditing ? (
                    <Input
                      autoFocus
                      value={draftName}
                      maxLength={200}
                      aria-label={`Nama baru untuk ${saved.name}`}
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
                    <span className="tabular-nums">{describe(saved)}</span>
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
                      aria-label={isEditing ? `Simpan nama ${saved.name}` : `Ganti nama ${saved.name}`}
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
                      aria-label={`Hapus ${saved.name} dari Favorit`}
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
