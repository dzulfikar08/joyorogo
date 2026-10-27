import { Button } from "@joyorogo/ui/components/button";
import { Skeleton } from "@joyorogo/ui/components/skeleton";
import { cn } from "@joyorogo/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Flame, Settings2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Chip } from "@/components/chip";
import { Page, PageHeader } from "@/components/kit/surface";
import { EmptyHint, ScreenError } from "@/components/screen-state";
import type { BoardRow } from "@/lib/api-types";
import { client, orpc } from "@/utils/orpc";

export const Route = createFileRoute("/_auth/papan")({
  pendingComponent: PapanSkeleton,
  component: PapanPage,
});

function PapanSkeleton() {
  return (
    <Page className="max-w-xl" aria-busy="true">
      <Skeleton className="mb-5 h-9 w-48 rounded-full" />
      <Skeleton className="h-12 rounded-full" />
      <Skeleton className="mt-3 h-16 rounded-3xl" />
      <Skeleton className="mt-2 h-16 rounded-3xl" />
      <Skeleton className="mt-2 h-16 rounded-3xl" />
    </Page>
  );
}

/** Monday of the current week in WIB (the board's week key), shifted by `weeks`. */
function mondayWib(weeks: number): string {
  const wib = new Date(Date.now() + 7 * 3600_000);
  const sinceMonday = (wib.getUTCDay() + 6) % 7;
  wib.setUTCDate(wib.getUTCDate() - sinceMonday + weeks * 7);
  return wib.toISOString().slice(0, 10);
}

function DaysRow({ days }: { days: boolean[] }) {
  const { i18n } = useTranslation();
  // 2024-01-01 is a Monday.
  const labels = Array.from({ length: 7 }, (_, i) =>
    new Date(Date.UTC(2024, 0, 1 + i)).toLocaleDateString(i18n.language, {
      weekday: "narrow",
      timeZone: "UTC",
    }),
  );
  return (
    <span className="flex gap-1" aria-hidden>
      {days.map((on, i) => (
        <span
          key={i}
          className={cn(
            "grid size-5 place-items-center rounded-md text-[0.625rem] font-bold",
            on ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
          )}
        >
          {labels[i]}
        </span>
      ))}
    </span>
  );
}

function Row({ row }: { row: BoardRow }) {
  const { t } = useTranslation("badges");
  const name = row.anonymous || !row.name ? t("board.anonymous", { rank: row.rank }) : row.name;
  return (
    <li
      className={cn(
        "flex items-center gap-3 rounded-3xl bg-card px-4 py-3",
        row.isMe && "ring-2 ring-primary",
      )}
      aria-label={t("board.rowDays", { n: row.daysLogged })}
    >
      <span className="w-9 shrink-0 text-center text-lg font-extrabold tabular-nums">
        {row.rank}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate font-bold">{name}</span>
          {row.isMe && (
            <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[0.6875rem] font-bold text-primary">
              {t("board.you")}
            </span>
          )}
        </span>
        <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <DaysRow days={row.days} />
          <span className="tabular-nums">{t("board.rowDays", { n: row.daysLogged })}</span>
        </span>
      </span>
      {row.streak > 0 && (
        <span className="flex shrink-0 items-center gap-0.5 text-sm font-bold tabular-nums">
          <Flame className="size-4 text-bakar-ink" aria-hidden />
          {row.streak}
        </span>
      )}
    </li>
  );
}

function OptInCard({ eligible }: { eligible: boolean }) {
  const { t } = useTranslation("badges");
  const queryClient = useQueryClient();
  const prefs = useQuery(orpc.leaderboard.prefs.queryOptions());
  const join = useMutation({
    mutationFn: () =>
      client.leaderboard.setPrefs({
        optIn: true,
        displayMode: prefs.data?.displayMode ?? "anonim",
        alias: prefs.data?.alias ?? null,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: orpc.leaderboard.key() }),
    onError: (error) => toast.error(error.message),
  });
  return (
    <section className="mb-4 rounded-3xl bg-card p-5">
      <h2 className="text-base font-bold tracking-tight">{t("board.optIn")}</h2>
      {eligible ? (
        <>
          <p className="mt-1 text-sm text-muted-foreground">{t("board.optInBody")}</p>
          <p className="mt-2 text-xs text-muted-foreground">{t("board.consent")}</p>
          <Button className="mt-3" onClick={() => join.mutate()} disabled={join.isPending}>
            {t("board.optInCta")}
          </Button>
        </>
      ) : (
        <p className="mt-1 text-sm text-muted-foreground">{t("board.maternal")}</p>
      )}
    </section>
  );
}

