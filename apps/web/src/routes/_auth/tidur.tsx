import { Button } from "@joyorogo/ui/components/button";
import { Input } from "@joyorogo/ui/components/input";
import { Skeleton } from "@joyorogo/ui/components/skeleton";
import { cn } from "@joyorogo/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";

import { SLEEP_NEED_HOURS, jakartaToday, relativeDayLabel, shiftDate } from "@joyorogo/api/lib/engine";

import { Ring } from "@/components/kit/ring";
import { ScreenError } from "@/components/screen-state";
import { Card, FieldLabel, Page, PageHeader, SectionTitle } from "@/components/kit/surface";
import { DaySwitcher } from "@/components/day-switcher";
import { fmtKg, parseNum } from "@/lib/format";
import { useOptimisticMutation } from "@/lib/optimistic";
import type { AppRouterClient } from "@joyorogo/api/routers/index";
import { client, orpc } from "@/utils/orpc";

const sleepOptions = (date: string) => orpc.sleep.getForDate.queryOptions({ input: { date } });

export const Route = createFileRoute("/_auth/tidur")({
  validateSearch: (search: Record<string, unknown>): { date?: string } => {
    const raw = typeof search.date === "string" ? search.date : undefined;
    return { date: raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : undefined };
  },
  loaderDeps: ({ search }) => ({ date: search.date }),
  loader: ({ context, deps }) => {
    // The switcher picks a day; that day's sleep is the night keyed the
    // previous WIB day (day.summary reads it the same way).
    const date = shiftDate(deps.date ?? jakartaToday(), -1);
    return context.queryClient.ensureQueryData(sleepOptions(date));
  },
  pendingComponent: TidurSkeleton,
  component: TidurPage,
});

const PRESETS = [5, 6, 7, 8, 9];

function TidurPage() {
  const { date: paramDate } = Route.useSearch();
  const navigate = Route.useNavigate();
  const viewDate = paramDate ?? jakartaToday();
  const nightDate = shiftDate(viewDate, -1);
  const logged = useQuery(sleepOptions(nightDate));
  if (logged.isPending) return <TidurSkeleton />;
  if (logged.error) {
    return <ScreenError message={logged.error.message} onRetry={() => logged.refetch()} />;
  }
  return (
    <TidurScreen
      row={logged.data}
      viewDate={viewDate}
      nightDate={nightDate}
      onChange={(target) =>
        navigate({ search: { date: target === jakartaToday() ? undefined : target } })
      }
    />
  );
}

