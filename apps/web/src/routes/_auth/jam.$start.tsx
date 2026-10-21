import { kcalUnit } from "@joyorogo/i18n";
import { ORPCError } from "@orpc/client";
import { formatDuration } from "@joyorogo/api/lib/workout-analysis";
import type { WatchWorkoutListItem } from "@joyorogo/api/lib/watch-workout-store";
import { Button } from "@joyorogo/ui/components/button";
import { Skeleton } from "@joyorogo/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { WorkoutAnalysisView } from "@/components/feed/workout-analysis/workout-analysis-view";
import { ConfirmSheet } from "@/components/jam/confirm-sheet";
import { fmtBytes, fmtStart } from "@/components/jam/format";
import { Card, Page, PageHeader, SectionTitle } from "@/components/kit/surface";
import { EmptyHint, ScreenError } from "@/components/screen-state";
import { fmtDecimal, fmtInt } from "@/lib/format";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/_auth/jam/$start")({
  component: JamDetailPage,
});

function BackLink() {
  const { t } = useTranslation("jam");
  return (
    <Link
      to="/jam"
      className="-ml-1 inline-flex h-10 items-center gap-1 rounded-full px-2 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
    >
      <ChevronLeft className="size-4" aria-hidden />
      {t("back")}
    </Link>
  );
}

function DetailSkeleton() {
  const { t } = useTranslation("jam");
  return (
    <Page className="max-w-2xl" aria-busy="true" aria-label={t("detail.loading")}>
      <Skeleton className="h-10 w-40 rounded-full" />
      <div className="px-1 pt-2 pb-5">
        <Skeleton className="h-9 w-56 rounded-full" />
        <Skeleton className="mt-2 h-4 w-40 rounded-full" />
      </div>
      <Skeleton className="h-44 rounded-3xl" />
      <Skeleton className="mt-4 h-72 rounded-3xl" />
    </Page>
  );
}

/** Plain summary from the list row, for a workout stored without a readable analysis. */
function RowSummary({ item }: { item: WatchWorkoutListItem }) {
  const { t } = useTranslation("jam");
  const stats = [
    item.distanceM !== null && item.distanceM > 0
      ? { label: t("detail.distance"), value: `${fmtDecimal(item.distanceM / 1000, 2)} km` }
      : null,
    { label: t("detail.movingTime"), value: formatDuration(item.movingSec) },
    { label: t("detail.elapsedTime"), value: formatDuration(item.elapsedSec) },
    item.elevGainM !== null && item.elevGainM > 0
      ? { label: t("detail.elevation"), value: `${fmtInt(item.elevGainM)} m` }
      : null,
    item.avgHr !== null
      ? { label: t("detail.avgHr"), value: `${fmtInt(item.avgHr)} bpm` }
      : null,
    item.calories > 0 ? { label: t("detail.calories"), value: `${fmtInt(item.calories)} ${kcalUnit()}` } : null,
    item.steps > 0 ? { label: t("detail.steps"), value: fmtInt(item.steps) } : null,
  ].filter((stat) => stat !== null);

  return (
    <Card className="p-4">
      <SectionTitle>{t("detail.noAnalysisTitle")}</SectionTitle>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-3 px-1">
        {stats.map((stat) => (
          <div key={stat.label} className="min-w-0">
            <dt className="truncate text-xs text-muted-foreground">{stat.label}</dt>
            <dd className="text-base font-bold tabular-nums">{stat.value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 rounded-2xl bg-muted px-3 py-2 text-sm">{t("detail.noAnalysisNote")}</p>
    </Card>
  );
}

function JamDetailPage() {
  const { t } = useTranslation("jam");
  const { start: startParam } = Route.useParams();
  const start = /^\d{1,10}$/.test(startParam) ? Number(startParam) : null;
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const detail = useQuery({
    ...orpc.watchWorkout.detail.queryOptions({ input: { start: start ?? 0 } }),
    enabled: start !== null,
    retry: false,
  });

  const remove = useMutation(
    orpc.watchWorkout.remove.mutationOptions({
      onSuccess: async () => {
        toast.success(t("remove.toast"));
        setConfirmOpen(false);
        await navigate({ to: "/jam" });
        await queryClient.invalidateQueries({ queryKey: orpc.watchWorkout.key() });
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  const notFound =
    start === null || (detail.error instanceof ORPCError && detail.error.code === "NOT_FOUND");
  if (notFound) {
    return (
      <Page className="max-w-2xl">
        <BackLink />
        <div className="mt-3">
          <EmptyHint title={t("detail.notFoundTitle")}>{t("detail.notFoundBody")}</EmptyHint>
          <Button className="mt-4 w-full" variant="secondary" render={<Link to="/jam" />}>
            {t("detail.toList")}
          </Button>
        </div>
      </Page>
    );
  }
  if (detail.isPending) return <DetailSkeleton />;
  if (detail.error) {
    return <ScreenError message={detail.error.message} onRetry={() => detail.refetch()} />;
  }

  const { item, analysis } = detail.data;

  return (
    <Page className="max-w-2xl">
      <BackLink />
      <PageHeader
        title={item.sportName}
        subtitle={`${fmtStart(item.start)} · ${t("detail.sizeNote", { size: fmtBytes(item.blobBytes) })}`}
      />

      {analysis ? <WorkoutAnalysisView analysis={analysis} /> : <RowSummary item={item} />}

      <Button
        variant="destructive"
        className="mt-6 w-full"
        onClick={() => setConfirmOpen(true)}
      >
        {t("remove.button")}
      </Button>
      <ConfirmSheet
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t("remove.title")}
        body={t("remove.body")}
        confirmLabel={t("remove.confirm")}
        pending={remove.isPending}
        onConfirm={() => remove.mutate({ start: item.start })}
      />
    </Page>
  );
}
