import { formatDuration } from "@joyorogo/api/lib/workout-analysis";
import type { WatchWorkoutListItem } from "@joyorogo/api/lib/watch-workout-store";
import { Button } from "@joyorogo/ui/components/button";
import { Skeleton } from "@joyorogo/ui/components/skeleton";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { ConfirmSheet } from "@/components/jam/confirm-sheet";
import { fmtBytes, fmtStart } from "@/components/jam/format";
import { SportIcon } from "@/components/jam/sport-icon";
import { Card, ListGroup, Page, PageHeader, SectionTitle } from "@/components/kit/surface";
import { ErrorNote } from "@/components/kit/error-note";
import { EmptyHint, ScreenError } from "@/components/screen-state";
import { fmtDecimal, fmtInt, timeAgo } from "@/lib/format";
import { orpc } from "@/utils/orpc";

const statusOptions = orpc.watchWorkout.status.queryOptions();

export const Route = createFileRoute("/_auth/jam/")({
  loader: ({ context }) => context.queryClient.ensureQueryData(statusOptions),
  pendingComponent: JamSkeleton,
  component: JamPage,
});

function JamSkeleton() {
  const { t } = useTranslation("jam");
  return (
    <Page className="max-w-xl" aria-busy="true" aria-label={t("loading")}>
      <div className="px-1 pt-2 pb-5">
        <Skeleton className="h-9 w-56 rounded-full" />
        <Skeleton className="mt-2 h-4 w-72 max-w-full rounded-full" />
      </div>
      <Skeleton className="h-[4.5rem] rounded-3xl" />
      <Skeleton className="mt-3 h-[4.5rem] rounded-3xl" />
      <Skeleton className="mt-3 h-[4.5rem] rounded-3xl" />
    </Page>
  );
}

function WorkoutRow({ item }: { item: WatchWorkoutListItem }) {
  const { t } = useTranslation("jam");
  const stats = [
    item.distanceM !== null && item.distanceM > 0
      ? t("row.distance", { value: fmtDecimal(item.distanceM / 1000, 2) })
      : null,
    formatDuration(item.movingSec),
    item.elevGainM !== null && item.elevGainM > 0
      ? t("row.elevation", { value: fmtInt(item.elevGainM) })
      : null,
    item.avgHr !== null ? t("row.heartRate", { value: fmtInt(item.avgHr) }) : null,
    fmtBytes(item.blobBytes),
  ].filter((stat) => stat !== null);

  return (
    <li className="relative">
      <Link
        to="/jam/$start"
        params={{ start: String(item.start) }}
        className="flex w-full items-center gap-3 px-5 py-3.5 text-left transition-colors hover:bg-muted/60 active:bg-muted focus-visible:bg-muted focus-visible:outline-none"
      >
        <SportIcon kind={item.sportKind} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[0.9375rem] font-semibold">{item.sportName}</span>
          <span className="mt-0.5 block text-[0.8125rem] text-muted-foreground tabular-nums">
            {fmtStart(item.start)}
          </span>
          <span className="mt-1 block text-[0.8125rem] leading-snug tabular-nums">
            {stats.join(" · ")}
          </span>
        </span>
      </Link>
    </li>
  );
}

function Workouts() {
  const { t } = useTranslation("jam");
  const list = useInfiniteQuery(
    orpc.watchWorkout.list.infiniteOptions({
      input: (cursor: number | undefined) => ({ cursor }),
      initialPageParam: undefined as number | undefined,
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    }),
  );

  if (list.isPending) {
    return (
      <div aria-busy="true" aria-label={t("loading")}>
        <Skeleton className="h-[4.5rem] rounded-3xl" />
        <Skeleton className="mt-3 h-[4.5rem] rounded-3xl" />
        <Skeleton className="mt-3 h-[4.5rem] rounded-3xl" />
      </div>
    );
  }
  if (list.error && !list.data) {
    return <ErrorNote message={list.error.message} onRetry={() => list.refetch()} />;
  }

  const items = list.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <section aria-label={t("listLabel")}>
      <ListGroup>
        {items.map((item) => (
          <WorkoutRow key={item.start} item={item} />
        ))}
      </ListGroup>
      {list.hasNextPage && (
        <div className="mt-3 text-center">
          {list.isFetchNextPageError && (
            <p role="alert" className="mb-2 text-sm text-destructive">
              {t("moreFailed")}
            </p>
          )}
          <Button
            variant="secondary"
            disabled={list.isFetchingNextPage}
            onClick={() => list.fetchNextPage()}
          >
            {t("more")}
          </Button>
        </div>
      )}
    </section>
  );
}

function JamPage() {
  const { t } = useTranslation("jam");
  const queryClient = useQueryClient();
  const status = useQuery(statusOptions);
  const [wipeOpen, setWipeOpen] = useState(false);

  const wipe = useMutation(
    orpc.watchWorkout.wipe.mutationOptions({
      onSuccess: () => {
        toast.success(t("wipe.toast"));
        setWipeOpen(false);
        void queryClient.invalidateQueries({ queryKey: orpc.watchWorkout.key() });
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  if (status.isPending) return <JamSkeleton />;
  if (status.error) return <ScreenError message={status.error.message} onRetry={() => status.refetch()} />;

  const { unlocked, count, bytes, lastChangeAt } = status.data;

  return (
    <Page className="max-w-xl">
      <PageHeader
        title={t("title")}
        subtitle={
          count > 0 && lastChangeAt !== null
            ? t("summary", { count, size: fmtBytes(bytes), when: timeAgo(new Date(lastChangeAt)) })
            : t("subtitle")
        }
      />

      {!unlocked && count === 0 && (
        <Card>
          <p className="text-base font-bold">{t("free.title")}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t("free.body")}</p>
          <Button className="mt-4" render={<Link to="/harga" />}>
            {t("free.cta")}
          </Button>
          <p className="mt-3 text-xs text-muted-foreground">{t("free.localOnly")}</p>
        </Card>
      )}

      {unlocked && count === 0 && (
        <EmptyHint title={t("empty.title")} pose="cheer">
          {t("empty.body")}
        </EmptyHint>
      )}

      {count > 0 && (
        <>
          {!unlocked && (
            <p className="mb-3 rounded-2xl bg-muted px-4 py-3 text-sm">{t("lapsed")}</p>
          )}
          <Workouts />

          <section className="mt-8">
            <SectionTitle>{t("wipe.heading")}</SectionTitle>
            <Card>
              <p className="text-sm text-muted-foreground">{t("wipe.body")}</p>
              <Button
                variant="destructive"
                className="mt-4 w-full"
                onClick={() => setWipeOpen(true)}
              >
                {t("wipe.button")}
              </Button>
            </Card>
          </section>
          <ConfirmSheet
            open={wipeOpen}
            onOpenChange={setWipeOpen}
            title={t("wipe.title")}
            body={t("wipe.confirmBody")}
            confirmLabel={t("wipe.confirm")}
            pending={wipe.isPending}
            onConfirm={() => wipe.mutate({})}
          />
        </>
      )}
    </Page>
  );
}
