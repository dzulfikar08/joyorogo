import { Button } from "@joyorogo/ui/components/button";
import { Skeleton } from "@joyorogo/ui/components/skeleton";
import { GOALS } from "@joyorogo/api/lib/challenge";
import { fmtDateShort } from "@joyorogo/i18n";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Info, LogOut, RefreshCw, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { DotLegend, LeaderboardRow } from "@/components/challenge/challenge-board";
import { StatusChip } from "@/components/challenge/challenge-parts";
import { Card, Page, PageHeader, SectionTitle } from "@/components/kit/surface";
import { ScreenError } from "@/components/screen-state";
import { ShareStoryButton } from "@/components/story/share-story-button";
import type { StorySpec } from "@/components/story/story-card";
import { fmtInt } from "@/lib/format";
import { orpc } from "@/utils/orpc";

const detailOptions = (challengeId: string) =>
  orpc.challenge.detail.queryOptions({ input: { challengeId } });

export const Route = createFileRoute("/_auth/grup_/$groupId/tantangan/$challengeId")({
  loader: ({ context, params }) => {
    void context.queryClient.ensureQueryData(detailOptions(params.challengeId));
  },
  pendingComponent: DetailSkeleton,
  component: TantanganPage,
});

function DetailSkeleton() {
  const { t } = useTranslation("challenge");
  return (
    <Page className="max-w-xl" aria-busy="true" aria-label={t("detail.loading")}>
      <div className="flex items-center justify-between gap-3 px-1 pt-2 pb-5">
        <Skeleton className="h-9 w-48 rounded-full" />
        <Skeleton className="size-11 rounded-full" />
      </div>
      <Skeleton className="h-40 rounded-3xl" />
      <Skeleton className="mt-3 h-32 rounded-3xl" />
      <Skeleton className="mt-3 h-32 rounded-3xl" />
    </Page>
  );
}

