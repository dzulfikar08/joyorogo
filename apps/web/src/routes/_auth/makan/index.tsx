import {
  MEAL_LABELS,
  effectiveRamadan,
  jakartaToday,
  relativeDayLabel,
  slotsFor,
  suggestMealNow,
} from "@joyorogo/api/lib/engine";
import type { Meal } from "@joyorogo/api/lib/engine";
import { parseIdrInput } from "@joyorogo/api/lib/format";
import { Button } from "@joyorogo/ui/components/button";
import { Input } from "@joyorogo/ui/components/input";
import { Sheet } from "@joyorogo/ui/components/sheet";
import { Skeleton } from "@joyorogo/ui/components/skeleton";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Camera, ChevronRight, Mic, Plus, ScanBarcode } from "lucide-react";
import { useRef, useState } from "react";

import { Mascot } from "@/components/mascot";
import { Cerita } from "@/components/cerita";
import type { CeritaPhase } from "@/components/cerita";
import { Chip } from "@/components/chip";
import { DaySwitcher } from "@/components/day-switcher";
import { ShareToFeedSheet } from "@/components/feed/share-to-feed";
import { FieldLabel, ListGroup, Page, PageHeader, SectionTitle } from "@/components/kit/surface";
import { MakanSummaryCard } from "@/components/macro-card";
import { FoodPortionSheet } from "@/components/food-portion-sheet";
import { FavoritChips, FavoritManageSheet, useFavorites } from "@/components/favorit";
import { SheetActions } from "@/components/sheet-actions";
import type { Favorites } from "@/components/favorit";
import { MetaLine } from "@/components/meta-line";
import { BelanjaCard } from "@/components/plate/belanja";
import { PlateDiary } from "@/components/plate/plate-group";
import { IdrInput } from "@/components/plate/idr-input";
import { ScreenError } from "@/components/screen-state";
import { STICKER_FILTER, stickerUrl } from "@/components/sticker";
import { FoodRow } from "@/components/makan/food-row";
import { FitnessCard } from "@/components/makan/fitness-card";
import type { FoodAddInput, FoodItem, FoodRecentItem } from "@/lib/api-types";
import { fmtDateIndo, fmtInt, parseNum } from "@/lib/format";
import { OptimisticCache, useDelayedDelete, useOptimisticMutation } from "@/lib/optimistic";
import { upsertById, removeById } from "@joyorogo/api/lib/optimistic";
import { client, orpc } from "@/utils/orpc";
import { KalenderView } from "@/components/makan/kalender-view";
import { KindChips } from "@/components/makan/kind-chips";
import { MonthScrubber } from "@/components/makan/month-scrubber";
import { StikerView } from "@/components/makan/stiker-view";
import { MakanViewSwitcher } from "@/components/makan/view-switcher";
import { KindPicker, SnackAdviceCard, useSnackAdvice } from "@/components/makan/snack-advice";
import type { PickableKind } from "@/components/makan/snack-advice";
import { PlacesView } from "@/components/places/places-view";
import { SaveLocationToggle } from "@/components/places/location-toggle";
import { usePlaceLocation } from "@/lib/location";
import { saveKind, saveMakanView, storedKind, storedMakanView } from "@/lib/makan-prefs";
import { parseMakanView } from "@joyorogo/api/lib/diary-view";
import type { MakanView } from "@joyorogo/api/lib/diary-view";
import {
  FOOD_KIND_LABELS,
  foodKind,
  matchesKind,
  parseFoodKindFilter,
} from "@joyorogo/api/lib/food-kind";
import type { FoodKindFilter } from "@joyorogo/api/lib/food-kind";

// One options object per query, reused by the loader and the component so the
// cache keys match and navigation preloads land in the exact bucket read here.
const listOptions = (date: string) => orpc.food.listByDate.queryOptions({ input: { date } });
const summaryOptions = (date: string) => orpc.day.summary.queryOptions({ input: { date } });
const plateOptions = (date: string) => orpc.plate.byDate.queryOptions({ input: { date } });

