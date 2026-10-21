import { fmtDateShort, fmtDecimal } from "@joyorogo/i18n";

import { fmtClock } from "@/lib/format";
import { Button } from "@joyorogo/ui/components/button";
import { Input } from "@joyorogo/ui/components/input";
import { MultiSelect, Select } from "@joyorogo/ui/components/select";
import { cn } from "@joyorogo/ui/lib/utils";
import type { FitWebWorkout } from "@joyorogo/api/lib/fit-web";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowDown, ArrowUp, ChevronsUpDown, Search } from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Card, IconChip, PageHeader, Stat } from "@/components/kit";
import { RangeControls } from "@/components/range-controls";
import { BlockSkeleton, EmptyState, QueryError } from "@/components/states";
import { SPORT_KINDS, type SportKind, totals } from "@/lib/aggregate";
import { fmtHm, fmtKm } from "@/lib/format";
import { usePageTitle } from "@/lib/page-title";
import { workoutsQuery } from "@/lib/queries";
import { type RangeDays, isRange, windowOf } from "@/lib/range";
import { sportIcon } from "@/lib/sport";
import {
  type SortDir,
  type SortKey,
  filterWorkouts,
  isSortKey,
  kindCounts,
  paceSecKm,
  readsAsPace,
  sortWorkouts,
  speedMs,
} from "@/lib/workouts";

/** Defaults (90 days, no filter, newest first) stay out of the URL. */
type Search = { range?: RangeDays; sport?: SportKind[]; q?: string; sort?: SortKey; dir?: "asc" };

export const Route = createFileRoute("/_auth/latihan/")({
  component: WorkoutsPage,
  loaderDeps: ({ search }) => ({ range: search.range ?? 90 }),
  loader: ({ context, deps }) => {
    void context.queryClient.prefetchQuery(workoutsQuery(windowOf(deps.range)));
  },
  validateSearch: (search: Record<string, unknown>): Search => ({
    range:
      isRange(Number(search.range)) && Number(search.range) !== 90
        ? (Number(search.range) as RangeDays)
        : undefined,
    sport: Array.isArray(search.sport)
      ? search.sport.filter((k): k is SportKind => (SPORT_KINDS as readonly unknown[]).includes(k))
      : undefined,
    q: typeof search.q === "string" && search.q !== "" ? search.q.slice(0, 60) : undefined,
    sort: isSortKey(search.sort) && search.sort !== "date" ? search.sort : undefined,
    dir: search.dir === "asc" ? "asc" : undefined,
  }),
});

const PAGE = 100;

