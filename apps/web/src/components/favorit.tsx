import { MEAL_LABELS } from "@joyorogo/api/lib/engine";
import type { Meal } from "@joyorogo/api/lib/engine";
import { foodSavedKey, moveId, plateSavedKey } from "@joyorogo/api/lib/saved-foods";
import { kcalUnit } from "@joyorogo/i18n";
import type { TFunction } from "@joyorogo/i18n";
import { removeById } from "@joyorogo/api/lib/optimistic";
import { Button } from "@joyorogo/ui/components/button";
import { Input } from "@joyorogo/ui/components/input";
import { Sheet } from "@joyorogo/ui/components/sheet";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, ChevronUp, EyeOff, Pencil, Plus, Star, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Chip } from "@/components/chip";
import { ListGroup, ListRow } from "@/components/kit/surface";
import { CutoutTile, FoodThumb } from "@/components/sticker";
import type { FavoriteOffer, FoodItem, FoodRecentItem, SavedFood, SavedFoodRelog } from "@/lib/api-types";
import { fmtRupiah } from "@/lib/app-config";
import { fmtKcalLabel, parseNum } from "@/lib/format";
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

  const offerKey = () => orpc.savedFood.offer.queryOptions().queryKey;
  const recentKey = () => orpc.food.recent.queryOptions().queryKey;
  type RecentData = { items: FoodRecentItem[]; hiddenCount: number };
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
    invalidate: () => [orpc.savedFood.key(), orpc.food.recent.key()],
    success: (_input, row) => ({ message: t("favorites.toast.created", { name: row.name }) }),
  });

  const update = useOptimisticMutation<{ id: string; name?: string; kcal?: number }, SavedFood>({
    mutationFn: (input) => client.savedFood.update(input),
    invalidate: () => [orpc.savedFood.key()],
    success: () => ({ message: t("favorites.toast.updated") }),
  });

  // A recent food (or the offered habit) becomes a favorite; the chip leaves the recent list.
  const promote = useOptimisticMutation<{ id: string; name: string }, SavedFood>({
    mutationFn: ({ id }) => client.savedFood.save({ foodId: id }),
    patch: ({ name }, cache) =>
      cache.value<RecentData>(recentKey(), (old) =>
        old ? { ...old, items: old.items.filter((row) => row.name !== name) } : old,
      ),
    invalidate: () => [orpc.savedFood.key(), orpc.food.recent.key(), orpc.savedFood.offer.key()],
    success: (_input, row) => ({ message: t("favorites.toast.saved", { name: row.name }) }),
  });

  const saveOffered = useOptimisticMutation<FavoriteOffer, SavedFood>({
    mutationFn: (offer) =>
      client.savedFood.save(offer.kind === "plate" ? { plateId: offer.targetId } : { foodId: offer.targetId }),
    patch: (_offer, cache) => cache.value<{ offer: FavoriteOffer | null }>(offerKey(), () => ({ offer: null })),
    invalidate: () => [orpc.savedFood.key(), orpc.food.recent.key(), orpc.savedFood.offer.key()],
    success: (_offer, row) => ({ message: t("favorites.toast.saved", { name: row.name }) }),
  });

  const dismissOffered = useOptimisticMutation<FavoriteOffer, unknown>({
    mutationFn: (offer) => client.savedFood.dismissOffer({ key: offer.key }),
    patch: (_offer, cache) => cache.value<{ offer: FavoriteOffer | null }>(offerKey(), () => ({ offer: null })),
    invalidate: () => [orpc.savedFood.offer.key()],
  });

  const hide = useOptimisticMutation<{ name: string }, unknown>({
    mutationFn: ({ name }) => client.food.hideRecent({ name }),
    patch: ({ name }, cache) =>
      cache.value<RecentData>(recentKey(), (old) =>
        old ? { items: old.items.filter((row) => row.name !== name), hiddenCount: old.hiddenCount + 1 } : old,
      ),
    invalidate: () => [orpc.food.recent.key()],
    success: ({ name }) => ({ message: t("favorites.toast.hidden", { name }) }),
  });

  const restore = useOptimisticMutation<void, unknown>({
    mutationFn: () => client.food.restoreRecent(),
    invalidate: () => [orpc.food.recent.key()],
    success: () => ({ message: t("favorites.toast.restored") }),
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

  const offer = offerQuery.data?.offer ?? null;
  return {
    items,
    isPending: query.isPending,
    recent: recentQuery.data?.items ?? [],
    hiddenCount: recentQuery.data?.hiddenCount ?? 0,
    offer,
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
    remove: removeMutation,
    move: (id: string, step: -1 | 1) => arrange.mutate({ ids: moveId(items.map((row) => row.id), id, step) }),
    create: (input: { name: string; kcal: number }, onDone: () => void) => create.mutate(input, { onSuccess: onDone }),
    createPending: create.isPending,
    update: (id: string, patch: { name?: string; kcal?: number }, onDone: () => void) =>
      update.mutate({ id, ...patch }, { onSuccess: onDone }),
    saveRecent: (food: FoodRecentItem) => promote.mutate({ id: food.id, name: food.name }),
    hideRecent: (name: string) => hide.mutate({ name }),
    restoreRecent: () => restore.mutate(),
    saveOffer: () => offer && saveOffered.mutate(offer),
    dismissOffer: () => offer && dismissOffered.mutate(offer),
  };
}

/** Favorit state and actions returned by useFavorites. */
export interface Favorites {
  items: SavedFood[];
  isPending: boolean;
  /** Recently logged foods for the chips (hidden ones and one-food favorites left out), newest first. */
  recent: FoodRecentItem[];
  /** How many of the newest names the user hid from the recent chips. */
  hiddenCount: number;
  /** The food or combo logged 3+ times in 14 days that is worth saving; null = nothing to offer. */
  offer: FavoriteOffer | null;
  isFoodSaved: (row: FoodItem) => boolean;
  isPlateSaved: (plate: FavoritPlate, rows: ReadonlyArray<FoodItem>) => boolean;
  toggleFood: (row: FoodItem) => void;
  togglePlate: (plate: FavoritPlate, rows: ReadonlyArray<FoodItem>) => void;
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
  saveRecent: (food: FoodRecentItem) => void;
  hideRecent: (name: string) => void;
  restoreRecent: () => void;
  saveOffer: () => void;
  dismissOffer: () => void;
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
    <div className="flex flex-wrap gap-2">
      {favorites.items.map((saved) => (
        <Chip
          key={saved.id}
          className={`max-w-full ${saved.items[0]?.scanId ? "gap-1.5 pl-1.5" : ""}`}
          disabled={favorites.relogPending || saved.id.startsWith("tmp-")}
          onClick={() => favorites.relog(saved, date, meal)}
        >
          {saved.items[0]?.scanId ? (
            <CutoutTile
              scanId={saved.items[0].scanId}
              className="size-8 rounded-lg"
              iconClassName="size-4"
            />
          ) : (
            <Star className="mr-1.5 size-3.5 shrink-0 fill-current text-makan-ink" aria-hidden />
          )}
          <span className="truncate">
            {saved.name} · {fmtKcalLabel(saved.kcal)}
          </span>
        </Chip>
      ))}
      {showManage && (
        <Chip onClick={onManage} className="bg-transparent text-muted-foreground">
          {t("favorites.manage")}
        </Chip>
      )}
    </div>
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
    <div role="group" aria-label={t("favorites.offer.title")} className="mt-4 rounded-2xl bg-makan-soft p-4">
      <p className="text-sm font-bold text-makan-ink">{t("favorites.offer.title")}</p>
      <p className="mt-1 text-sm text-pretty text-makan-ink">
        {t("favorites.offer.body", { name: offer.name, count: offer.count, kcal: fmtKcalLabel(offer.kcal) })}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" onClick={favorites.saveOffer}>
          <Star className="fill-current" aria-hidden />
          {t("favorites.offer.save")}
        </Button>
        <Button size="sm" variant="ghost" onClick={favorites.dismissOffer}>
          {t("favorites.offer.later")}
        </Button>
      </div>
    </div>
  );
}

