import { kcalUnit } from "@joyorogo/i18n";
import { Button } from "@joyorogo/ui/components/button";
import { Input } from "@joyorogo/ui/components/input";
import { Sheet } from "@joyorogo/ui/components/sheet";
import { Skeleton } from "@joyorogo/ui/components/skeleton";
import { cn } from "@joyorogo/ui/lib/utils";
import { Mascot } from "@/components/mascot";
import { ShareToFeedSheet } from "@/components/feed/share-to-feed";
import { Chip } from "@/components/chip";
import { ExerciseEditSheet } from "@/components/exercise-edit-sheet";
import { DaySwitcher } from "@/components/day-switcher";
import { useGain } from "@/components/gain/use-gain";
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
import { InfoAccordion } from "@/components/onboarding/info-accordion";
import { StravaCard } from "@/components/strava-card";
import { fmtDateLong, fmtDateMedium, fmtInt, fmtKcalLabel, parseNum } from "@/lib/format";
import {
  OptimisticCache,
  useDelayedDelete,
  useOptimisticMutation,
} from "@/lib/optimistic";
import { JoyoFitCard } from "@/components/workout/joyofit-card";
import type { ExerciseItem, ExerciseType } from "@/lib/api-types";
import { removeById, upsertById } from "@joyorogo/api/lib/optimistic";
import type { AppRouterClient } from "@joyorogo/api/routers/index";
import { client, orpc } from "@/utils/orpc";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Bike,
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
import { useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { jakartaToday, relativeDayLabel } from "@joyorogo/api/lib/engine";
import { dayActiveKcal } from "@joyorogo/api/lib/exercise-credit";
import {
  EXERCISE_MAX_DURATION,
  EXERCISE_MIN_DURATION,
} from "@joyorogo/api/lib/exercise-edit";
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

// Brand names of import sources; "manual" is not shown as a pill.
const SOURCE_LABELS: Record<string, string> = {
  strava: "Strava",
  health_connect: "Health Connect",
  apple_health: "Apple Health",
  joyofit: "JoyoFit",
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
  const { t } = useTranslation(["olahraga", "common", "gain"]);
  const { gain } = useGain();
  const typeLabel = (key: ExerciseType["key"]) => t(`type.${key}`);
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
  // Ubah aktivitas: baris yang sedang diedit.
  const [editItem, setEditItem] = useState<ExerciseItem | null>(null);
  const [typeKey, setTypeKey] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [durationMin, setDurationMin] = useState("");
  const [kcal, setKcal] = useState("");
  const [error, setError] = useState<string | null>(null);

  // When a profile exists, the server always returns a number here (it falls
  // back to the start weight itself).
  const weightKg = profile.data?.profile == null ? null : profile.data.latestWeightKg;
  // Hamil / Menyusui has no burn target.
  const burnTarget = summary.data?.targets?.maternal ? null : (summary.data?.targets?.burnKcal ?? null);

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
        message: t("toast.logged", { name: row.name, kcal: fmtKcalLabel(row.kcal) }),
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
    fallback: t("toast.fallbackName"),
    invalidate: () => [orpc.exercise.key(), orpc.day.key()],
  });

  const setType = (type: ExerciseType) => {
    setTypeKey(type.key);
    setName(typeLabel(type.key));
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
    setName(typeLabel(type.key));
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
      setError(t("form.error.nameRequired"));
      return;
    }
    if (kcalNum === null || kcalNum < 0) {
      setError(t("form.error.kcalRequired"));
      return;
    }
    if (duration !== null && (duration < 1 || duration > 1440)) {
      setError(
        t("form.error.durationRange", { min: EXERCISE_MIN_DURATION, max: EXERCISE_MAX_DURATION }),
      );
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
  // The ring is the day's activity as Sisa reads it (all-day total + workouts it does not contain), not the sum of the
  // listed rows, which overlap the all-day total.
  const burnedKcal = dayActiveKcal(summary.data?.exerciseCredit, totalKcal);
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
  const over = burnTarget !== null && burnedKcal > burnTarget;
  const activeType = types.data?.find((type) => type.key === typeKey);

  return (
    <Page className="max-w-xl lg:max-w-5xl">
      <PageHeader
        title={t("screen.title")}
        subtitle={fmtDateLong(date)}
        className="pb-3"
        action={
          <Button variant="secondary" onClick={openManual}>
            {t("screen.manual")}
          </Button>
        }
      />

      <div className="mb-3 flex justify-center lg:justify-start">
        <DaySwitcher date={date} onChange={showDate} />
      </div>

      <div className="grid items-start gap-3 lg:grid-cols-2 lg:gap-5">
        <Card className="flex items-center gap-4 p-4 lg:col-start-1 lg:row-start-1">
          <Ring
            metric="bakar"
            value={burnedKcal}
            max={burnTarget ?? Math.max(burnedKcal, 300)}
            size={108}
            stroke={11}
            label={
              burnTarget !== null
                ? t("summary.ringTarget", {
                    burned: fmtKcalLabel(burnedKcal),
                    target: fmtKcalLabel(burnTarget),
                  })
                : t("summary.ring", { burned: fmtKcalLabel(burnedKcal) })
            }
          >
            <div className="text-center">
              <p
                className={cn(
                  "text-[1.75rem] leading-none font-extrabold tracking-tighter tabular-nums",
                  over && "text-bakar-ink",
                )}
              >
                {fmtInt(burnedKcal)}
              </p>
              <p className="mt-0.5 text-xs font-semibold text-muted-foreground">{kcalUnit()}</p>
            </div>
          </Ring>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-muted-foreground">{t("summary.burned")}</p>
            <p className={cn("mt-0.5 text-sm font-bold", over && "text-bakar-ink")}>
              {burnTarget === null
                ? t("summary.noTarget")
                : over
                  ? t("summary.over", { target: fmtKcalLabel(burnTarget) })
                  : t("summary.progress", {
                      count: items.length,
                      target: fmtKcalLabel(burnTarget),
                    })}
            </p>
          </div>
        </Card>

        <section aria-label={t("list.aria")} className="lg:col-start-2 lg:row-start-1">
          <SectionTitle
            className="mb-2"
            action={
              <span className="text-sm font-bold text-muted-foreground tabular-nums">
                {fmtKcalLabel(totalKcal)}
              </span>
            }
          >
            {relativeDayLabel(date, wibToday)}
          </SectionTitle>
          {items.length === 0 ? (
            <Card className="flex items-center gap-3 p-3">
              <Mascot pose="gas" size="sm" />
              <div className="min-w-0">
                <p className="text-sm font-bold">
                  {isToday
                    ? t("list.empty.today")
                    : t("list.empty.day", { date: fmtDateMedium(date) })}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">{t("list.empty.hintWeb")}</p>
              </div>
            </Card>
          ) : (
            <ListGroup>
              {items.map((item) => (
                <ActivityRow
                  key={item.id}
                  item={item}
                  onEdit={() => setEditItem(item)}
                  trailing={
                    <>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t("row.share", { name: item.name })}
                        className="text-muted-foreground hover:text-foreground"
                        onClick={(event) => {
                          event.stopPropagation();
                          setShareItem(item);
                        }}
                      >
                        <Share2 aria-hidden />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t("row.remove", { name: item.name })}
                        className="text-muted-foreground hover:text-destructive"
                        onClick={(event) => {
                          event.stopPropagation();
                          removeExercise(item);
                        }}
                      >
                        <Trash2 aria-hidden />
                      </Button>
                    </>
                  }
                />
              ))}
            </ListGroup>
          )}
        </section>

        <section
          aria-label={t("picker.aria")}
          className={cn("lg:col-start-2", historyByDate.size > 0 ? "lg:row-start-3" : "lg:row-start-2")}
        >
          <SectionTitle className="mb-2">{t("picker.title")}</SectionTitle>
          {types.isPending ? (
            <div className="grid grid-cols-3 gap-2">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-20 rounded-2xl" />
              ))}
            </div>
          ) : types.error ? (
            <ErrorNote
              message={t("picker.loadError", { error: types.error.message })}
              onRetry={() => types.refetch()}
            />
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {types.data.map((type) => {
                const Icon = TYPE_ICONS[type.key] ?? Flame;
                const per30 = weightKg !== null ? estimateKcal(type.met, weightKg, 30) : null;
                return (
                  <button
                    key={type.key}
                    type="button"
                    onClick={() => openWithType(type)}
                    className="pressable min-h-20 rounded-2xl bg-bakar-soft p-2.5 text-left focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
                  >
                    <span className="flex size-7 items-center justify-center rounded-full bg-card text-bakar">
                      <Icon className="size-4" aria-hidden />
                    </span>
                    <span className="mt-1.5 block text-[0.8125rem] leading-tight font-bold">
                      {typeLabel(type.key)}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] leading-tight font-semibold text-bakar-ink tabular-nums">
                      {per30 !== null
                        ? t("picker.estimate", { kcal: fmtKcalLabel(per30) })
                        : t("picker.manualKcal")}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          {weightKg === null && (
            <p className="mt-2 px-1 text-xs text-muted-foreground">{t("picker.noWeight")}</p>
          )}
        </section>

        {/* Health Connect imports land on the workout's own WIB day, so show the
            past week or they look lost next to an empty "today". */}
        {historyByDate.size > 0 && (
          <section aria-label={t("history.aria")} className="lg:col-start-2 lg:row-start-2">
            <SectionTitle className="mb-2">{t("history.title")}</SectionTitle>
            <ListGroup>
              {[...historyByDate.entries()].map(([day, dayItems]) => (
                <div key={day}>
                  <p className="px-1 pt-2 pb-1 text-xs font-bold text-muted-foreground">
                    {relativeDayLabel(day, wibToday)}
                  </p>
                  {dayItems.map((item) => (
                    <ActivityRow
                      key={item.id}
                      item={item}
                      onEdit={() => setEditItem(item)}
                      trailing={
                        <span className="text-sm font-bold tabular-nums">{fmtInt(item.kcal)}</span>
                      }
                    />
                  ))}
                </div>
              ))}
            </ListGroup>
          </section>
        )}

        <div className="space-y-2 lg:col-start-1 lg:row-start-2">
          <StravaCard compact />
          <InfoAccordion title={t("about.title")}>
            {weightKg !== null && <p>{t("about.estimate")}</p>}
            <p>{gain ? t("gain:coach.strength") : t("about.strength")}</p>
          </InfoAccordion>
        </div>
      </div>

      <section aria-label={t("moved.title")} className="mt-3 lg:mt-5">
        <JoyoFitCard />
      </section>

      <Sheet
        open={sheetOpen}
        onOpenChange={(open) => {
          setSheetOpen(open);
          if (!open) setError(null);
        }}
        title={activeType ? t("form.titleType", { type: typeLabel(activeType.key) }) : t("form.title")}
        description={t("form.description")}
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
              {t("form.type")}
            </p>
            {types.isPending ? (
              <p className="px-1 text-sm text-muted-foreground">{t("form.typesLoading")}</p>
            ) : types.error ? (
              <p className="px-1 text-sm text-destructive">
                {t("form.typesError", { error: types.error.message })}
              </p>
            ) : (
              <div role="group" aria-label={t("form.type")} className="flex flex-wrap gap-2">
                {types.data.map((type) => (
                  <Chip
                    key={type.key}
                    active={typeKey === type.key}
                    onClick={() => setType(type)}
                    className={cn(
                      typeKey === type.key && "border-transparent bg-bakar-soft text-bakar-ink",
                    )}
                  >
                    {typeLabel(type.key)}
                  </Chip>
                ))}
              </div>
            )}
          </div>

          <div>
            <FieldLabel htmlFor="exercise-name">{t("form.name")}</FieldLabel>
            <Input
              id="exercise-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t("form.namePlaceholder")}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <FieldLabel htmlFor="exercise-duration">{t("form.duration")}</FieldLabel>
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
              <FieldLabel htmlFor="exercise-kcal">{t("form.kcal")}</FieldLabel>
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
            {add.isPending ? t("form.saving") : t("common:actions.save")}
          </Button>
          {weightKg === null && (
            <p className="text-center text-xs text-muted-foreground">{t("picker.noWeight")}</p>
          )}
        </form>
      </Sheet>

      {editItem && (
        <ExerciseEditSheet key={editItem.id} row={editItem} onClose={() => setEditItem(null)} />
      )}

      {shareItem && (
        <ShareToFeedSheet
          open
          onOpenChange={(open) => {
            if (!open) setShareItem(null);
          }}
          title={t("row.shareTitle")}
          preview={`${shareItem.name} · ${fmtKcalLabel(shareItem.kcal)}`}
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

/** One logged activity: icon, name (+ source pill for imports), "30 min · 120 kcal". */
function ActivityRow({
  item,
  onEdit,
  trailing,
}: {
  item: ExerciseItem;
  onEdit: () => void;
  trailing: ReactNode;
}) {
  const { t } = useTranslation("olahraga");
  const Icon = TYPE_ICONS[item.type ?? ""] ?? Flame;
  return (
    <ListRow
      onClick={onEdit}
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
      subtitle={
        item.durationMin != null
          ? t("row.detail", { minutes: fmtInt(item.durationMin), kcal: fmtKcalLabel(item.kcal) })
          : fmtKcalLabel(item.kcal)
      }
      trailing={trailing}
    />
  );
}

function OlahragaSkeleton() {
  const { t } = useTranslation("olahraga");
  return (
    <Page className="max-w-xl lg:max-w-5xl" aria-busy="true" aria-label={t("screen.loading")}>
      <div className="flex items-center justify-between gap-3 px-1 pt-2 pb-3">
        <Skeleton className="h-9 w-36 rounded-full" />
        <Skeleton className="h-12 w-32 rounded-full" />
      </div>
      <div className="flex items-center gap-4 rounded-3xl bg-card p-4">
        <Skeleton className="size-[108px] rounded-full" />
        <Skeleton className="h-5 w-32 rounded-full" />
      </div>
      <Skeleton className="mt-3 h-36 rounded-3xl" />
      <div className="mt-3 grid grid-cols-3 gap-2">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-20 rounded-2xl" />
        ))}
      </div>
    </Page>
  );
}
