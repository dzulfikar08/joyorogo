import { Button } from "@joyorogo/ui/components/button";
import { Input } from "@joyorogo/ui/components/input";
import { Sheet } from "@joyorogo/ui/components/sheet";
import { Skeleton } from "@joyorogo/ui/components/skeleton";
import { cn } from "@joyorogo/ui/lib/utils";
import { ShareToFeedSheet } from "@/components/feed/share-to-feed";
import { Chip } from "@/components/chip";
import { DaySwitcher } from "@/components/day-switcher";
import { Ring } from "@/components/kit/ring";
import { ErrorNote } from "@/components/kit/error-note";
import { ScreenError } from "@/components/screen-state";
import {
  Card,
  FieldLabel,
  ListGroup,
  ListRow,
  Page,
  PageHeader,
  SectionTitle,
} from "@/components/kit/surface";
import { StravaCard } from "@/components/strava-card";
import { fmtDateIndo, fmtInt, parseNum } from "@/lib/format";
import {
  OptimisticCache,
  useDelayedDelete,
  useOptimisticMutation,
} from "@/lib/optimistic";
import type { ExerciseItem, ExerciseType } from "@/lib/api-types";
import { removeById, upsertById } from "@joyorogo/api/lib/optimistic";
import type { AppRouterClient } from "@joyorogo/api/routers/index";
import { client, orpc } from "@/utils/orpc";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Bike,
  ChevronRight,
  Droplets,
  Dumbbell,
  Flame,
  Flower2,
  Footprints,
  Goal,
  PersonStanding,
  Rabbit,
  Share2,
  Target,
  Trash2,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useRef, useState } from "react";

import { jakartaToday, relativeDayLabel } from "@joyorogo/api/lib/engine";
import { estimateKcal } from "@joyorogo/api/lib/met";

const listOptions = (date: string) => orpc.exercise.listByDate.queryOptions({ input: { date } });
const recentOptions = orpc.exercise.recent.queryOptions({ input: { days: 7 } });
const typesOptions = orpc.exercise.types.queryOptions();
const summaryOptions = (date: string) => orpc.day.summary.queryOptions({ input: { date } });
const profileOptions = orpc.profile.myProfile.queryOptions();

export const Route = createFileRoute("/_auth/olahraga")({
  validateSearch: (search: Record<string, unknown>): { date?: string } => {
    const raw = typeof search.date === "string" ? search.date : undefined;
    return { date: raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : undefined };
  },
  loaderDeps: ({ search }) => ({ date: search.date }),
  loader: ({ context, deps }) => {
    const date = deps.date ?? jakartaToday();
    void context.queryClient.ensureQueryData(summaryOptions(date));
    return context.queryClient.ensureQueryData(listOptions(date));
  },
  pendingComponent: OlahragaSkeleton,
  component: OlahragaPage,
});

const SOURCE_LABELS: Record<string, string> = {
  manual: "Manual",
  strava: "Strava",
  health_connect: "Health Connect",
  apple_health: "Apple Health",
};

// Icon per activity-type key; catalog entries without a match fall back to Flame.
const TYPE_ICONS: Record<string, LucideIcon> = {
  jalan: Footprints,
  jalan_cepat: PersonStanding,
  lari: Rabbit,
  sepeda: Bike,
  sepeda_cepat: Zap,
  berenang: Droplets,
  yoga: Flower2,
  angkat_beban: Dumbbell,
  futsal: Goal,
  badminton: Target,
};

function OlahragaPage() {
  const { date: paramDate } = Route.useSearch();
  const date = paramDate ?? jakartaToday();
  const list = useQuery(listOptions(date));
  if (list.isPending) return <OlahragaSkeleton />;
  if (list.error) {
    return <ScreenError message={list.error.message} onRetry={() => list.refetch()} />;
  }
  return <OlahragaScreen list={list.data} date={date} />;
}