function PapanPage() {
  const { t } = useTranslation(["badges", "common"]);
  const [scope, setScope] = useState<"global" | "team">("global");
  const [previous, setPrevious] = useState(false);
  const [teamId, setTeamId] = useState<string | null>(null);
  const prefs = useQuery(orpc.leaderboard.prefs.queryOptions());
  const groups = useQuery(orpc.group.list.queryOptions());
  const activeTeam = teamId ?? groups.data?.[0]?.id ?? null;
  const week = mondayWib(previous ? -1 : 0);
  const board = useQuery({
    ...orpc.leaderboard.board.queryOptions({
      input: { scope, week, ...(scope === "team" && activeTeam ? { teamId: activeTeam } : {}) },
    }),
    enabled: prefs.data?.enabled === true && (scope === "global" || activeTeam !== null),
    staleTime: 60_000,
  });

  if (prefs.isPending) return <PapanSkeleton />;
  if (prefs.error) return <ScreenError message={prefs.error.message} onRetry={() => prefs.refetch()} />;
  if (!prefs.data.enabled) {
    return (
      <Page className="max-w-xl">
        <EmptyHint title={t("badges:board.empty")} pose="watch" />
      </Page>
    );
  }

  const rows = board.data?.rows ?? [];
  const me = board.data?.me ?? null;
  const meInTop = me !== null && rows.some((r) => r.isMe);

  return (
    <Page className="max-w-xl">
      <PageHeader
        title={t("badges:board.title")}
        subtitle={t("badges:board.subtitle")}
        action={
          <Link
            to="/profil/privasi"
            aria-label={t("badges:board.manage")}
            className="grid size-11 place-items-center rounded-full bg-card text-muted-foreground hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
          >
            <Settings2 className="size-5" aria-hidden />
          </Link>
        }
      />
      {!prefs.data.optIn && <OptInCard eligible={prefs.data.eligible} />}

      <div className="flex flex-wrap gap-2" role="group" aria-label={t("badges:board.title")}>
        <Chip active={scope === "global"} onClick={() => setScope("global")}>
          {t("badges:board.global")}
        </Chip>
        <Chip active={scope === "team"} onClick={() => setScope("team")}>
          {t("badges:board.team")}
        </Chip>
        <span className="mx-1 w-px bg-border" aria-hidden />
        <Chip active={!previous} onClick={() => setPrevious(false)}>
          {t("badges:board.thisWeek")}
        </Chip>
        <Chip active={previous} onClick={() => setPrevious(true)}>
          {t("badges:board.lastWeek")}
        </Chip>
      </div>

      {scope === "team" && groups.data && groups.data.length > 1 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {groups.data.map((g) => (
            <Chip key={g.id} active={g.id === activeTeam} onClick={() => setTeamId(g.id)}>
              {g.name}
            </Chip>
          ))}
        </div>
      )}

      <div className="mt-4">
        {scope === "team" && groups.data && groups.data.length === 0 ? (
          <EmptyHint title={t("badges:board.noGroups")} pose="watch" />
        ) : board.isPending ? (
          <>
            <Skeleton className="h-16 rounded-3xl" />
            <Skeleton className="mt-2 h-16 rounded-3xl" />
          </>
        ) : board.error ? (
          <ScreenError message={board.error.message} onRetry={() => board.refetch()} />
        ) : (
          <>
            <p className="mb-2 px-1 text-xs text-muted-foreground">
              {t("badges:board.total", { count: board.data.total })}
              {board.data.closed ? ` · ${t("badges:board.closed")}` : ""}
            </p>
            {rows.length === 0 ? (
              <EmptyHint title={t("badges:board.empty")} pose="watch">
                {t("badges:board.emptyHint")}
              </EmptyHint>
            ) : (
              <ol className="space-y-2">
                {rows.map((row) => (
                  <Row key={`${row.rank}-${row.name ?? "anon"}`} row={row} />
                ))}
              </ol>
            )}
            {prefs.data.optIn && me === null && !previous && (
              <p className="mt-3 rounded-2xl bg-muted px-4 py-3 text-sm">{t("badges:board.notRanked")}</p>
            )}
            {me && !meInTop && (
              <div className="sticky bottom-24 mt-3 md:bottom-4">
                <ol>
                  <Row row={me} />
                </ol>
              </div>
            )}
          </>
        )}
        <p className="mt-4 px-1 text-xs leading-relaxed text-muted-foreground">
          {t("badges:board.streakNote")}
        </p>
      </div>
    </Page>
  );
}