function TidurScreen({
  row,
  viewDate,
  nightDate,
  onChange,
}: {
  row: { hours: number } | null;
  viewDate: string;
  nightDate: string;
  onChange: (date: string) => void;
}) {
  const today = jakartaToday();
  const isToday = viewDate === today;
  const dayLabel = relativeDayLabel(viewDate, today);
  const [manual, setManual] = useState("");
  const [error, setError] = useState<string | null>(null);
  const hours = row?.hours ?? null;

  // Previous hours for this night, for the undo re-log.
  const previousHours = useRef<number | null>(null);
  const log = useOptimisticMutation<
    Parameters<AppRouterClient["sleep"]["log"]>[0],
    Awaited<ReturnType<AppRouterClient["sleep"]["log"]>>
  >({
    mutationFn: (input) => client.sleep.log(input),
    patch: (input, cache) => {
      const nightDate = input.date ?? viewDate;
      previousHours.current = row?.hours ?? null;
      cache.summary({ date: nightDate, sleepHours: input.hours });
    },
    invalidate: () => [orpc.sleep.key(), orpc.day.key()],
    success: (_input, saved) => {
      if (!saved) return undefined;
      const prev = previousHours.current;
      previousHours.current = null;
      const message = isToday
        ? `Tidur tadi malam: ${fmtKg(saved.hours)} jam.`
        : `Tersimpan ke ${dayLabel}.`;
      if (prev === null || prev === saved.hours) return { message };
      return {
        message,
        undo: () => void client.sleep.log({ date: saved.date, hours: prev }),
      };
    },
  });

  const submitManual = () => {
    const value = parseNum(manual);
    if (value === null || value < 0 || value > 24) {
      setError("Isi jam tidur antara 0 dan 24.");
      return;
    }
    log.mutate({ date: nightDate, hours: value });
    setManual("");
    setError(null);
  };

  return (
    <Page className="max-w-xl lg:max-w-3xl">
      <PageHeader title="Tidur" />

      {/* Day switcher */}
      <div className="mb-3 flex justify-center lg:justify-start">
        <DaySwitcher date={viewDate} onChange={onChange} />
      </div>

      <Card className="p-6">
        <div className="flex flex-col items-center text-center">
          <Ring
            metric="tidur"
            value={hours ?? 0}
            max={SLEEP_NEED_HOURS}
            size={216}
            stroke={16}
            label={
              hours !== null
                ? `Tidur ${fmtKg(hours)} dari kebutuhan ${SLEEP_NEED_HOURS} jam`
                : `Belum ada catatan tidur, kebutuhan ${SLEEP_NEED_HOURS} jam`
            }
          >
            <div>
              <p className="text-sm font-semibold text-muted-foreground">
                {isToday ? "Tadi malam" : dayLabel}
              </p>
              {hours !== null ? (
                <p className="text-[3.5rem] leading-none font-extrabold tracking-tighter tabular-nums">
                  {fmtKg(hours)}
                </p>
              ) : (
                <p className="text-[3.5rem] leading-none font-extrabold tracking-tighter text-muted-foreground">
                  –
                </p>
              )}
              <p className="mt-1 text-sm font-semibold text-muted-foreground">jam</p>
            </div>
          </Ring>
          <p className="mt-4 max-w-xs text-sm text-muted-foreground">
            {hours === null
              ? `Belum dicatat. Kebutuhanmu ${SLEEP_NEED_HOURS} jam tiap malam.`
              : hours >= SLEEP_NEED_HOURS
                ? "Kebutuhan terpenuhi, mantap."
                : `Kurang ${fmtKg(SLEEP_NEED_HOURS - hours)} jam dari kebutuhan ${SLEEP_NEED_HOURS} jam.`}
          </p>
        </div>
      </Card>

      <section aria-label="Catat durasi tidur" className="mt-7">
        <SectionTitle>{isToday ? "Durasi tadi malam" : `Durasi ${dayLabel}`}</SectionTitle>
        <div role="group" aria-label="Preset jam tidur" className="grid grid-cols-5 gap-2">
          {PRESETS.map((preset) => {
            const active = hours === preset;
            return (
              <button
                key={preset}
                type="button"
                aria-pressed={active}
                disabled={log.isPending}
                onClick={() => log.mutate({ date: nightDate, hours: preset })}
                className={cn(
                  "pressable flex min-h-16 flex-col items-center justify-center rounded-2xl bg-card focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none disabled:opacity-60",
                  active
                    ? "bg-tidur-soft text-tidur-ink ring-2 ring-inset ring-tidur"
                    : "hover:bg-muted/50",
                )}
              >
                <span className="text-xl font-extrabold tabular-nums">{preset}</span>
                <span
                  className={cn(
                    "text-xs font-semibold",
                    active ? "text-tidur-ink" : "text-muted-foreground",
                  )}
                >
                  jam
                </span>
              </button>
            );
          })}
        </div>

        <form
          className="mt-3 flex items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            submitManual();
          }}
        >
          <div className="flex-1">
            <FieldLabel htmlFor="sleep-hours">Atau isi manual</FieldLabel>
            <Input
              id="sleep-hours"
              type="number"
              step="0.1"
              min="0"
              max="24"
              inputMode="decimal"
              value={manual}
              onChange={(event) => setManual(event.target.value)}
              placeholder="7,5"
            />
          </div>
          <Button type="submit" disabled={log.isPending}>
            {log.isPending ? "Menyimpan..." : "Simpan"}
          </Button>
        </form>
        {error && <p className="mt-2 px-1 text-sm text-destructive">{error}</p>}
        <p className="mt-2 px-1 text-xs text-muted-foreground">
          {isToday
            ? "Catatan masuk untuk tadi malam. Menyimpan ulang menimpa nilai sebelumnya."
            : `Catatan masuk untuk malam ${dayLabel}. Menyimpan ulang menimpa nilai sebelumnya.`}
        </p>
      </section>
    </Page>
  );
}

function TidurSkeleton() {
  return (
    <Page className="max-w-xl lg:max-w-3xl" aria-busy="true" aria-label="Memuat catatan tidur">
      <div className="px-1 pt-2 pb-5">
        <Skeleton className="h-9 w-28 rounded-full" />
      </div>
      <div className="flex flex-col items-center rounded-3xl bg-card p-6">
        <Skeleton className="size-[216px] rounded-full" />
        <Skeleton className="mt-4 h-5 w-48 rounded-full" />
      </div>
      <div className="mt-7 grid grid-cols-5 gap-2">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-16 rounded-2xl" />
        ))}
      </div>
      <Skeleton className="mt-3 h-12 rounded-xl" />
    </Page>
  );
}
