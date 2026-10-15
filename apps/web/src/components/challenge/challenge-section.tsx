import { Button } from "@joyorogo/ui/components/button";
import { Skeleton } from "@joyorogo/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Flame, Plus, Trophy, Users } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { StatusChip } from "@/components/challenge/challenge-parts";
import { CreateChallengeSheet } from "@/components/challenge/create-challenge-sheet";
import { ErrorNote } from "@/components/kit/error-note";
import { SectionTitle } from "@/components/kit/surface";
import type { ChallengeSummary } from "@/lib/api-types";
import { orpc } from "@/utils/orpc";

/** Compact "Tantangan" block of the group screen: the group's challenges plus the host entry point. */
export function ChallengeSection({ groupId }: { groupId: string }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [createOpen, setCreateOpen] = useState(false);

  const list = useQuery({
    ...orpc.challenge.list.queryOptions({ input: { groupId } }),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  const join = useMutation(
    orpc.challenge.join.mutationOptions({
      onSuccess: () => {
        toast.success("Kamu ikut tantangan ini");
        void queryClient.invalidateQueries({ queryKey: orpc.challenge.key() });
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  const openPaywall = () => {
    setCreateOpen(false);
    void navigate({ to: "/founder", search: { from: "challenge", next: `/grup/${groupId}` } });
  };

  if (list.isPending) return <Skeleton className="mt-1 mb-4 h-28 rounded-3xl" />;
  if (list.isError) {
    return (
      <div className="mt-1 mb-4">
        <ErrorNote message={list.error.message} onRetry={() => void list.refetch()} />
      </div>
    );
  }

  const { canHost, maxOpen, challenges } = list.data;
  const openCount = challenges.filter((c) => c.status !== "ended").length;
  const full = canHost && openCount >= maxOpen;

  return (
    <section className="mt-1 mb-5" aria-label="Tantangan grup">
      <SectionTitle
        action={
          <Button
            size="sm"
            variant="secondary"
            disabled={full}
            onClick={() => (canHost ? setCreateOpen(true) : openPaywall())}
          >
            <Plus className="size-4" aria-hidden />
            Buat tantangan
          </Button>
        }
      >
        Tantangan
      </SectionTitle>

      {challenges.length === 0 ? (
        <div className="rounded-3xl bg-card px-5 py-5 text-center">
          <Trophy className="mx-auto size-6 text-muted-foreground" aria-hidden />
          <p className="mt-2 text-[0.9375rem] font-bold">Belum ada tantangan</p>
          <p className="mx-auto mt-1 max-w-xs text-sm leading-relaxed text-muted-foreground">
            Ajak tim adu langkah, protein, atau latihan. Founder yang membuat tantangan, semua
            anggota ikut gratis.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {challenges.map((challenge) => (
            <ChallengeCard
              key={challenge.id}
              challenge={challenge}
              groupId={groupId}
              joining={join.isPending && join.variables?.challengeId === challenge.id}
              onJoin={() => join.mutate({ challengeId: challenge.id })}
            />
          ))}
        </div>
      )}

      {full && (
        <p className="mt-2 px-1 text-xs text-muted-foreground">
          Maksimal {maxOpen} tantangan berjalan per grup. Tunggu salah satunya selesai.
        </p>
      )}

      <CreateChallengeSheet
        groupId={groupId}
        open={createOpen}
        onOpenChange={setCreateOpen}
        onPaywall={openPaywall}
      />
    </section>
  );
}

function ChallengeCard({
  challenge,
  groupId,
  joining,
  onJoin,
}: {
  challenge: ChallengeSummary;
  groupId: string;
  joining: boolean;
  onJoin: () => void;
}) {
  const canJoin = !challenge.joined && challenge.status !== "ended";
  return (
    <div className="rounded-3xl bg-card p-4">
      <Link
        to="/grup/$groupId/tantangan/$challengeId"
        params={{ groupId, challengeId: challenge.id }}
        className="pressable block rounded-2xl focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
      >
        <div className="flex items-start justify-between gap-3">
          <h3 className="line-clamp-2 min-w-0 text-[0.9375rem] leading-snug font-bold">
            {challenge.title}
          </h3>
          <StatusChip challenge={challenge} />
        </div>
        <p className="mt-1 text-[0.8125rem] text-muted-foreground">
          {challenge.goalLabel} · {challenge.rule}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.8125rem] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Users className="size-4" aria-hidden />
            {challenge.participants} peserta
          </span>
          {challenge.joined && challenge.status !== "upcoming" && (
            <span className="font-semibold text-foreground tabular-nums">
              {challenge.judgedDays === 0
                ? "Hari pertamamu berjalan"
                : `${challenge.hitDays} dari ${challenge.judgedDays} hari`}
            </span>
          )}
          {challenge.joined && challenge.status === "upcoming" && (
            <span className="font-semibold text-foreground">Kamu ikut</span>
          )}
          {challenge.joined && challenge.streak > 0 && (
            <span className="inline-flex items-center gap-1 font-semibold text-foreground tabular-nums">
              <Flame className="size-4 text-bakar" aria-hidden />
              {challenge.streak} hari beruntun
            </span>
          )}
        </div>
      </Link>
      {canJoin && (
        <Button size="sm" className="mt-3 w-full" disabled={joining} onClick={onJoin}>
          {joining ? "Bergabung..." : "Gabung"}
        </Button>
      )}
    </div>
  );
}