export const Route = createFileRoute("/_auth/makan/")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { date?: string; cerita?: boolean; view?: MakanView; kind?: FoodKindFilter } => {
    const raw = typeof search.date === "string" ? search.date : undefined;
    const date = raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : undefined;
    // ?cerita=1 opens the story sheet (deep link from Beranda and the camera page).
    const cerita =
      search.cerita === true || search.cerita === 1 || search.cerita === "1" || undefined;
    // ?view= picks the Makan view, ?kind= the Semua/Makanan/Minuman/Lainnya chip.
    return {
      date,
      cerita,
      view: parseMakanView(search.view),
      kind: parseFoodKindFilter(search.kind),
    };
  },
  loaderDeps: ({ search }) => ({ date: search.date }),
  loader: ({ context, deps }) => {
    const date = deps.date ?? jakartaToday();
    void context.queryClient.ensureQueryData(listOptions(date));
    return context.queryClient.ensureQueryData(summaryOptions(date));
  },
  pendingComponent: MakanSkeleton,
  component: MakanPage,
});

function MakanPage() {
  const queryClient = useQueryClient();
  const {
    date: paramDate,
    cerita: ceritaOpen,
    view: paramView,
    kind: paramKind,
  } = Route.useSearch();
  // Deep links with a date or the story sheet mean the day list; otherwise the
  // last chosen view (URL first, then this device's saved choice).
  const view: MakanView =
    paramView ?? (paramDate || ceritaOpen ? "daftar" : (storedMakanView() ?? "daftar"));
  const kind: FoodKindFilter = paramKind ?? storedKind() ?? "semua";
  const navigate = Route.useNavigate();
  const date = paramDate ?? jakartaToday();
  const isToday = date === jakartaToday();
  const list = useQuery(listOptions(date));
  const daySummary = useQuery(summaryOptions(date));
  const recent = useQuery(orpc.food.recent.queryOptions());
  const profile = useQuery(orpc.profile.myProfile.queryOptions());
  const ramadan = effectiveRamadan(profile.data?.profile?.ramadanMode);
  const MEALS = (Object.entries(MEAL_LABELS) as Array<[Meal, string]>).filter(([meal]) =>
    slotsFor(ramadan).includes(meal),
  );
  const slots = slotsFor(ramadan);
  const quickMeal = suggestMealNow(new Date(), ramadan);
  // One shared add sheet; the meal slot is the only thing that changes.
  const [sheetMeal, setSheetMeal] = useState<Meal | null>(null);
  // Bagikan ke feed: item makanan yang sedang dibagikan (sheet di bawah).
  const [shareItem, setShareItem] = useState<FoodItem | null>(null);
  const [editItem, setEditItem] = useState<FoodItem | null>(null);
  const favorites = useFavorites();
  const [manageOpen, setManageOpen] = useState(false);
  const setCeritaOpen = (open: boolean) =>
    navigate({ search: (prev) => ({ ...prev, cerita: open || undefined }), replace: true });
  // Day moves keep the chosen view and kind chip; opening a day from the
  // calendar or the places list lands on Daftar.
  const showDate = (target: string) =>
    navigate({
      search: (prev) => ({
        view: prev.view,
        kind: prev.kind,
        date: target === jakartaToday() ? undefined : target,
      }),
    });
  const chooseView = (next: MakanView) => {
    saveMakanView(next);
    navigate({ search: (prev) => ({ ...prev, view: next }), replace: true });
  };
  const chooseKind = (next: FoodKindFilter) => {
    saveKind(next);
    navigate({ search: (prev) => ({ ...prev, kind: next }), replace: true });
  };
  const openDaftar = (target: string) => {
    saveMakanView("daftar");
    navigate({
      search: (prev) => ({
        view: "daftar",
        kind: prev.kind,
        date: target === jakartaToday() ? undefined : target,
      }),
    });
  };
  /** Kalender and Stiker read their own queries; nudge them after an edit. */
  const refreshDiary = () => void queryClient.invalidateQueries({ queryKey: orpc.diary.key() });

  /** Replaces a provisional row (temp id) with the settled server row, in place. */
  const cacheSwap = (tempId: string, row: FoodItem) => {
    queryClient.setQueryData<{ items: FoodItem[]; totals: { kcal: number } }>(
      listOptions(row.date).queryKey,
      (old) => (old ? { ...old, items: upsertById(removeById(old.items, tempId), row) } : old),
    );
  };

  /** food.listByDate caches hold { items, totals }: strip one row and pull
   * the rendered totals down with it (clamped, they are display values). */
  const stripFood = (cache: OptimisticCache, row: FoodItem) => {
    cache.value<{
      items: FoodItem[];
      totals: { kcal: number; protein: number; carbs: number; fat: number; fiber: number };
    }>(listOptions(row.date).queryKey, (old) => {
      if (!old || !old.items.some((item) => item.id === row.id)) return old;
      return {
        ...old,
        items: removeById(old.items, row.id),
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

  /** food.listByDate caches hold { items, totals }: land a row and lift the totals. */
  const insertFood = (cache: OptimisticCache, rowDate: string, row: FoodItem) => {
    cache.value<{
      items: FoodItem[];
      totals: { kcal: number; protein: number; carbs: number; fat: number; fiber: number };
    }>(listOptions(rowDate).queryKey, (old) =>
      old
        ? {
            ...old,
            items: upsertById(old.items, row),
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

  // Adds are instant: a provisional row lands in the cache and the server row
  // replaces it on settle. Undo reverts the cache and deletes the server row.
  const addTempId = useRef<string | null>(null);
  const revertAdd = (row: FoodItem) => {
    const cache = new OptimisticCache(queryClient);
    stripFood(cache, row);
    cache.summary({
      date: row.date,
      kcal: -row.kcal,
      protein: -(row.protein ?? 0),
      carbs: -(row.carbs ?? 0),
      fat: -(row.fat ?? 0),
      meal: row.meal,
      meals: -1,
    });
    void client.food.remove({ id: row.id });
  };
  const add = useOptimisticMutation<FoodAddInput, FoodItem | undefined>({
    mutationFn: (input) => client.food.add(input),
    patch: (input, cache) => {
      const rowDate = input.date ?? date;
      const tempId = crypto.randomUUID();
      addTempId.current = tempId;
      // Provisional placeholder until the server row (real id) replaces it on settle.
      const provisional = {
        id: tempId,
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
        source: input.source ?? ("manual" as const),
        itemsJson: input.itemsJson ?? null,
        scanId: input.scanId ?? null,
        photoId: null,
        plateId: input.plateId ?? null,
        createdAt: new Date(),
      } as FoodItem;
      insertFood(cache, rowDate, provisional);
      cache.summary({
        date: rowDate,
        kcal: input.kcal,
        protein: input.protein,
        carbs: input.carbs,
        fat: input.fat,
        meal: input.meal,
        meals: 1,
      });
    },
    invalidate: () => [orpc.food.key(), orpc.day.key(), orpc.diary.key()],
    success: (_input, serverRow) => {
      const row = serverRow as FoodItem;
      const tempId = addTempId.current;
      addTempId.current = null;
      if (tempId) {
        // Swap the provisional (temp id) for the server row before refetch lands.
        cacheSwap(tempId, row);
      }
      return row ? { message: `${row.name} dicatat`, undo: () => revertAdd(row) } : undefined;
    },
  });
  // Delayed-commit delete: row vanishes instantly, DELETE fires after the
  // undo window; undo restores with zero server calls.
  const removeFood = useDelayedDelete<FoodItem>({
    remove: (row) => client.food.remove({ id: row.id }),
    patch: (row, cache) => {
      // Read remaining items BEFORE the strip, to decide plate cleanup.
      const others = (
        queryClient.getQueryData<{ items: FoodItem[] }>(listOptions(row.date).queryKey)?.items ?? []
      ).filter((item) => item.id !== row.id && item.plateId === row.plateId);
      stripFood(cache, row);
      cache.summary({
        date: row.date,
        kcal: -row.kcal,
        protein: -(row.protein ?? 0),
        carbs: -(row.carbs ?? 0),
        fat: -(row.fat ?? 0),
        meal: row.meal,
        meals: -1,
      });
      // A plate with no components left disappears with its last item.
      if (row.plateId && others.length === 0) {
        cache.list<{ id: string }>(plateOptions(row.date).queryKey, (rows) =>
          removeById(rows, row.plateId as string),
        );
      }
    },
    label: (row) => row.name,
    fallback: "Catatan",
    invalidate: () => [orpc.food.key(), orpc.plate.key(), orpc.day.key(), orpc.diary.key()],
  });

  if (view === "daftar" && list.isPending) return <MakanSkeleton />;
  if (view === "daftar" && list.error) {
    return <ScreenError message={list.error.message} onRetry={() => list.refetch()} />;
  }

  const items = list.data?.items ?? [];
  const totals = list.data?.totals ?? { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 };
  const visibleItems = items.filter((item) => matchesKind(item.name, kind));

  return (
    <Page className="md:max-w-3xl">
      <PageHeader
        title="Makan"
        action={view === "daftar" ? <DaySwitcher date={date} onChange={showDate} /> : undefined}
      />

      <MakanViewSwitcher value={view} onChange={chooseView} />
      {view !== "tempat" && (
        <div className="mt-3">
          <KindChips value={kind} onChange={chooseKind} />
        </div>
      )}

      {view === "daftar" && (
        <>
          <div className="mt-5">
            <MonthScrubber date={date} kind={kind} onPick={showDate} />
          </div>

          {daySummary.data?.targets && daySummary.data.protein && (
            <div className="mt-3">
              <MakanSummaryCard
                eatKcal={daySummary.data.targets.eatKcal}
                eatenKcal={totals.kcal}
                proteinTargetG={daySummary.data.protein.targetG}
                totals={totals}
              />
            </div>
          )}

          <FitnessCard date={date} />

          {/* Belanja: angkanya selalu hari ini */}
          {isToday ? <BelanjaCard /> : null}

          <button
            type="button"
            onClick={() => setCeritaOpen(true)}
            className="mt-3 flex min-h-16 w-full items-center gap-3 rounded-3xl bg-card px-5 py-3 text-left transition-colors hover:bg-muted/60 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
          >
            <span
              aria-hidden
              className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"
            >
              <Mic className="size-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[0.9375rem] font-bold">Ceritakan makananmu</span>
              <span className="block text-sm text-muted-foreground">
                Ketik atau ucapkan, AI yang hitung kalorinya.
              </span>
            </span>
            <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
          </button>

          {favorites.items.length > 0 && (
            <section className="mt-3 rounded-3xl bg-card p-5" aria-label="Favorit">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="text-base font-bold tracking-tight">Favorit</h2>
                <span className="text-xs text-muted-foreground">
                  Tap untuk catat ke {MEAL_LABELS[quickMeal]}
                  {isToday ? "" : `, ${fmtDateIndo(date)}`}
                </span>
              </div>
              <div className="mt-3">
                <FavoritChips
                  favorites={favorites}
                  date={date}
                  meal={quickMeal}
                  onManage={() => setManageOpen(true)}
                />
              </div>
            </section>
          )}

          {items.length === 0 && (
            <div className="mt-3 rounded-3xl bg-card p-6 text-center">
              <Mascot pose="ready" size="md" className="mb-3" />
              <p className="text-base font-bold">
                Belum ada catatan {isToday ? "hari ini" : "di hari ini"}
              </p>
              <p className="mx-auto mt-1 max-w-xs text-sm text-muted-foreground">
                Ceritakan apa yang kamu makan, atau pindai foto piringmu biar AI yang hitung.
              </p>
              <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                <Button onClick={() => setSheetMeal(quickMeal)}>
                  <Plus className="size-4" aria-hidden />
                  Catat makan
                </Button>
                <Link to="/makan/ai" search={isToday ? {} : { date }}>
                  <Button variant="secondary">
                    <Camera className="size-4" aria-hidden />
                    Pindai foto
                  </Button>
                </Link>
              </div>
            </div>
          )}

          <div className="relative mt-5 pl-6">
            <span aria-hidden className="absolute top-3 bottom-0 left-1.5 w-px bg-border" />
            <div className="relative flex min-h-9 items-center gap-2.5">
              <span
                aria-hidden
                className="absolute top-1/2 -left-6 size-3 -translate-y-1/2 rounded-full border-[3px] border-primary bg-background"
              />
              <h2 className="min-w-0 truncate text-base font-bold tracking-tight">
                {relativeDayLabel(date, jakartaToday())}
              </h2>
              <span className="shrink-0 rounded-full bg-card px-2.5 py-0.5 text-xs font-semibold text-muted-foreground tabular-nums">
                {fmtInt(visibleItems.length)} catatan
              </span>
            </div>
            {MEALS.map(([meal, label]) => {
              const sectionItems = visibleItems.filter((item) => item.meal === meal);
              const subtotal = sectionItems.reduce((sum, item) => sum + item.kcal, 0);
              return (
                <section
                  key={meal}
                  className="relative mt-5"
                  aria-label={`${label}, total ${fmtInt(subtotal)} kcal`}
                >
                  <span
                    aria-hidden
                    className="absolute top-5 -left-[1.3125rem] size-1.5 rounded-full bg-primary/50"
                  />
                  <SectionTitle
                    action={
                      <button
                        type="button"
                        onClick={() => setSheetMeal(meal)}
                        className="inline-flex min-h-11 items-center gap-1 px-1 text-sm font-semibold text-primary transition-colors hover:text-primary/80 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
                      >
                        <Plus className="size-4" aria-hidden />
                        Tambah
                      </button>
                    }
                  >
                    <span className="flex items-baseline gap-2">
                      {label}
                      {sectionItems.length > 0 && (
                        <span className="text-xs font-semibold text-muted-foreground tabular-nums">
                          {fmtInt(subtotal)} kcal
                        </span>
                      )}
                    </span>
                  </SectionTitle>

                  {sectionItems.length > 0 ? (
                    <PlateDiary
                      items={sectionItems}
                      date={date}
                      renderRow={(item) => (
                        <FoodRow
                          key={item.id}
                          item={item}
                          onEdit={() => setEditItem(item)}
                          onDelete={() => removeFood(item)}
                        />
                      )}
                      plateAction={(plate, rows) => (
                        <SheetActions
                          favorite={favorites.isPlateSaved(plate, rows)}
                          onFavorite={() => favorites.togglePlate(plate, rows)}
                        />
                      )}
                    />
                  ) : (
                    <div className="rounded-3xl bg-card px-5 py-4 text-sm text-muted-foreground">
                      {kind === "semua"
                        ? "Belum ada catatan. Tekan Tambah di atas, atau pindai fotonya."
                        : `Tidak ada ${FOOD_KIND_LABELS[kind].toLowerCase()} di waktu makan ini.`}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        </>
      )}

      {view === "kalender" && (
        <KalenderView date={date} kind={kind} onSelect={showDate}>
          <section className="relative mt-6 pl-6" aria-label={`Catatan ${fmtDateIndo(date)}`}>
            <span
              aria-hidden
              className="absolute top-3 left-0 size-3 rounded-full border-[3px] border-primary bg-background"
            />
            <div className="flex min-h-9 items-center gap-2.5">
              <h2 className="min-w-0 truncate text-base font-bold tracking-tight">
                {relativeDayLabel(date, jakartaToday())}
              </h2>
              <span className="shrink-0 rounded-full bg-card px-2.5 py-0.5 text-xs font-semibold text-muted-foreground tabular-nums">
                {fmtInt(visibleItems.length)} catatan
              </span>
              <button
                type="button"
                onClick={() => openDaftar(date)}
                className="ml-auto inline-flex min-h-11 shrink-0 items-center gap-0.5 px-1 text-sm font-semibold text-primary transition-colors hover:text-primary/80 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
              >
                Buka di Daftar
                <ChevronRight className="size-4" aria-hidden />
              </button>
            </div>
            <div className="mt-1 border-t border-border pt-3">
              {list.isPending ? (
                <Skeleton className="h-24 w-full rounded-3xl" />
              ) : visibleItems.length > 0 ? (
                <ListGroup>
                  {visibleItems.map((item) => (
                    <FoodRow
                      key={item.id}
                      item={item}
                      onEdit={() => setEditItem(item)}
                      onDelete={() => removeFood(item)}
                    />
                  ))}
                </ListGroup>
              ) : (
                <div className="rounded-3xl bg-card px-5 py-4 text-sm text-muted-foreground">
                  {kind === "semua"
                    ? "Belum ada catatan di hari ini."
                    : `Tidak ada ${FOOD_KIND_LABELS[kind].toLowerCase()} di hari ini.`}
                </div>
              )}
            </div>
          </section>
        </KalenderView>
      )}

      {view === "stiker" && <StikerView date={date} kind={kind} onOpen={setEditItem} />}

      {view === "tempat" && <PlacesView onOpenDate={openDaftar} />}

      {sheetMeal !== null && (
        <AddFoodSheet
          key={sheetMeal}
          meal={sheetMeal}
          date={date}
          isToday={isToday}
          slots={slots}
          recent={recent.data?.items ?? []}
          favorites={favorites}
          onManage={() => {
            setSheetMeal(null);
            setManageOpen(true);
          }}
          addPending={add.isPending}
          onAdd={(input) => add.mutateAsync(input)}
          onShowDate={showDate}
          onClose={() => setSheetMeal(null)}
        />
      )}

      {manageOpen && (
        <FavoritManageSheet favorites={favorites} onClose={() => setManageOpen(false)} />
      )}

      {ceritaOpen && (
        <Sheet
          open
          onOpenChange={(open) => {
            if (!open) setCeritaOpen(false);
          }}
          title="Ceritakan makananmu"
          description="Bisa beberapa waktu makan sekaligus, bahkan kemarin. Kamu cek dulu sebelum disimpan."
        >
          <Cerita
            date={date}
            slots={slots}
            onSaved={() => {
              setCeritaOpen(false);
              refreshDiary();
            }}
            onShowDate={showDate}
          />
        </Sheet>
      )}

      {editItem && (
        <FoodPortionSheet
          key={editItem.id}
          row={editItem}
          onClose={() => {
            setEditItem(null);
            refreshDiary();
          }}
          favorite={favorites.isFoodSaved(editItem)}
          onFavorite={() => favorites.toggleFood(editItem)}
          onShare={() => {
            setShareItem(editItem);
            setEditItem(null);
          }}
          onDelete={() => {
            removeFood(editItem);
            setEditItem(null);
          }}
        />
      )}
      {shareItem && (
        <ShareToFeedSheet
          open
          onOpenChange={(open) => {
            if (!open) setShareItem(null);
          }}
          title="Bagikan makanan ini"
          preview={<MetaLine items={[shareItem.name, `${fmtInt(shareItem.kcal)} kcal`]} />}
          share={(input) =>
            client.social.createPost({
              kind: "makan",
              refId: shareItem.id,
              caption: input.caption || undefined,
              visibility: input.visibility,
            })
          }
        />
      )}
    </Page>
  );
}

function AddFoodSheet({
  meal,
  date,
  isToday,
  slots,
  recent,
  favorites,
  onManage,
  addPending,
  onAdd,
  onShowDate,
  onClose,
}: {
  meal: Meal;
  date: string;
  isToday: boolean;
  slots: Meal[];
  recent: FoodRecentItem[];
  favorites: Favorites;
  onManage: () => void;
  addPending: boolean;
  onAdd: (input: FoodAddInput) => Promise<unknown>;
  onShowDate: (date: string) => void;
  onClose: () => void;
}) {
  const [ceritaPhase, setCeritaPhase] = useState<CeritaPhase>("input");
  const [showManual, setShowManual] = useState(false);
  const [name, setName] = useState("");
  const [kcal, setKcal] = useState("");
  const [showMacros, setShowMacros] = useState(false);
  const [protein, setProtein] = useState("");
  const [carbs, setCarbs] = useState("");
  const [fat, setFat] = useState("");
  // Optional price for the whole plate; the dish name becomes the plate name.
  const [price, setPrice] = useState("");
  const [place, setPlace] = useState("");
  const placeLocation = usePlaceLocation();
  const [error, setError] = useState<string | null>(null);
  const label = MEAL_LABELS[meal];

  // Item kind: the name heuristic until the user taps a pill. Advice only.
  const [kindOverride, setKindOverride] = useState<PickableKind | null>(null);
  const kind = kindOverride ?? foodKind(name);
  const advice = useSnackAdvice({
    date,
    kcal: parseNum(kcal) ?? 0,
    kind,
    slot: meal,
    name: name.trim() || undefined,
  });
  // Fields as typed before "Setengah porsi", so one tap brings them back.
  const [fullPortion, setFullPortion] = useState<{
    kcal: string;
    protein: string;
    carbs: string;
    fat: string;
  } | null>(null);
  const halve = () => {
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
  const undoHalf = () => {
    if (!fullPortion) return;
    setKcal(fullPortion.kcal);
    setProtein(fullPortion.protein);
    setCarbs(fullPortion.carbs);
    setFat(fullPortion.fat);
    setFullPortion(null);
  };

  const submit = async () => {
    const nameClean = name.trim();
    const kcalNum = parseNum(kcal);
    if (nameClean.length === 0) {
      setError("Isi nama makanan dulu.");
      return;
    }
    if (kcalNum === null || kcalNum < 0) {
      setError("Isi jumlah kalori (angka).");
      return;
    }
    const proteinNum = showMacros ? parseNum(protein) : null;
    const carbsNum = showMacros ? parseNum(carbs) : null;
    const fatNum = showMacros ? parseNum(fat) : null;
    const priceNum = parseIdrInput(price);
    const placeClean = place.trim();
    if (price.trim() !== "" && priceNum === null) {
      setError("Harga belum valid (angka rupiah).");
      return;
    }
    setError(null);
    try {
      await onAdd({
        date,
        meal,
        name: nameClean,
        kcal: kcalNum,
        protein: proteinNum ?? undefined,
        carbs: carbsNum ?? undefined,
        fat: fatNum ?? undefined,
        ...(priceNum != null || placeClean
          ? {
              plate: {
                ...(priceNum != null ? { priceIdr: Math.round(priceNum) } : {}),
                ...(placeClean ? { place: placeClean } : {}),
                // Coordinates ride along only with a place name and only when opted in.
                ...(placeClean && placeLocation.enabled && placeLocation.coords
                  ? placeLocation.coords
                  : {}),
              },
            }
          : {}),
      });
      setName("");
      setKcal("");
      setKindOverride(null);
      setFullPortion(null);
      setProtein("");
      setCarbs("");
      setFat("");
      setPrice("");
      setPlace("");
      setShowMacros(false);
    } catch {
      // the mutation already toasts the server message
    }
  };

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={`Tambah ke ${label}`}
      description={
        isToday ? "Masuk ke catatan hari ini." : `Masuk ke catatan ${fmtDateIndo(date)}.`
      }
    >
      <div className="space-y-5">
        <Cerita
          meal={meal}
          date={date}
          slots={slots}
          onPhaseChange={setCeritaPhase}
          onSaved={onClose}
          onShowDate={onShowDate}
        />

        {ceritaPhase === "input" && favorites.items.length > 0 && (
          <div>
            <p className="text-sm font-bold">Favorit</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Tap untuk langsung masuk ke {label}.
            </p>
            <div className="mt-3">
              <FavoritChips favorites={favorites} date={date} meal={meal} onManage={onManage} />
            </div>
          </div>
        )}

        {ceritaPhase === "input" && recent.length > 0 && (
          <div>
            <p className="text-sm font-bold">Terakhir dicatat</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Tap untuk langsung masuk ke {label}.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {recent.map((food) => (
                <Chip
                  key={food.name}
                  active={false}
                  disabled={addPending}
                  className={food.scanId ? "max-w-full gap-2 pl-1.5" : "max-w-full"}
                  onClick={() => void onAdd({ date, meal, name: food.name, kcal: food.kcal })}
                >
                  {food.scanId ? (
                    <img
                      src={stickerUrl(food.scanId)}
                      alt=""
                      loading="lazy"
                      className="size-8 shrink-0 object-contain"
                      style={STICKER_FILTER}
                    />
                  ) : null}
                  <span className="truncate">
                    {food.name} · {fmtInt(food.kcal)} kcal
                  </span>
                </Chip>
              ))}
            </div>
          </div>
        )}

        {ceritaPhase === "input" && !showManual && (
          <button
            type="button"
            onClick={() => setShowManual(true)}
            className="min-h-11 px-1 text-sm font-semibold text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
          >
            Sudah tahu kalorinya? Isi sendiri
          </button>
        )}

        {ceritaPhase === "input" && showManual && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
            className="space-y-4"
          >
            <div className="flex items-end gap-3">
              <div className="min-w-0 flex-1">
                <FieldLabel htmlFor={`${meal}-name`}>Nama makanan</FieldLabel>
                <Input
                  id={`${meal}-name`}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Nasi goreng"
                  autoComplete="off"
                />
              </div>
              <div className="w-28">
                <FieldLabel htmlFor={`${meal}-kcal`}>kcal</FieldLabel>
                <Input
                  id={`${meal}-kcal`}
                  type="number"
                  min="0"
                  inputMode="numeric"
                  value={kcal}
                  onChange={(event) => setKcal(event.target.value)}
                  placeholder="500"
                />
              </div>
            </div>

            <KindPicker value={kind} onChange={setKindOverride} />
            <SnackAdviceCard
              state={advice}
              onHalf={halve}
              halfApplied={fullPortion !== null}
              onUndoHalf={undoHalf}
            />

            {showMacros ? (
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <FieldLabel htmlFor={`${meal}-protein`}>Protein (g)</FieldLabel>
                  <Input
                    id={`${meal}-protein`}
                    type="number"
                    min="0"
                    inputMode="decimal"
                    value={protein}
                    onChange={(event) => setProtein(event.target.value)}
                  />
                </div>
                <div>
                  <FieldLabel htmlFor={`${meal}-carbs`}>Karbo (g)</FieldLabel>
                  <Input
                    id={`${meal}-carbs`}
                    type="number"
                    min="0"
                    inputMode="decimal"
                    value={carbs}
                    onChange={(event) => setCarbs(event.target.value)}
                  />
                </div>
                <div>
                  <FieldLabel htmlFor={`${meal}-fat`}>Lemak (g)</FieldLabel>
                  <Input
                    id={`${meal}-fat`}
                    type="number"
                    min="0"
                    inputMode="decimal"
                    value={fat}
                    onChange={(event) => setFat(event.target.value)}
                  />
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowMacros(true)}
                className="px-1 text-sm font-semibold text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
              >
                + Protein / karbo / lemak (opsional)
              </button>
            )}

            <div className="w-44">
              <FieldLabel htmlFor={`${meal}-price`}>Harga sepiring (Rp, opsional)</FieldLabel>
              <IdrInput
                id={`${meal}-price`}
                value={price}
                onChange={setPrice}
                placeholder="mis. 12.000"
              />
            </div>

            <div>
              <FieldLabel htmlFor={`${meal}-place`}>Tempat (opsional)</FieldLabel>
              <Input
                id={`${meal}-place`}
                value={place}
                onChange={(event) => setPlace(event.target.value)}
                placeholder="RM Sederhana"
                autoComplete="off"
              />
            </div>
            <SaveLocationToggle
              enabled={placeLocation.enabled}
              status={placeLocation.status}
              onChange={placeLocation.setEnabled}
            />

            {error && <p className="px-1 text-sm text-destructive">{error}</p>}

            <Button type="submit" className="w-full" disabled={addPending}>
              {addPending ? "Menyimpan..." : `Tambah ke ${label}`}
            </Button>
          </form>
        )}

        {ceritaPhase === "input" && (
          <Link
            to="/makan/ai"
            search={isToday ? {} : { date }}
            className="flex items-center gap-3 rounded-2xl bg-muted p-4 transition-colors hover:bg-border focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
          >
            <span
              className="flex size-10 shrink-0 items-center justify-center rounded-full bg-card"
              aria-hidden
            >
              <Camera className="size-5 text-makan-ink" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-bold">Pindai pakai foto</span>
              <span className="block text-xs text-muted-foreground">
                AI hitung kalorinya, kamu cek dulu.
              </span>
            </span>
            <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
          </Link>
        )}

        {ceritaPhase === "input" && (
          <Link
            to="/makan/barcode"
            search={{ ...(isToday ? {} : { date }), meal }}
            className="flex items-center gap-3 rounded-2xl bg-muted p-4 transition-colors hover:bg-border focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
          >
            <span
              className="flex size-10 shrink-0 items-center justify-center rounded-full bg-card"
              aria-hidden
            >
              <ScanBarcode className="size-5 text-makan-ink" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-bold">Pindai barcode kemasan</span>
              <span className="block text-xs text-muted-foreground">
                Ambil angka gizi dari Open Food Facts.
              </span>
            </span>
            <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
          </Link>
        )}
      </div>
    </Sheet>
  );
}

function MakanSkeleton() {
  return (
    <Page className="md:max-w-3xl" aria-busy="true" aria-label="Memuat catatan makan">
      <div className="flex items-center justify-between px-1 pt-2 pb-5">
        <Skeleton className="h-8 w-28 rounded-full" />
        <Skeleton className="h-12 w-44 rounded-full" />
      </div>
      <div className="rounded-3xl bg-card p-6">
        <div className="flex items-center gap-6">
          <Skeleton className="size-[124px] shrink-0 rounded-full" />
          <div className="flex-1 space-y-4">
            {[0, 1, 2, 3].map((row) => (
              <div key={row} className="grid grid-cols-[3.5rem_1fr_auto] items-center gap-2">
                <Skeleton className="h-3 w-12 rounded-full" />
                <Skeleton className="h-1.5 rounded-full" />
                <Skeleton className="h-3 w-14 rounded-full" />
              </div>
            ))}
          </div>
        </div>
      </div>
      {[0, 1].map((section) => (
        <div key={section} className="mt-7">
          <Skeleton className="mb-3 h-6 w-36 rounded-full" />
          <div className="rounded-3xl bg-card py-1">
            {[0, 1, 2].map((row) => (
              <div key={row} className="flex items-center gap-3 px-5 py-3">
                <Skeleton className="size-10 shrink-0 rounded-full" />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-40 rounded-full" />
                  <Skeleton className="h-3 w-24 rounded-full" />
                </div>
                <Skeleton className="h-4 w-16 rounded-full" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </Page>
  );
}
