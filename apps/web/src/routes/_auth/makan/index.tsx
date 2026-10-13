import {
  MEAL_LABELS,
  effectiveRamadan,
  jakartaToday,
  slotsFor,
  suggestMealNow,
} from "@joyorogo/api/lib/engine";
import type { Meal } from "@joyorogo/api/lib/engine";
import { Button } from "@joyorogo/ui/components/button";
import { Input } from "@joyorogo/ui/components/input";
import { Sheet } from "@joyorogo/ui/components/sheet";
import { Skeleton } from "@joyorogo/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Camera, ChevronLeft, ChevronRight, Mic, Plus, Share2, Trash2, Utensils } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Cerita } from "@/components/cerita";
import type { CeritaPhase } from "@/components/cerita";
import { Chip } from "@/components/chip";
import { ShareToFeedSheet } from "@/components/feed/share-to-feed";
import { FieldLabel, ListRow, Page, PageHeader, SectionTitle } from "@/components/kit/surface";
import { MakanSummaryCard } from "@/components/macro-card";
import { BelanjaCard } from "@/components/plate/belanja";
import { PlateDiary } from "@/components/plate/plate-group";
import { ScreenError } from "@/components/screen-state";
import { Sticker } from "@/components/sticker";
import type { FoodAddInput, FoodItem, FoodRecentItem } from "@/lib/api-types";
import { fmtDateIndo, fmtInt, parseNum } from "@/lib/format";
import { client, orpc } from "@/utils/orpc";

// One options object per query, reused by the loader and the component so the
// cache keys match and navigation preloads land in the exact bucket read here.
const listOptions = (date: string) => orpc.food.listByDate.queryOptions({ input: { date } });
const summaryOptions = (date: string) => orpc.day.summary.queryOptions({ input: { date } });