function fmtPace(sec: number | null): string {
  if (sec === null) return "–";
  const total = Math.round(sec);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** "5:32 /km" for runs and walks, "24,5 km/j" for the rest; "–" without a distance. */
function PaceCell({ w }: { w: FitWebWorkout }) {
  const { t } = useTranslation("fitWebWorkouts");
  const speed = speedMs(w);
  if (speed === null) return <>–</>;
  return readsAsPace(w.sportKind) ? (
    <>
      {fmtPace(paceSecKm(w))}
      <span className="text-xs font-normal text-muted-foreground"> {t("unit.perKm")}</span>
    </>
  ) : (
    <>
      {fmtDecimal(speed * 3.6, 1)}
      <span className="text-xs font-normal text-muted-foreground"> {t("unit.kmh")}</span>
    </>
  );
}

function WorkoutsPage() {
  const { t } = useTranslation("fitWebWorkouts");
  usePageTitle(t("title"));
  const { t: tw } = useTranslation("fitWeb");
  const raw = Route.useSearch();
  const dir: SortDir = raw.dir ?? "desc";
  const search = {
    range: raw.range ?? 90,
    sport: raw.sport ?? [],
    q: raw.q ?? "",
    sort: raw.sort ?? "date",
    dir,
  };
  const navigate = Route.useNavigate();
  const win = useMemo(() => windowOf(search.range), [search.range]);
  const result = useQuery(workoutsQuery(win));
  const [shown, setShown] = useState(PAGE);
  const settled = useDeferredValue(Boolean(result.data), false);

  /** Writes a change into the URL; a value equal to its default is dropped from it. */
  const set = (patch: {
    range?: RangeDays;
    sport?: SportKind[];
    q?: string;
    sort?: SortKey;
    dir?: SortDir;
  }) => {
    setShown(PAGE);
    void navigate({
      search: (prev) => {
        const next = { ...prev, ...patch };
        return {
          range: next.range === 90 ? undefined : next.range,
          sport: next.sport && next.sport.length > 0 ? next.sport : undefined,
          q: next.q ? next.q : undefined,
          sort: next.sort === "date" ? undefined : next.sort,
          dir: next.dir === "asc" ? "asc" : undefined,
        };
      },
      replace: true,
    });
  };

  const header = (
    <PageHeader
      title={t("title")}
      subtitle={t("subtitle", { from: fmtDateShort(win.from), to: fmtDateShort(win.to) })}
      actions={<RangeControls range={search.range} onRange={(range) => set({ range })} />}
    />
  );

  const all = result.data?.items;
  const rows = useMemo(
    () =>
      all ? sortWorkouts(filterWorkouts(all, search.sport, search.q), search.sort, search.dir) : [],
    [all, search.sport, search.q, search.sort, search.dir],
  );
  const counts = useMemo(() => (all ? kindCounts(all) : new Map<SportKind, number>()), [all]);

  if (result.error) {
    return (
      <>
        {header}
        <Card>
          <QueryError error={result.error} onRetry={() => void result.refetch()} />
        </Card>
      </>
    );
  }
  if (!all || !settled) {
    return (
      <>
        {header}
        <BlockSkeleton className="h-24" />
        <BlockSkeleton className="mt-4 h-96" />
      </>
    );
  }
  if (all.length === 0) {
    return (
      <>
        {header}
        <Card>
          <EmptyState title={t("empty.title")}>{t("empty.body")}</EmptyState>
        </Card>
      </>
    );
  }

  const sum = totals(rows);
  const labels: Record<SportKind, string> = {
    run: tw("sport.run"),
    walk: tw("sport.walk"),
    ride: tw("sport.ride"),
    swim: tw("sport.swim"),
    other: tw("sport.other"),
  };
  const sortBy = (key: SortKey) =>
    set({ sort: key, dir: search.sort === key && search.dir === "desc" ? "asc" : "desc" });
  const filtered = search.sport.length > 0 || search.q.trim() !== "";

  const columns: { key: SortKey; label: string; align: "left" | "right" }[] = [
    { key: "date", label: t("col.date"), align: "left" },
    { key: "distance", label: t("col.distance"), align: "right" },
    { key: "duration", label: t("col.duration"), align: "right" },
    { key: "speed", label: t("col.pace"), align: "right" },
    { key: "hr", label: t("col.hr"), align: "right" },
    { key: "elevation", label: t("col.elevation"), align: "right" },
    { key: "calories", label: t("col.calories"), align: "right" },
  ];

  return (
    <div
      aria-busy={result.isPlaceholderData}
      className={cn("flex flex-col gap-4 transition-opacity", result.isPlaceholderData && "opacity-60")}
    >
      {header}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label={t("totals.count")}
          value={sum.count}
          hint={filtered ? t("totals.of", { total: all.length }) : undefined}
        />
        <Stat
          label={t("totals.distance")}
          value={fmtDecimal(sum.distanceM / 1000, sum.distanceM >= 100_000 ? 0 : 1)}
          unit="km"
        />
        <Stat label={t("totals.time")} value={fmtHm(sum.movingSec)} />
        <Stat label={t("totals.elevation")} value={fmtDecimal(sum.elevGainM, 0)} unit="m" />
      </div>

      <Card className="p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full min-w-0 sm:w-64">
            <Search
              className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              type="search"
              value={search.q}
              onChange={(event) => set({ q: event.target.value })}
              placeholder={t("filter.search")}
              aria-label={t("filter.search")}
              className="h-10 rounded-full pl-10"
            />
          </div>
          <MultiSelect<SportKind>
            label={t("filter.sport")}
            values={search.sport}
            onChange={(sport) => set({ sport })}
            options={SPORT_KINDS.filter((kind) => counts.has(kind)).map((kind) => ({
              value: kind,
              label: labels[kind],
              hint: counts.get(kind),
            }))}
            triggerLabel={
              search.sport.length > 0
                ? t("filter.sportSome", { n: search.sport.length })
                : t("filter.sportAny")
            }
            className="w-full sm:w-auto"
          />
          <div className="flex min-w-0 flex-wrap gap-1.5">
            {filtered && (
              <Button variant="ghost" size="sm" onClick={() => set({ sport: [], q: "" })}>
                {t("filter.clear")}
              </Button>
            )}
          </div>
          <div className="ml-auto flex items-center gap-2 text-xs font-semibold text-muted-foreground xl:hidden">
            {t("filter.sort")}
            <Select<SortKey>
              label={t("filter.sort")}
              value={search.sort}
              onChange={(sort) => set({ sort })}
              options={columns.map((c) => ({ value: c.key, label: c.label }))}
            />
            <Button
              variant="outline"
              size="icon-sm"
              aria-label={search.dir === "desc" ? t("filter.descending") : t("filter.ascending")}
              onClick={() => set({ dir: search.dir === "desc" ? "asc" : "desc" })}
            >
              {search.dir === "desc" ? <ArrowDown aria-hidden /> : <ArrowUp aria-hidden />}
            </Button>
          </div>
        </div>
      </Card>

      {rows.length === 0 ? (
        <Card>
          <EmptyState title={t("filter.noMatch")}>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => set({ sport: [], q: "" })}
            >
              {t("filter.clear")}
            </Button>
          </EmptyState>
        </Card>
      ) : (
        <>
          {/* Below xl (the sidebar leaves the table too little room): one card per workout. */}
          <ul className="grid gap-2 md:grid-cols-2 xl:hidden">
            {rows.slice(0, shown).map((w) => {
              const Icon = sportIcon(w.sportName, w.sportKind);
              return (
                <li key={w.start}>
                  <Link
                    to="/latihan/$start"
                    params={{ start: String(w.start) }}
                    className="block rounded-2xl bg-card p-3.5 ring-1 ring-foreground/5 transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 active:bg-muted"
                  >
                    <span className="flex items-center gap-3">
                      <IconChip className="size-9 bg-primary/10 text-primary">
                        <Icon className="size-4" aria-hidden />
                      </IconChip>
                      <span className="min-w-0 flex-1">
                        <span className="block break-words text-sm font-bold">{w.sportName}</span>
                        <span className="block break-words text-xs text-muted-foreground">
                          {fmtDateShort(w.date)} · {fmtClock(new Date(w.start * 1000))}
                        </span>
                      </span>
                    </span>
                    <dl className="mt-3 grid grid-cols-4 gap-2 text-sm tabular-nums">
                      {[
                        [t("col.distance"), w.distanceM ? fmtKm(w.distanceM) : "–"],
                        [t("col.duration"), fmtHm(w.movingSec)],
                        [
                          readsAsPace(w.sportKind) ? t("col.paceOnly") : t("col.speedOnly"),
                          <PaceCell key="p" w={w} />,
                        ],
                        [t("col.hr"), w.avgHr ? `${w.avgHr}` : "–"],
                      ].map(([label, value], i) => (
                        <div key={i} className="min-w-0">
                          <dt className="text-[0.6875rem] break-words text-muted-foreground">
                            {label}
                          </dt>
                          <dd className="font-semibold break-words">{value}</dd>
                        </div>
                      ))}
                    </dl>
                  </Link>
                </li>
              );
            })}
          </ul>

          {/* Desktop: a sortable table. */}
          <Card className="hidden overflow-x-auto p-0 xl:block">
            <table className="w-full text-sm">
              <caption className="sr-only">{t("tableLabel")}</caption>
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th scope="col" className="px-4 py-3 text-left font-semibold">
                    {t("col.sport")}
                  </th>
                  {columns.map((c) => {
                    const active = search.sort === c.key;
                    return (
                      <th
                        key={c.key}
                        scope="col"
                        aria-sort={
                          active ? (search.dir === "asc" ? "ascending" : "descending") : "none"
                        }
                        className={cn(
                          "px-2 py-1.5 font-semibold",
                          c.align === "right" ? "text-right" : "text-left",
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => sortBy(c.key)}
                          className={cn(
                            "inline-flex h-9 items-center gap-1 rounded-lg px-2 outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40",
                            active && "text-foreground",
                          )}
                        >
                          {c.label}
                          {active ? (
                            search.dir === "asc" ? (
                              <ArrowUp className="size-3.5" aria-hidden />
                            ) : (
                              <ArrowDown className="size-3.5" aria-hidden />
                            )
                          ) : (
                            <ChevronsUpDown className="size-3.5 opacity-40" aria-hidden />
                          )}
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {rows.slice(0, shown).map((w) => {
                  const Icon = sportIcon(w.sportName, w.sportKind);
                  return (
                    <tr
                      key={w.start}
                      onClick={() =>
                        void navigate({ to: "/latihan/$start", params: { start: String(w.start) } })
                      }
                      className="cursor-pointer border-b border-border/60 transition-colors last:border-0 hover:bg-muted/60 focus-within:bg-muted/60"
                    >
                      <td className="max-w-[16rem] px-4 py-2.5">
                        <Link
                          to="/latihan/$start"
                          params={{ start: String(w.start) }}
                          className="flex items-center gap-2.5 rounded-lg outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
                        >
                          <IconChip className="size-8 bg-primary/10 text-primary">
                            <Icon className="size-4" aria-hidden />
                          </IconChip>
                          <span className="break-words font-semibold">{w.sportName}</span>
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        {fmtDateShort(w.date)}
                        <span className="text-xs text-muted-foreground">
                          {" "}
                          · {fmtClock(new Date(w.start * 1000))}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap">
                        {w.distanceM ? fmtKm(w.distanceM) : "–"}
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap">
                        {fmtHm(w.movingSec)}
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap">
                        <PaceCell w={w} />
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap">
                        {w.avgHr ? w.avgHr : "–"}
                        {w.maxHr ? (
                          <span className="text-xs text-muted-foreground"> / {w.maxHr}</span>
                        ) : null}
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap">
                        {w.elevGainM !== null ? `${fmtDecimal(w.elevGainM, 0)} m` : "–"}
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap">
                        {w.calories > 0 ? fmtDecimal(w.calories, 0) : "–"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>

          <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
            <p>{t("showing", { shown: Math.min(shown, rows.length), total: rows.length })}</p>
            {shown < rows.length && (
              <Button variant="outline" size="sm" onClick={() => setShown((n) => n + PAGE)}>
                {t("more")}
              </Button>
            )}
          </div>
          {result.data?.truncated && (
            <p className="text-xs text-muted-foreground">
              {t("truncated", { n: result.data.items.length })}
            </p>
          )}
        </>
      )}
    </div>
  );
}