/** Catat cepat > Atur: reorder, edit, remove and add favorites; hide or promote the recent chips. */
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
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t("favorites.sheet.title")}
      description={t("favorites.sheet.description")}
    >
      <div className="space-y-6">
        <section aria-label={t("favorites.sheet.favoritesTitle")}>
          <h3 className="mb-2 px-1 text-sm font-bold">{t("favorites.sheet.favoritesTitle")}</h3>
          {favorites.items.length === 0 ? (
            <p className="rounded-2xl bg-muted px-4 py-5 text-center text-sm text-muted-foreground">
              {t("favorites.sheet.empty")}
            </p>
          ) : (
            <ListGroup className="bg-muted/50">
              {favorites.items.map((saved, index) => {
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
                      isEditing ? (
                        <span className="flex items-center gap-1.5">
                          <Input
                            type="number"
                            min="1"
                            inputMode="numeric"
                            value={draftKcal}
                            aria-label={t("favorites.sheet.kcalAria", { name: saved.name })}
                            onChange={(event) => setDraftKcal(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") commit(saved);
                              if (event.key === "Escape") setEditing(null);
                            }}
                            onClick={(event) => event.stopPropagation()}
                            className="h-9 w-24 text-right tabular-nums"
                          />
                          <span>{kcalUnit()}</span>
                        </span>
                      ) : (
                        <span className="flex flex-col">
                          <span className="tabular-nums">{describe(saved, t)}</span>
                          {saved.priceIdr != null && (
                            <span className="tabular-nums">{fmtRupiah(saved.priceIdr)}</span>
                          )}
                        </span>
                      )
                    }
                    trailing={
                      <>
                        {!isEditing && (
                          <>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={t("favorites.sheet.moveUp", { name: saved.name })}
                              disabled={index === 0}
                              onClick={() => favorites.move(saved.id, -1)}
                              className="text-muted-foreground hover:text-foreground"
                            >
                              <ChevronUp />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={t("favorites.sheet.moveDown", { name: saved.name })}
                              disabled={index === last}
                              onClick={() => favorites.move(saved.id, 1)}
                              className="text-muted-foreground hover:text-foreground"
                            >
                              <ChevronDown />
                            </Button>
                          </>
                        )}
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={
                            isEditing
                              ? t("favorites.sheet.saveName", { name: saved.name })
                              : t("favorites.sheet.rename", { name: saved.name })
                          }
                          onClick={() => (isEditing ? commit(saved) : startEdit(saved))}
                          className="text-muted-foreground hover:text-foreground"
                        >
                          {isEditing ? <Check /> : <Pencil />}
                        </Button>
                        {!isEditing && (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={t("favorites.sheet.remove", { name: saved.name })}
                            onClick={() => favorites.remove(saved)}
                            className="text-muted-foreground hover:text-destructive"
                          >
                            <Trash2 />
                          </Button>
                        )}
                      </>
                    }
                  />
                );
              })}
            </ListGroup>
          )}
          {adding ? (
            <form
              className="mt-3 flex flex-wrap items-end gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                submitAdd();
              }}
            >
              <label className="min-w-40 flex-1 text-xs font-semibold text-muted-foreground">
                {t("favorites.sheet.addName")}
                <Input
                  autoFocus
                  value={addName}
                  maxLength={200}
                  placeholder={t("favorites.sheet.addNamePlaceholder")}
                  onChange={(event) => setAddName(event.target.value)}
                  className="mt-1"
                />
              </label>
              <label className="w-28 text-xs font-semibold text-muted-foreground">
                {t("favorites.sheet.addKcal")}
                <Input
                  type="number"
                  min="1"
                  inputMode="numeric"
                  value={addKcal}
                  onChange={(event) => setAddKcal(event.target.value)}
                  className="mt-1 text-right tabular-nums"
                />
              </label>
              <Button type="submit" disabled={favorites.createPending}>
                {t("favorites.sheet.addSave")}
              </Button>
            </form>
          ) : (
            <Button variant="secondary" size="sm" className="mt-3" onClick={() => setAdding(true)}>
              <Plus aria-hidden />
              {t("favorites.sheet.add")}
            </Button>
          )}
        </section>

        {(favorites.recent.length > 0 || favorites.hiddenCount > 0) && (
          <section aria-label={t("favorites.sheet.recentTitle")}>
            <h3 className="px-1 text-sm font-bold">{t("favorites.sheet.recentTitle")}</h3>
            <p className="mt-0.5 mb-2 px-1 text-xs text-muted-foreground">{t("favorites.sheet.recentHint")}</p>
            {favorites.recent.length > 0 && (
              <ListGroup className="bg-muted/50">
                {favorites.recent.map((food) => (
                  <ListRow
                    key={food.name}
                    wrapTitle
                    icon={
                      <FoodThumb
                        scanId={food.scanId}
                        name={food.name}
                        className="size-14"
                        iconClassName="size-5"
                      />
                    }
                    title={food.name}
                    subtitle={<span className="tabular-nums">{fmtKcalLabel(food.kcal)}</span>}
                    trailing={
                      <>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={t("favorites.sheet.recentSave", { name: food.name })}
                          onClick={() => favorites.saveRecent(food)}
                          className="text-muted-foreground hover:text-foreground"
                        >
                          <Star />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={t("favorites.sheet.recentHide", { name: food.name })}
                          onClick={() => favorites.hideRecent(food.name)}
                          className="text-muted-foreground hover:text-foreground"
                        >
                          <EyeOff />
                        </Button>
                      </>
                    }
                  />
                ))}
              </ListGroup>
            )}
            {favorites.hiddenCount > 0 && (
              <Button variant="ghost" size="sm" className="mt-2" onClick={favorites.restoreRecent}>
                {t("favorites.sheet.showHidden", { count: favorites.hiddenCount })}
              </Button>
            )}
          </section>
        )}
      </div>
    </Sheet>
  );
}