function OlahragaScreen({
  list,
  date,
}: {
  list: { items: ExerciseItem[]; totalKcal: number };
  date: string;
}) {
  const queryClient = useQueryClient();
  const navigate = Route.useNavigate();
  const isToday = date === jakartaToday();
  const showDate = (target: string) =>
    navigate({ search: { date: target === jakartaToday() ? undefined : target } });
  const types = useQuery(typesOptions);
  const recent = useQuery(recentOptions);
  const summary = useQuery(summaryOptions(date));
  const profile = useQuery(profileOptions);

  const [sheetOpen, setSheetOpen] = useState(false);
  // Bagikan ke feed: aktivitas yang sedang dibagikan.
  const [shareItem, setShareItem] = useState<ExerciseItem | null>(null);
  const [typeKey, setTypeKey] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [durationMin, setDurationMin] = useState("");
  const [kcal, setKcal] = useState("");
  const [error, setError] = useState<string | null>(null);

  // When a profile exists, the server always returns a number here (it falls
  // back to the start weight itself).
  const weightKg = profile.data?.profile == null ? null : profile.data.latestWeightKg;
  const burnTarget = summary.data?.targets?.burnKcal ?? null;

  // Server row replaces the provisional (temp id) once the add settles.
  const addTempId = useRef<string | null>(null);
  const swapTemp = (tempId: string, row: ExerciseItem) => {
    queryClient.setQueryData<{ items: ExerciseItem[]; totalKcal: number }>(
      listOptions(row.date).queryKey,
      (old) => (old ? { ...old, items: upsertById(removeById(old.items, tempId), row) } : old),
    );
  };

  /** exercise.listByDate caches hold { items, totalKcal }: land a row and lift the total. */
  const insertExercise = (cache: OptimisticCache, rowDate: string, row: ExerciseItem) => {
    cache.value<{ items: ExerciseItem[]; totalKcal: number }>(
      listOptions(rowDate).queryKey,
      (old) => (old ? { ...old, items: upsertById(old.items, row), totalKcal: old.totalKcal + row.kcal } : old),
    );
  };

  /** exercise.listByDate caches hold { items, totalKcal }: strip one row and pull the total down. */
  const stripExercise = (cache: OptimisticCache, row: ExerciseItem) => {
    cache.value<{ items: ExerciseItem[]; totalKcal: number }>(listOptions(row.date).queryKey, (old) => {
      if (!old || !old.items.some((item) => item.id === row.id)) return old;
      return {
        ...old,
        items: removeById(old.items, row.id),
        totalKcal: Math.max(0, old.totalKcal - row.kcal),
      };
    });
  };

  const add = useOptimisticMutation<
    Parameters<AppRouterClient["exercise"]["add"]>[0],
    ExerciseItem | undefined
  >({
    mutationFn: (input) => client.exercise.add(input),
    patch: (input, cache) => {
      const rowDate = input.date ?? date;
      const tempId = crypto.randomUUID();
      addTempId.current = tempId;
      // Provisional placeholder until the server row (real id) replaces it on settle.
      const provisional = {
        id: tempId,
        userId: "",
        date: rowDate,
        type: input.type ?? null,
        name: input.name,
        kcal: input.kcal,
        durationMin: input.durationMin ?? null,
        source: "manual",
        externalId: null,
        createdAt: new Date(),
      } as ExerciseItem;
      insertExercise(cache, rowDate, provisional);
      cache.summary({ date: rowDate, burnKcal: input.kcal });
    },
    invalidate: () => [orpc.exercise.key(), orpc.day.key()],
    success: (_input, serverRow) => {
      if (!serverRow) return undefined;
      const row = serverRow as ExerciseItem;
      const tempId = addTempId.current;
      addTempId.current = null;
      if (tempId) swapTemp(tempId, row);
      setSheetOpen(false);
      return {
        message: `${row.name} dicatat (+${fmtInt(row.kcal)} kcal)`,
        undo: () => {
          const cache = new OptimisticCache(queryClient);
          stripExercise(cache, row);
          cache.summary({ date: row.date, burnKcal: -row.kcal });
          void client.exercise.remove({ id: row.id });
        },
      };
    },
  });
  // Delayed-commit delete: hidden instantly, DELETE after the undo window.
  const removeExercise = useDelayedDelete<ExerciseItem>({
    remove: (row) => client.exercise.remove({ id: row.id }),
    patch: (row, cache) => {
      stripExercise(cache, row);
      cache.summary({ date: row.date, burnKcal: -row.kcal });
    },
    label: (row) => row.name,
    fallback: "Latihan",
    invalidate: () => [orpc.exercise.key(), orpc.day.key()],
  });

  const setType = (type: ExerciseType) => {
    setTypeKey(type.key);
    setName(type.label);
    const duration = parseNum(durationMin);
    if (duration !== null && duration > 0 && weightKg !== null) {
      setKcal(String(estimateKcal(type.met, weightKg, Math.round(duration))));
    }
  };

  const applyDuration = (value: string) => {
    setDurationMin(value);
    const duration = parseNum(value);
    const met = types.data?.find((type) => type.key === typeKey)?.met;
    if (met !== undefined && duration !== null && duration > 0 && weightKg !== null) {
      setKcal(String(estimateKcal(met, weightKg, Math.round(duration))));
    }
  };

  const openWithType = (type: ExerciseType) => {
    setTypeKey(type.key);
    setName(type.label);
    setDurationMin("30");
    setKcal(weightKg !== null ? String(estimateKcal(type.met, weightKg, 30)) : "");
    setError(null);
    setSheetOpen(true);
  };

  const openManual = () => {
    setTypeKey(null);
    setName("");
    setDurationMin("");
    setKcal("");
    setError(null);
    setSheetOpen(true);
  };

  const submit = async () => {
    const nameClean = name.trim();
    const kcalNum = parseNum(kcal);
    const duration = parseNum(durationMin);
    if (nameClean.length === 0) {
      setError("Isi nama aktivitas dulu.");
      return;
    }
    if (kcalNum === null || kcalNum < 0) {
      setError("Isi kalori terbakar (angka).");
      return;
    }
    if (duration !== null && (duration < 1 || duration > 1440)) {
      setError("Durasi harus 1-1440 menit.");
      return;
    }
    setError(null);
    try {
      await add.mutateAsync({
        date,
        type: typeKey ?? undefined,
        name: nameClean,
        kcal: kcalNum,
        durationMin: duration !== null ? Math.round(duration) : undefined,
      });
      setTypeKey(null);
      setName("");
      setDurationMin("");
      setKcal("");
    } catch {
      // the mutation already toasts the server message
    }
  };

  const { items, totalKcal } = list;
  // Health Connect imports land on the workout's own WIB day, so surface the
  // past week or they look lost next to an empty "Hari ini".
  const wibToday = jakartaToday();
  const pastItems = (recent.data?.items ?? []).filter((item) => item.date !== wibToday);
  const historyByDate = new Map<string, ExerciseItem[]>();
  for (const item of pastItems) {
    const group = historyByDate.get(item.date);
    if (group) group.push(item);
    else historyByDate.set(item.date, [item]);
  }
  const over = burnTarget !== null && totalKcal > burnTarget;
  const activeType = types.data?.find((type) => type.key === typeKey);

  return (
    <Page className="max-w-xl lg:max-w-5xl">
      <PageHeader
        title="Olahraga"
        subtitle={fmtDateIndo(date)}
        action={
          <Button variant="secondary" onClick={openManual}>
            Tulis manual
          </Button>
        }
      />

      {/* Day switcher */}
      <div className="mb-3 flex justify-center lg:justify-start">
        <DaySwitcher date={date} onChange={showDate} />
      </div>

      <div className="grid items-start gap-3 lg:grid-cols-2 lg:gap-5">
        <Card className="p-6 lg:col-start-1 lg:row-start-1">
          <div className="flex flex-col items-center text-center">
            <Ring
              metric="bakar"
              value={totalKcal}
              max={burnTarget ?? Math.max(totalKcal, 300)}
              size={200}
              stroke={16}
              label={`Terbakar ${fmtInt(totalKcal)}${burnTarget !== null ? ` dari target ${fmtInt(burnTarget)} kcal` : ""}`}
            >
              <div>
                <p className="text-sm font-semibold text-muted-foreground">Terbakar</p>
                <p
                  className={cn(
                    "text-[3.25rem] leading-none font-extrabold tracking-tighter tabular-nums",
                    over && "text-bakar-ink",
                  )}
                >
                  {fmtInt(totalKcal)}
                </p>
                <p className="mt-1 text-sm font-semibold text-muted-foreground">kcal</p>
              </div>
            </Ring>
            <p className="mt-4 text-sm text-muted-foreground">
              {burnTarget === null
                ? "Selesaikan onboarding untuk melihat target harian."
                : over
                  ? `Melebihi target ${fmtInt(burnTarget)} kcal, mantap.`
                  : `${items.length} aktivitas · target ${fmtInt(burnTarget)} kcal`}
            </p>
          </div>
        </Card>

        <section aria-label="Aktivitas hari ini" className="lg:col-start-2 lg:row-start-1">
          <SectionTitle
            action={
              <span className="text-sm font-bold text-muted-foreground tabular-nums">
                {fmtInt(totalKcal)} kcal
              </span>
            }
          >
            {isToday ? "Hari ini" : relativeDayLabel(date, jakartaToday())}
          </SectionTitle>
          {items.length === 0 ? (
            <Card className="text-center">
              <p className="text-sm font-bold">
                {isToday ? "Belum ada aktivitas tercatat" : "Tidak ada aktivitas tercatat"}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Pilih jenis olahraga di bawah, atau hubungkan Strava biar masuk otomatis.
              </p>
            </Card>
          ) : (
            <ListGroup>
              {items.map((item) => {
                const Icon = TYPE_ICONS[item.type ?? ""] ?? Flame;
                return (
                  <ListRow
                    key={item.id}
                    icon={
                      <span className="flex size-9 items-center justify-center rounded-full bg-bakar-soft text-bakar">
                        <Icon className="size-4" aria-hidden />
                      </span>
                    }
                    title={
                      <>
                        {item.name}
                        {item.source !== "manual" && (
                          <span className="ml-2 rounded-full bg-muted px-2 py-0.5 align-middle text-[10px] font-bold text-muted-foreground">
                            {SOURCE_LABELS[item.source] ?? item.source}
                          </span>
                        )}
                      </>
                    }
                    subtitle={`${item.durationMin != null ? `${fmtInt(item.durationMin)} menit · ` : ""}${fmtInt(item.kcal)} kcal`}
                    trailing={
                      <>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Bagikan ${item.name} ke feed`}
                          className="text-muted-foreground hover:text-foreground"
                          onClick={() => setShareItem(item)}
                        >
                          <Share2 aria-hidden />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Hapus ${item.name}`}
                          className="text-muted-foreground hover:text-destructive"
                          onClick={() => removeExercise(item)}
                        >
                          <Trash2 aria-hidden />
                        </Button>
                      </>
                    }
                  />
                );
              })}
            </ListGroup>
          )}
        </section>

        {/* Recent history: Health Connect imports land on the workout's own
            WIB day, so show the past week or they look lost. */}
        {historyByDate.size > 0 && (
          <section aria-label="Riwayat 7 hari terakhir" className="lg:col-start-2 lg:row-start-2">
            <SectionTitle>7 hari terakhir</SectionTitle>
            <ListGroup>
              {[...historyByDate.entries()].map(([date, dayItems]) => (
                <div key={date}>
                  <p className="px-1 pt-2 pb-1 text-xs font-bold text-muted-foreground">
                    {relativeDayLabel(date, wibToday)}
                  </p>
                  {dayItems.map((item) => {
                    const Icon = TYPE_ICONS[item.type ?? ""] ?? Flame;
                    return (
                      <ListRow
                        key={item.id}
                        icon={
                          <span className="flex size-9 items-center justify-center rounded-full bg-bakar-soft text-bakar">
                            <Icon className="size-4" aria-hidden />
                          </span>
                        }
                        title={
                          <>
                            {item.name}
                            {item.source !== "manual" && (
                              <span className="ml-2 rounded-full bg-muted px-2 py-0.5 align-middle text-[10px] font-bold text-muted-foreground">
                                {SOURCE_LABELS[item.source] ?? item.source}
                              </span>
                            )}
                          </>
                        }
                        subtitle={`${item.durationMin != null ? `${fmtInt(item.durationMin)} menit · ` : ""}${fmtInt(item.kcal)} kcal`}
                        trailing={<span className="text-sm font-bold tabular-nums">{fmtInt(item.kcal)}</span>}
                      />
                    );
                  })}
                </div>
              ))}
            </ListGroup>
          </section>
        )}

        <section
          aria-label="Pilih jenis aktivitas"
          className={cn("lg:col-start-2", historyByDate.size > 0 ? "lg:row-start-3" : "lg:row-start-2")}
        >
          <SectionTitle>Pilih aktivitas</SectionTitle>
          {types.isPending ? (
            <div className="grid grid-cols-3 gap-2.5">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-24 rounded-2xl" />
              ))}
            </div>
          ) : types.error ? (
            <ErrorNote
              message={`Gagal memuat jenis aktivitas: ${types.error.message}`}
              onRetry={() => types.refetch()}
            />
          ) : (
            <div className="grid grid-cols-3 gap-2.5">
              {types.data.map((type) => {
                const Icon = TYPE_ICONS[type.key] ?? Flame;
                const per30 = weightKg !== null ? estimateKcal(type.met, weightKg, 30) : null;
                return (
                  <button
                    key={type.key}
                    type="button"
                    onClick={() => openWithType(type)}
                    className="pressable min-h-24 rounded-2xl bg-bakar-soft p-3 text-left focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
                  >
                    <span className="flex size-8 items-center justify-center rounded-full bg-card text-bakar">
                      <Icon className="size-4" aria-hidden />
                    </span>
                    <span className="mt-2 block text-[0.8125rem] leading-tight font-bold">
                      {type.label}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] leading-tight font-semibold text-bakar-ink tabular-nums">
                      {per30 !== null ? `±${fmtInt(per30)} kcal` : "kalori manual"}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          <p className="mt-2 px-1 text-xs text-muted-foreground">
            {weightKg !== null
              ? "Estimasi kalori per 30 menit dengan berat badan terakhirmu."
              : "Catat berat badanmu di halaman Berat agar estimasi kalori tampil."}
          </p>
        </section>

        <div className="lg:col-start-1 lg:row-start-2">
          <StravaCard />
        </div>
      </div>

      <section aria-label="Latihan beban" className="mt-3 lg:mt-5">
        <Link
          to="/latihan"
          className="pressable flex items-center gap-3 rounded-3xl bg-card p-5 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-bakar-soft text-bakar">
            <Dumbbell className="size-5" aria-hidden />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-extrabold">Latihan beban</span>
            <span className="block text-sm text-muted-foreground">
              Catat gerakan, set, reps, dan beban. Jaga otot saat defisit.
            </span>
          </span>
          <ChevronRight className="ml-auto size-5 shrink-0 text-muted-foreground" aria-hidden />
        </Link>
      </section>

      <Sheet
        open={sheetOpen}
        onOpenChange={(open) => {
          setSheetOpen(open);
          if (!open) setError(null);
        }}
        title={activeType ? `Catat ${activeType.label}` : "Catat aktivitas"}
        description="Kalori terisi otomatis dari durasi dan berat terakhirmu."
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
          className="space-y-4"
        >
          <div>
            <p className="mb-1.5 px-1 text-[0.8125rem] font-semibold text-muted-foreground">
              Jenis aktivitas
            </p>
            {types.isPending ? (
              <p className="px-1 text-sm text-muted-foreground">Memuat jenis aktivitas...</p>
            ) : types.error ? (
              <p className="px-1 text-sm text-destructive">
                Gagal memuat jenis: {types.error.message}
              </p>
            ) : (
              <div role="group" aria-label="Jenis aktivitas" className="flex flex-wrap gap-2">
                {types.data.map((type) => (
                  <Chip
                    key={type.key}
                    active={typeKey === type.key}
                    onClick={() => setType(type)}
                    className={cn(
                      typeKey === type.key && "border-transparent bg-bakar-soft text-bakar-ink",
                    )}
                  >
                    {type.label}
                  </Chip>
                ))}
              </div>
            )}
          </div>

          <div>
            <FieldLabel htmlFor="exercise-name">Nama aktivitas</FieldLabel>
            <Input
              id="exercise-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Jalan sore"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <FieldLabel htmlFor="exercise-duration">Durasi (menit)</FieldLabel>
              <Input
                id="exercise-duration"
                type="number"
                min="1"
                max="1440"
                inputMode="numeric"
                value={durationMin}
                onChange={(event) => applyDuration(event.target.value)}
                placeholder="30"
              />
            </div>
            <div>
              <FieldLabel htmlFor="exercise-kcal">Kalori (kcal)</FieldLabel>
              <Input
                id="exercise-kcal"
                type="number"
                min="0"
                inputMode="numeric"
                value={kcal}
                onChange={(event) => setKcal(event.target.value)}
                placeholder="120"
              />
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button type="submit" className="w-full" disabled={add.isPending}>
            {add.isPending ? "Menyimpan..." : "Simpan"}
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            {weightKg !== null
              ? "Estimasi memakai berat badan terakhirmu."
              : "Catat berat badanmu di halaman Berat agar estimasi kalori akurat."}
          </p>
        </form>
      </Sheet>

      {shareItem && (
        <ShareToFeedSheet
          open
          onOpenChange={(open) => {
            if (!open) setShareItem(null);
          }}
          title="Bagikan aktivitas ini"
          preview={`${shareItem.name} · ${fmtInt(shareItem.kcal)} kcal`}
          share={(input) =>
            client.social.createPost({
              kind: "latihan",
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

function OlahragaSkeleton() {
  return (
    <Page className="max-w-xl lg:max-w-5xl" aria-busy="true" aria-label="Memuat aktivitas hari ini">
      <div className="flex items-center justify-between gap-3 px-1 pt-2 pb-5">
        <Skeleton className="h-9 w-36 rounded-full" />
        <Skeleton className="h-12 w-32 rounded-full" />
      </div>
      <div className="flex flex-col items-center rounded-3xl bg-card p-6">
        <Skeleton className="size-[200px] rounded-full" />
        <Skeleton className="mt-4 h-5 w-44 rounded-full" />
      </div>
      <Skeleton className="mt-7 h-44 rounded-3xl" />
      <div className="mt-7 grid grid-cols-3 gap-2.5">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-24 rounded-2xl" />
        ))}
      </div>
    </Page>
  );
}