export const Route = createFileRoute("/_auth/makan/")({
  validateSearch: (search: Record<string, unknown>): { date?: string; cerita?: boolean } => {
    const raw = typeof search.date === "string" ? search.date : undefined;
    const date = raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : undefined;
    // ?cerita=1 opens the story sheet (deep link from Beranda and the camera page).
    const cerita =
      search.cerita === true || search.cerita === 1 || search.cerita === "1" || undefined;
    return { date, cerita };
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

function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Short switcher label: "Hari ini", "Kemarin", otherwise "6 Okt". */
function dayLabel(date: string): string {
  if (date === shiftDate(jakartaToday(), -1)) return "Kemarin";
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

function MakanPage() {
  const queryClient = useQueryClient();
  const { date: paramDate, cerita: ceritaOpen } = Route.useSearch();
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
  const setCeritaOpen = (open: boolean) =>
    navigate({ search: (prev) => ({ ...prev, cerita: open || undefined }), replace: true });
  const showDate = (target: string) =>
    navigate({ search: { date: target === jakartaToday() ? undefined : target } });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: orpc.food.key() });
    queryClient.invalidateQueries({ queryKey: orpc.day.key() });
  };

  const add = useMutation(
    orpc.food.add.mutationOptions({
      onSuccess: (row) => {
        if (!row) return;
        toast.success(`${row.name} dicatat.`);
        invalidate();
      },
      onError: (error) => toast.error(error.message),
    }),
  );
  const remove = useMutation(
    orpc.food.remove.mutationOptions({
      onSuccess: (_result, { id }) => {
        const item = list.data?.items.find((row) => row.id === id);
        toast.success(`${item?.name ?? "Catatan"} dihapus.`, {
          duration: 6000,
          action:
            item !== undefined
              ? {
                  label: "Urungkan",
                  onClick: () =>
                    void add.mutateAsync({
                      date: item.date,
                      // listByDate returns raw drizzle columns (string); the
                      // DB constraints guarantee these are the engine enums.
                      meal: item.meal as Meal,
                      name: item.name,
                      kcal: item.kcal,
                      protein: item.protein ?? undefined,
                      carbs: item.carbs ?? undefined,
                      fat: item.fat ?? undefined,
                      fiber: item.fiber ?? undefined,
                      source: item.source as "manual" | "ai",
                      // The sticker asset was deleted server-side; re-adding
                      // its scanId would render a broken image.
                      itemsJson: item.itemsJson ?? undefined,
                    }),
                }
              : undefined,
        });
        invalidate();
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  if (list.isPending) return <MakanSkeleton />;
  if (list.error) {
    return <ScreenError message={list.error.message} onRetry={() => list.refetch()} />;
  }

  const { items, totals } = list.data;

  return (
    <Page className="md:max-w-3xl">
      <PageHeader
        title="Makan"
        action={
          <div
            role="group"
            aria-label="Pilih hari"
            className="flex items-center gap-0.5 rounded-full bg-muted p-1"
          >
            <button
              type="button"
              aria-label="Hari sebelumnya"
              onClick={() => navigate({ search: { date: shiftDate(date, -1) } })}
              className="flex size-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-card hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
            >
              <ChevronLeft className="size-5" aria-hidden />
            </button>
            <span
              className="min-w-[4.25rem] text-center text-sm font-bold text-foreground tabular-nums"
              title={fmtDateIndo(date)}
            >
              {isToday ? "Hari ini" : dayLabel(date)}
            </span>
            <button
              type="button"
              aria-label="Hari berikutnya"
              disabled={isToday}
              onClick={() => navigate({ search: { date: shiftDate(date, 1) } })}
              className="flex size-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-card hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-30"
            >
              <ChevronRight className="size-5" aria-hidden />
            </button>
          </div>
        }
      />

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

      <BelanjaCard />

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

      {items.length === 0 && (
        <div className="mt-3 rounded-3xl bg-card p-6 text-center">
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
            <Link to="/makan/ai">
              <Button variant="secondary">
                <Camera className="size-4" aria-hidden />
                Pindai foto
              </Button>
            </Link>
          </div>
        </div>
      )}

      {MEALS.map(([meal, label]) => {
        const sectionItems = items.filter((item) => item.meal === meal);
        const subtotal = sectionItems.reduce((sum, item) => sum + item.kcal, 0);
        return (
          <section
            key={meal}
            className="mt-7"
            aria-label={`${label}, total ${fmtInt(subtotal)} kcal`}
          >
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
                    onDelete={() => remove.mutate({ id: item.id })}
                    onShare={() => setShareItem(item)}
                  />
                )}
              />
            ) : (
              <div className="rounded-3xl bg-card px-5 py-4 text-sm text-muted-foreground">
                Belum ada catatan. Tekan Tambah di atas, atau pindai fotonya.
              </div>
            )}
          </section>
        );
      })}

      {sheetMeal !== null && (
        <AddFoodSheet
          key={sheetMeal}
          meal={sheetMeal}
          date={date}
          isToday={isToday}
          slots={slots}
          recent={recent.data?.items ?? []}
          addPending={add.isPending}
          onAdd={(input) => add.mutateAsync(input)}
          onShowDate={showDate}
          onClose={() => setSheetMeal(null)}
        />
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
            onSaved={() => setCeritaOpen(false)}
            onShowDate={showDate}
          />
        </Sheet>
      )}

      {shareItem && (
        <ShareToFeedSheet
          open
          onOpenChange={(open) => {
            if (!open) setShareItem(null);
          }}
          title="Bagikan makanan ini"
          preview={`${shareItem.name} · ${fmtInt(shareItem.kcal)} kcal`}
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

function FoodRow({
  item,
  onDelete,
  onShare,
}: {
  item: FoodItem;
  onDelete: () => void;
  onShare: () => void;
}) {
  const hasMacros = item.protein != null || item.carbs != null || item.fat != null;
  const subtitle = hasMacros
    ? `P ${fmtInt(item.protein ?? 0)} · K ${fmtInt(item.carbs ?? 0)} · L ${fmtInt(item.fat ?? 0)} g`
    : item.source === "ai"
      ? "Dari pindai AI"
      : undefined;
  const utensil = (
    <span
      className="flex size-9 items-center justify-center rounded-full bg-makan-soft"
      aria-hidden
    >
      <Utensils className="size-4 text-makan-ink" />
    </span>
  );
  return (
    <ListRow
      icon={
        item.scanId ? (
          <Sticker
            scanId={item.scanId}
            photoId={item.photoId}
            name={item.name}
            kcal={item.kcal}
            protein={item.protein}
            carbs={item.carbs}
            fat={item.fat}
            className="block size-10"
            fallback={utensil}
          />
        ) : (
          utensil
        )
      }
      title={item.name}
      subtitle={subtitle}
      value={
        <span>
          {fmtInt(item.kcal)}
          <span className="ml-1 text-xs font-semibold text-muted-foreground">kcal</span>
        </span>
      }
      trailing={
        <>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Bagikan ${item.name} ke feed`}
            onClick={onShare}
            className="text-muted-foreground hover:text-foreground"
          >
            <Share2 />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Hapus ${item.name}`}
            onClick={onDelete}
            className="text-muted-foreground hover:text-destructive"
          >
            <Trash2 />
          </Button>
        </>
      }
    />
  );
}

function AddFoodSheet({
  meal,
  date,
  isToday,
  slots,
  recent,
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
  const [error, setError] = useState<string | null>(null);
  const label = MEAL_LABELS[meal];

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
    const priceNum = price.trim() === "" ? null : parseNum(price);
    if (price.trim() !== "" && (priceNum === null || priceNum < 0)) {
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
        ...(priceNum != null ? { plate: { priceIdr: Math.round(priceNum) } } : {}),
      });
      setName("");
      setKcal("");
      setProtein("");
      setCarbs("");
      setFat("");
      setPrice("");
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
                  onClick={() => void onAdd({ date, meal, name: food.name, kcal: food.kcal })}
                >
                  {food.name} · {fmtInt(food.kcal)} kcal
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
              <Input
                id={`${meal}-price`}
                type="number"
                min="0"
                inputMode="numeric"
                value={price}
                onChange={(event) => setPrice(event.target.value)}
                placeholder="12000"
              />
            </div>

            {error && <p className="px-1 text-sm text-destructive">{error}</p>}

            <Button type="submit" className="w-full" disabled={addPending}>
              {addPending ? "Menyimpan..." : `Tambah ke ${label}`}
            </Button>
          </form>
        )}

        {ceritaPhase === "input" && (
          <Link
            to="/makan/ai"
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