function TantanganPage() {
  const { t } = useTranslation(["challenge", "common"]);
  const { groupId, challengeId } = Route.useParams();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [confirm, setConfirm] = useState<"leave" | "remove" | null>(null);

  const detail = useQuery({
    ...detailOptions(challengeId),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: orpc.challenge.key() });
  };

  const join = useMutation(
    orpc.challenge.join.mutationOptions({
      onSuccess: () => {
        toast.success(t("toast.joined"));
        refresh();
      },
      onError: (error) => toast.error(error.message),
    }),
  );
  const leave = useMutation(
    orpc.challenge.leave.mutationOptions({
      onSuccess: () => {
        toast.success(t("toast.left"));
        setConfirm(null);
        refresh();
      },
      onError: (error) => toast.error(error.message),
    }),
  );
  const remove = useMutation(
    orpc.challenge.remove.mutationOptions({
      onSuccess: () => {
        toast.success(t("toast.removed"));
        queryClient.removeQueries({ queryKey: detailOptions(challengeId).queryKey });
        void queryClient.invalidateQueries({ queryKey: orpc.challenge.list.key() });
        void navigate({ to: "/grup/$groupId", params: { groupId } });
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  const share = detail.data?.share ?? null;
  const story = useMemo<StorySpec | null>(
    () => (share ? { kind: "challenge", share } : null),
    [share],
  );

  if (detail.isPending) return <DetailSkeleton />;
  if (detail.isError) {
    return <ScreenError message={detail.error.message} onRetry={() => void detail.refetch()} />;
  }

  const { challenge, me, canJoin, leaderboard } = detail.data;
  const spec = GOALS[challenge.goal];
  const busy = join.isPending || leave.isPending || remove.isPending;

  return (
    <Page className="max-w-xl">
      <PageHeader
        title={challenge.title}
        subtitle={challenge.groupName}
        action={
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("detail.refresh")}
              disabled={detail.isFetching}
              onClick={refresh}
            >
              <RefreshCw
                className={detail.isFetching ? "size-5 animate-spin" : "size-5"}
                aria-hidden
              />
            </Button>
            <Link
              to="/grup/$groupId"
              params={{ groupId }}
              className="grid size-11 shrink-0 place-items-center rounded-full bg-muted transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
              aria-label={t("detail.backToGroup")}
            >
              <X className="size-5" aria-hidden />
            </Link>
          </div>
        }
      />

      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip challenge={challenge} />
          <span className="text-[0.8125rem] text-muted-foreground tabular-nums">
            {t("detail.dateRange", {
              from: fmtDateShort(challenge.startDate),
              to: fmtDateShort(challenge.endDate),
            })}
            {challenge.status === "active" &&
              `, ${
                challenge.daysLeft === 0
                  ? t("detail.lastDay")
                  : t("detail.daysLeft", { count: challenge.daysLeft })
              }`}
          </span>
        </div>
        <p className="mt-3 text-base font-bold">{challenge.rule}</p>
        {challenge.creatorName && (
          <p className="mt-1 text-[0.8125rem] text-muted-foreground">
            {t("detail.createdBy", { name: challenge.creatorName })}
          </p>
        )}
        {me.joined && spec.targetKind === "personal" && me.target !== null && (
          <p className="mt-3 rounded-2xl bg-muted px-4 py-3 text-sm font-semibold">
            {t("detail.yourTarget", { target: fmtInt(me.target), unit: challenge.unit })}
          </p>
        )}
        {me.deviceHint && (
          <p
            role="note"
            className="mt-3 flex items-start gap-2 rounded-2xl bg-bakar-soft px-4 py-3 text-sm text-bakar-ink"
          >
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
            {me.deviceHint}
          </p>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          {canJoin && (
            <Button className="flex-1" disabled={busy} onClick={() => join.mutate({ challengeId })}>
              {join.isPending ? t("detail.joining") : t("detail.join")}
            </Button>
          )}
          {story && (
            <ShareStoryButton
              story={story}
              label={t("detail.share")}
              className="flex-1"
              variant="secondary"
              disabled={challenge.status === "upcoming"}
            />
          )}
          {me.joined && challenge.status !== "ended" && confirm !== "leave" && (
            <Button variant="ghost" disabled={busy} onClick={() => setConfirm("leave")}>
              <LogOut className="size-4" aria-hidden />
              {t("detail.leave")}
            </Button>
          )}
        </div>

        {confirm === "leave" && (
          <div className="mt-3 rounded-2xl bg-destructive/10 p-4">
            <p className="text-sm font-bold text-destructive">
              {t("detail.confirm.leaveTitle")} {t("detail.confirm.leaveMessage")}
            </p>
            <div className="mt-3 flex gap-2">
              <Button
                variant="destructive"
                size="sm"
                disabled={leave.isPending}
                onClick={() => leave.mutate({ challengeId })}
              >
                {t("detail.confirm.leaveYes")}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirm(null)}>
                {t("common:actions.cancel")}
              </Button>
            </div>
          </div>
        )}

        <details className="group mt-3 text-[0.8125rem] text-muted-foreground">
          <summary className="cursor-pointer font-semibold select-none">
            {t("detail.howItWorks.title")}
          </summary>
          <div className="mt-2 space-y-2 leading-snug">
            <p>{challenge.source}</p>
            <p>{t("detail.howItWorks.basis")}</p>
            {(challenge.goal === "protein" || challenge.goal === "calories") && (
              <p>{t("detail.howItWorks.foodPrivacy")}</p>
            )}
          </div>
        </details>
      </Card>

      <div className="mt-6">
        <SectionTitle>{t("board.title")}</SectionTitle>
        {leaderboard.length === 0 ? (
          <p className="rounded-3xl bg-card px-5 py-6 text-center text-sm text-muted-foreground">
            {t("board.empty.title")}. {t("board.empty.body")}
          </p>
        ) : (
          <>
            <ul className="space-y-2">
              {leaderboard.map((member) => (
                <LeaderboardRow key={member.userId} member={member} unit={challenge.unit} />
              ))}
            </ul>
            <DotLegend />
          </>
        )}
      </div>

      {challenge.canDelete && (
        <div className="mt-6">
          {confirm === "remove" ? (
            <div className="rounded-2xl bg-destructive/10 p-4">
              <p className="text-sm font-bold text-destructive">
                {t("detail.confirm.removeTitle")} {t("detail.confirm.removeMessage")}
              </p>
              <div className="mt-3 flex gap-2">
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate({ challengeId })}
                >
                  {t("detail.confirm.removeYes")}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirm(null)}>
                  {t("common:actions.cancel")}
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant="ghost"
              className="w-full text-destructive"
              disabled={busy}
              onClick={() => setConfirm("remove")}
            >
              <Trash2 className="size-4" aria-hidden />
              {t("detail.remove")}
            </Button>
          )}
        </div>
      )}
    </Page>
  );
}
