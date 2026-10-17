import { Button } from "@joyorogo/ui/components/button";
import { Input } from "@joyorogo/ui/components/input";
import { Sheet } from "@joyorogo/ui/components/sheet";
import { Skeleton } from "@joyorogo/ui/components/skeleton";
import { cn } from "@joyorogo/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  Copy,
  Dumbbell,
  Flame,
  Hand,
  LogOut,
  Pencil,
  PenLine,
  RefreshCw,
  Scale,
  Settings2,
  Share2,
  TrendingDown,
  TrendingUp,
  Tv,
  UserMinus,
  Utensils,
} from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { ChallengeSection } from "@/components/challenge/challenge-section";
import { ProgressBar } from "@/components/progress-bar";
import { Avatar } from "@/components/avatar";
import { EmptyHint, ScreenError } from "@/components/screen-state";
import {
  Card,
  ListGroup,
  ListRow,
  Page,
  PageHeader,
  SectionTitle,
  Segmented,
} from "@/components/kit/surface";
import { Switch } from "@/components/kit/switch";
import { inviteLink, shareInvite } from "@/lib/group-invite";
import { useSession } from "@/lib/auth-client";
import type { GroupActivityEvent, GroupDetail, GroupMember } from "@/lib/api-types";
import type { AppRouterClient } from "@joyorogo/api/routers/index";

import { OptimisticCache, useOptimisticMutation } from "@/lib/optimistic";
import { fmtDateShort, fmtInt, fmtKg, timeAgo } from "@/lib/format";
import { client, orpc } from "@/utils/orpc";

const detailOptions = (groupId: string) => orpc.group.detail.queryOptions({ input: { groupId } });
const activityOptions = (groupId: string) =>
  orpc.group.activity.queryOptions({ input: { groupId, limit: 30 } });

export const Route = createFileRoute("/_auth/grup/$groupId")({
  loader: ({ context, params }) => {
    void context.queryClient.ensureQueryData(detailOptions(params.groupId));
    return context.queryClient.ensureQueryData(activityOptions(params.groupId));
  },
  pendingComponent: DetailSkeleton,
  component: GrupDetailPage,
});

type Member = GroupMember;

function DetailSkeleton() {
  const { t } = useTranslation("grup");
  return (
    <Page className="max-w-xl" aria-busy="true" aria-label={t("list.loading")}>
      <div className="flex items-center justify-between gap-3 px-1 pt-2 pb-5">
        <Skeleton className="h-9 w-40 rounded-full" />
        <Skeleton className="size-11 rounded-full" />
      </div>
      <Skeleton className="h-11 w-48 rounded-full" />
      <Skeleton className="mt-4 h-44 rounded-3xl" />
      <Skeleton className="mt-3 h-44 rounded-3xl" />
    </Page>
  );
}

function GrupDetailPage() {
  const { t } = useTranslation(["grup", "common"]);
  const { groupId } = Route.useParams();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const session = useSession();
  const meId = session.data?.user.id;
  const detail = useQuery(detailOptions(groupId));
  const activity = useQuery(activityOptions(groupId));
  const [tab, setTab] = useState<"anggota" | "aktivitas">("anggota");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [noteTarget, setNoteTarget] = useState<Member | null>(null);
  const [noteMessage, setNoteMessage] = useState("");
  const [newName, setNewName] = useState("");
  const [confirmLeave, setConfirmLeave] = useState(false);

  const group = detail.data?.group;
  const me = detail.data?.members.find((m) => m.userId === meId);
  const isOwner = me?.role === "owner";

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: orpc.group.key() });
  };

  const nudge = useMutation(
    orpc.group.nudge.mutationOptions({
      onSuccess: (_data, input) => {
        toast.success(input.kind === "poke" ? t("toast.poked") : t("toast.noteSent"));
        if (input.kind === "note") {
          setNoteTarget(null);
          setNoteMessage("");
        }
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  const detailKey = detailOptions(groupId).queryKey;
  // Optimistic detail.name patch; undo restores the previous name.
  const previousName = useRef<string | null>(null);
  const rename = useOptimisticMutation<
    Parameters<AppRouterClient["group"]["rename"]>[0],
    unknown
  >({
    mutationFn: (input) => client.group.rename(input),
    patch: (input, cache) => {
      const old = queryClient.getQueryData<GroupDetail>(detailKey);
      previousName.current = old?.group.name ?? null;
      cache.value<GroupDetail>(detailKey, (data) =>
        data ? { ...data, group: { ...data.group, name: input.name } } : data,
      );
    },
    invalidate: () => [orpc.group.key()],
    success: () => {
      setNewName("");
      const prev = previousName.current;
      previousName.current = null;
      if (prev === null) return { message: t("toast.renamed") };
      return {
        message: t("toast.renamed"),
        undo: () => void client.group.rename({ groupId, name: prev }),
      };
    },
    onError: (error) => toast.error(error.message),
  });

  const rotate = useMutation(
    orpc.group.rotateInvite.mutationOptions({
      onSuccess: ({ inviteCode }) => {
        toast.success(t("toast.newCode", { code: inviteCode }));
        invalidate();
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  // Optimistic flip of my member row's share flag; undo re-applies the old value.
  const patchShare = (
    input:
      | { groupId: string; shareFood: boolean }
      | { groupId: string; shareVar: boolean }
      | { groupId: string; shareFitness: boolean },
    cache: OptimisticCache,
  ) => {
    const { groupId: _groupId, ...flag } = input;
    cache.value<GroupDetail>(detailKey, (data) =>
      data
        ? {
            ...data,
            members: data.members.map((m) => (m.userId === meId ? { ...m, ...flag } : m)),
          }
        : data,
    );
  };
  const setShareFood = useOptimisticMutation<
    Parameters<AppRouterClient["group"]["setShareFood"]>[0],
    unknown
  >({
    mutationFn: (input) => client.group.setShareFood(input),
    patch: (input, cache) => patchShare(input, cache),
    invalidate: () => [orpc.group.key()],
  });
  const setShareVar = useOptimisticMutation<
    Parameters<AppRouterClient["group"]["varSetShare"]>[0],
    unknown
  >({
    mutationFn: (input) => client.group.varSetShare(input),
    patch: (input, cache) => patchShare(input, cache),
    invalidate: () => [orpc.group.key()],
  });
  const setShareFitness = useOptimisticMutation<
    Parameters<AppRouterClient["group"]["setShareFitness"]>[0],
    unknown
  >({
    mutationFn: (input) => client.group.setShareFitness(input),
    patch: (input, cache) => patchShare(input, cache),
    invalidate: () => [orpc.group.key()],
  });

  const removeMember = useMutation(
    orpc.group.removeMember.mutationOptions({
      onSuccess: (_data, input) => {
        const name = detail.data?.members.find((m) => m.userId === input.userId)?.name;
        toast.success(t("toast.removed", { name: name ?? t("toast.memberFallback") }));
        invalidate();
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  const leave = useMutation(
    orpc.group.leave.mutationOptions({
      onSuccess: () => {
        toast.success(t("toast.left"));
        invalidate();
        void navigate({ to: "/grup" });
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  if (detail.isPending) return <DetailSkeleton />;
  if (detail.isError || !group || !me) {
    return (
      <ScreenError
        message={detail.error?.message ?? t("detail.notFound")}
        onRetry={() => void detail.refetch()}
      />
    );
  }

  const members = [...detail.data.members].sort((a, b) => {
    if (a.lastActiveAt && b.lastActiveAt) {
      const diff = new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime();
      if (diff !== 0) return diff;
    }
    if (a.lastActiveAt) return -1;
    if (b.lastActiveAt) return 1;
    return 0;
  });
  const others = detail.data.members.filter((m) => m.userId !== meId);

  return (
    <Page className="max-w-xl">
      <PageHeader
        title={group.name}
        subtitle={t("detail.subtitle", { count: detail.data.members.length, code: group.inviteCode })}
        action={
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("settings.title")}
            onClick={() => setSettingsOpen(true)}
          >
            <Settings2 className="size-5" aria-hidden />
          </Button>
        }
      />

      <ChallengeSection groupId={groupId} />

      <Segmented
        className="mt-1"
        label={t("detail.viewLabel")}
        value={tab}
        onChange={setTab}
        options={[
          { value: "anggota", label: t("detail.tab.members") },
          { value: "aktivitas", label: t("detail.tab.activity") },
        ]}
      />

      {tab === "anggota" ? (
        <div className="mt-3 space-y-2">
          {members.map((member, index) => (
            <MemberCard
              key={member.userId}
              index={index}
              groupId={groupId}
              member={member}
              isSelf={member.userId === meId}
              onPoke={() => nudge.mutate({ groupId, toUserId: member.userId, kind: "poke" })}
              onNote={() => {
                setNoteTarget(member);
                setNoteMessage("");
              }}
              pokePending={nudge.isPending && nudge.variables?.toUserId === member.userId}
            />
          ))}
        </div>
      ) : (
        <ActivityFeed
          status={activity.status}
          error={activity.error}
          events={activity.data}
          onRetry={() => void activity.refetch()}
        />
      )}

      {/* Pengaturan grup */}
      <Sheet
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        title={t("settings.title")}
        description={t("settings.hint")}
      >
        <div className="space-y-5">
          <section>
            <SectionTitle>{t("settings.invite.title")}</SectionTitle>
            <div className="mt-2 rounded-2xl bg-muted p-4">
              <p className="text-sm font-bold">{group.name}</p>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                joyorogo.com/gabung/{group.inviteCode}
              </p>
              <div className="mt-3 flex gap-2">
                <Button
                  size="sm"
                  onClick={() => {
                    void shareInvite(group.name, group.inviteCode).then((result) => {
                      if (result === "copied") toast.success(t("toast.linkCopied"));
                    });
                  }}
                >
                  <Share2 className="size-4" aria-hidden />
                  {t("settings.invite.share")}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    void navigator.clipboard
                      .writeText(inviteLink(group.inviteCode))
                      .then(() => toast.success(t("toast.linkCopied")));
                  }}
                >
                  <Copy className="size-4" aria-hidden />
                  {t("settings.invite.copy")}
                </Button>
                {isOwner && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={rotate.isPending}
                    onClick={() => rotate.mutate({ groupId })}
                  >
                    <RefreshCw className="size-4" aria-hidden />
                    {t("settings.invite.rotate")}
                  </Button>
                )}
              </div>
            </div>
          </section>

          <section>
            <SectionTitle>{t("settings.privacy.title")}</SectionTitle>
            <ListGroup className="mt-2">
              <ListRow
                title={t("settings.privacy.food.title")}
                subtitle={t("settings.privacy.food.hint")}
                trailing={
                  <Switch
                    checked={me.shareFood}
                    label={t("settings.privacy.food.title")}
                    disabled={setShareFood.isPending}
                    onCheckedChange={(shareFood) => setShareFood.mutate({ groupId, shareFood })}
                  />
                }
              />
              <ListRow
                title={t("settings.privacy.var.title")}
                subtitle={t("settings.privacy.var.hint")}
                trailing={
                  <Switch
                    checked={me.shareVar}
                    label={t("settings.privacy.var.label")}
                    disabled={setShareVar.isPending}
                    onCheckedChange={(shareVar) => setShareVar.mutate({ groupId, shareVar })}
                  />
                }
              />
              <ListRow
                title={t("fitness.share.title")}
                subtitle={t("fitness.share.hint")}
                trailing={
                  <Switch
                    checked={me.shareFitness}
                    label={t("fitness.share.label")}
                    disabled={setShareFitness.isPending}
                    onCheckedChange={(shareFitness) => setShareFitness.mutate({ groupId, shareFitness })}
                  />
                }
              />
            </ListGroup>
          </section>

          {isOwner && (
            <section>
              <SectionTitle>{t("settings.name.title")}</SectionTitle>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  rename.mutate({ groupId, name: newName });
                }}
                className="mt-2 flex gap-2"
              >
                <Input
                  aria-label={t("settings.name.label")}
                  placeholder={group.name}
                  maxLength={40}
                  value={newName}
                  onChange={(event) => setNewName(event.target.value)}
                />
                <Button type="submit" disabled={rename.isPending || newName.trim() === ""}>
                  <Pencil className="size-4" aria-hidden />
                  {t("settings.name.submit")}
                </Button>
              </form>
            </section>
          )}

          {isOwner && others.length > 0 && (
            <section>
              <SectionTitle>{t("settings.members.title")}</SectionTitle>
              <ListGroup className="mt-2">
                {others.map((member) => (
                  <ListRow
                    key={member.userId}
                    icon={<Avatar name={member.name} image={member.image} />}
                    title={member.name}
                    subtitle={member.role === "owner" ? t("member.owner") : t("member.member")}
                    trailing={
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive"
                        disabled={removeMember.isPending}
                        onClick={() => removeMember.mutate({ groupId, userId: member.userId })}
                      >
                        <UserMinus className="size-4" aria-hidden />
                        {t("settings.members.remove")}
                      </Button>
                    }
                  />
                ))}
              </ListGroup>
            </section>
          )}

          <section>
            {confirmLeave ? (
              <div className="rounded-2xl bg-destructive/10 p-4">
                <p className="text-sm font-bold text-destructive">
                  {isOwner ? t("settings.leave.confirmOwner", { name: group.name }) : t("settings.leave.confirm", { name: group.name })}
                </p>
                <div className="mt-3 flex gap-2">
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={leave.isPending}
                    onClick={() => leave.mutate({ groupId })}
                  >
                    {t("settings.leave.yes")}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setConfirmLeave(false)}>
                    {t("common:actions.cancel")}
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                variant="ghost"
                className="w-full text-destructive"
                onClick={() => setConfirmLeave(true)}
              >
                <LogOut className="size-4" aria-hidden />
                {t("settings.leave.button")}
              </Button>
            )}
          </section>
        </div>
      </Sheet>

      {/* Catatan untuk satu anggota */}
      <Sheet
        open={noteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setNoteTarget(null);
        }}
        title={t("note.title", { name: noteTarget?.name ?? "" })}
        description={t("note.hint")}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!noteTarget) return;
            nudge.mutate({
              groupId,
              toUserId: noteTarget.userId,
              kind: "note",
              message: noteMessage,
            });
          }}
          className="space-y-3"
        >
          <div className="flex flex-wrap gap-2">
            {(["s1", "s2", "s3", "s4"] as const).map((key) => t(`note.suggestion.${key}`)).map(
              (suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => setNoteMessage(suggestion)}
                  className="rounded-full bg-muted px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
                >
                  {suggestion}
                </button>
              ),
            )}
          </div>
          <div className="relative">
            <textarea
              aria-label={t("note.label")}
              rows={3}
              maxLength={140}
              placeholder={t("note.placeholder")}
              value={noteMessage}
              onChange={(event) => setNoteMessage(event.target.value)}
              className="w-full resize-none rounded-2xl border border-border bg-background px-4 py-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
            />
            <span className="pointer-events-none absolute right-3 bottom-2 text-[0.6875rem] text-muted-foreground">
              {noteMessage.length}/140
            </span>
          </div>
          <Button type="submit" className="w-full" disabled={nudge.isPending || noteMessage.trim() === ""}>
            {nudge.isPending ? t("note.sending") : t("note.send")}
          </Button>
        </form>
      </Sheet>
    </Page>
  );
}

const CARD_ACTION =
  "pressable inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-full px-3 text-[0.8125rem] font-bold transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none";

function MemberCard({
  groupId,
  member,
  isSelf,
  onPoke,
  onNote,
  pokePending,
  index,
}: {
  groupId: string;
  member: Member;
  isSelf: boolean;
  onPoke: () => void;
  onNote: () => void;
  pokePending: boolean;
  index: number;
}) {
  const { t } = useTranslation("grup");
  const { today } = member;
  const delta = today.weightDeltaKg7d;
  const firstName = member.name.split(" ")[0] ?? member.name;
  return (
    <Card className="post-enter p-3" style={{ "--post-index": index } as React.CSSProperties}>
      <div className="flex items-center gap-3">
        <Avatar name={member.name} image={member.image} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[0.9375rem] font-bold">
            {member.name}
            {member.role === "owner" && (
              <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 align-middle text-[0.625rem] font-bold text-primary">
                {t("member.owner")}
              </span>
            )}
          </p>
          <p className="text-xs text-muted-foreground">
            {member.lastActiveAt
              ? t("member.active", { time: timeAgo(member.lastActiveAt) })
              : t("member.inactive")}
          </p>
        </div>
        {member.streakDays > 0 && (
          <span
            className="inline-flex shrink-0 items-center gap-1 rounded-full bg-bakar-soft px-2.5 py-1 text-xs font-bold text-bakar-ink tabular-nums"
            title={t("member.streak", { count: member.streakDays })}
          >
            <Flame className="size-3.5" aria-hidden />
            {member.streakDays}
          </span>
        )}
      </div>

      <div className="mt-2">
        {today.eatTargetKcal !== null ? (
          <ProgressBar
            value={today.eatenKcal}
            max={today.eatTargetKcal}
            ariaLabel={t("member.eatenLabel", { eaten: fmtInt(today.eatenKcal), target: fmtInt(today.eatTargetKcal) })}
          />
        ) : (
          <div className="h-2 w-full rounded-full bg-muted" />
        )}
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">
            {fmtInt(today.eatenKcal)}
            {today.eatTargetKcal !== null && ` / ${fmtInt(today.eatTargetKcal)}`} kcal
          </span>
          <span className="inline-flex items-center gap-1">
            <Flame className="size-3.5" aria-hidden />
            {t("member.burned", { kcal: fmtInt(today.burnedKcal) })}
          </span>
          <span>{t("member.meals", { count: today.mealsLogged })}</span>
          {today.weightKg !== null && (
            <span>
              {fmtKg(today.weightKg)} kg
              {delta !== null && delta !== 0 && (
                <span
                  className={cn(
                    "ml-1 inline-flex items-center gap-0.5 align-middle font-bold",
                    delta < 0 ? "text-primary" : "text-amber-600 dark:text-amber-400",
                  )}
                >
                  {delta < 0 ? (
                    <TrendingDown className="size-3.5" aria-hidden />
                  ) : (
                    <TrendingUp className="size-3.5" aria-hidden />
                  )}
                  {fmtKg(Math.abs(delta))}
                </span>
              )}
            </span>
          )}
        </div>
      </div>

      {/* Skor JoyoFit yang dibagikan anggota: chip ringkas. */}
      {today.fitness && (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {[
            today.fitness.recoveryPct !== null &&
              t("fitness.recovery", { pct: fmtInt(today.fitness.recoveryPct) }),
            today.fitness.strain !== null && t("fitness.strain", { n: today.fitness.strain.toFixed(1) }),
            today.fitness.sleepPct !== null && t("fitness.sleep", { pct: fmtInt(today.fitness.sleepPct) }),
            today.fitness.readiness && t(`fitness.readiness.${today.fitness.readiness}`),
          ]
            .filter((chip): chip is string => typeof chip === "string")
            .map((chip) => (
              <li key={chip} className="rounded-full bg-muted px-2.5 py-1 text-xs font-bold tabular-nums">
                {chip}
              </li>
            ))}
        </ul>
      )}

      {/* Shared VAR perut status: verdict + date only, never a photo. */}
      {member.varStatus && (
        <Link
          to="/grup/$groupId/var/$userId"
          params={{ groupId, userId: member.userId }}
          className="mt-2 flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-bold text-primary transition-colors hover:bg-primary/15 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
        >
          <Tv className="size-3.5 shrink-0" aria-hidden />
          {t(isSelf ? "var.chip.self" : "var.chip.other", {
            name: firstName,
            verdict: t(`var.verdict.${member.varStatus.verdict}`),
            date: fmtDateShort(member.varStatus.date),
          })}
        </Link>
      )}

      <div className="mt-2 flex gap-2">
        {isSelf ? (
          <Link
            to="/grup/$groupId/var/saya"
            params={{ groupId }}
            className={cn(CARD_ACTION, "bg-primary text-primary-foreground")}
          >
            <Tv className="size-4" aria-hidden />
            {t("member.scanVar")}
          </Link>
        ) : (
          <>
            <button
              type="button"
              onClick={onPoke}
              disabled={pokePending}
              className={cn(CARD_ACTION, "bg-muted hover:bg-accent")}
            >
              <Hand className="size-4" aria-hidden />
              {t("member.poke")}
            </button>
            <button
              type="button"
              onClick={onNote}
              className={cn(CARD_ACTION, "bg-muted hover:bg-accent")}
            >
              <PenLine className="size-4" aria-hidden />
              {t("member.note")}
            </button>
            <Link
              to="/grup/$groupId/var/$userId"
              params={{ groupId, userId: member.userId }}
              className={cn(CARD_ACTION, "bg-primary text-primary-foreground")}
            >
              <Tv className="size-4" aria-hidden />
              {t("member.var")}
            </Link>
          </>
        )}
      </div>
    </Card>
  );
}


function ActivityFeed({
  status,
  error,
  events,
  onRetry,
}: {
  status: "pending" | "error" | "success";
  error: Error | null;
  events: GroupActivityEvent[] | undefined;
  onRetry: () => void;
}) {
  const { t } = useTranslation(["grup", "common"]);
  if (status === "pending") {
    return (
      <div className="mt-4 space-y-3" aria-busy="true" aria-label={t("activity.loading")}>
        <Skeleton className="h-16 rounded-3xl" />
        <Skeleton className="h-16 rounded-3xl" />
        <Skeleton className="h-16 rounded-3xl" />
      </div>
    );
  }
  if (status === "error") {
    return (
      <div className="mt-4">
        <EmptyHint title={t("activity.errorTitle")}>{error?.message}</EmptyHint>
        <Button variant="secondary" className="mt-3 w-full" onClick={onRetry}>
          {t("common:actions.retry")}
        </Button>
      </div>
    );
  }
  const feed = events ?? [];
  if (feed.length === 0) {
    return (
      <div className="mt-4">
        <EmptyHint title={t("activity.empty.title")}>
          {t("activity.empty.body")}
        </EmptyHint>
      </div>
    );
  }
  return (
    <ul className="mt-4 space-y-2" aria-label={t("activity.listLabel")}>
      {feed.map((event, index) => (
        <li
          key={`${event.at instanceof Date ? event.at.getTime() : String(event.at)}-${index}`}
          className="post-enter"
          style={{ "--post-index": index } as React.CSSProperties}
        >
          {event.type === "food" && (
            <ActivityRow
              icon={<Utensils className="size-4" aria-hidden />}
              who={event.userName}
              what={
                event.name
                  ? t("activity.food.named", { name: event.name, kcal: fmtInt(event.kcal ?? 0) })
                  : t("activity.food.plain", { kcal: fmtInt(event.kcal ?? 0) })
              }
              at={event.at}
            />
          )}
          {event.type === "exercise" && (
            <ActivityRow
              icon={<Dumbbell className="size-4" aria-hidden />}
              who={event.userName}
              what={
                event.minutes
                  ? t("activity.exercise.timed", { name: event.name ?? t("activity.exercise.fallback"), minutes: event.minutes, kcal: fmtInt(event.kcal ?? 0) })
                  : t("activity.exercise.plain", { name: event.name ?? t("activity.exercise.fallback"), kcal: fmtInt(event.kcal ?? 0) })
              }
              at={event.at}
            />
          )}
          {event.type === "weight" && (
            <ActivityRow
              icon={<Scale className="size-4" aria-hidden />}
              who={event.userName}
              what={t("activity.weight", { kg: fmtKg(event.kg) })}
              at={event.at}
            />
          )}
        </li>
      ))}
    </ul>
  );
}

function ActivityRow({
  icon,
  who,
  what,
  at,
}: {
  icon: React.ReactNode;
  who: string | null;
  what: string;
  at: Date | string;
}) {
  const { t } = useTranslation("grup");
  return (
    <div className="flex items-center gap-3 rounded-3xl bg-card px-4 py-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-muted" aria-hidden>
        {icon}
      </span>
      <p className="min-w-0 flex-1 text-sm">
        <span className="font-bold">{who ?? t("activity.someone")}</span>{" "}
        <span className="text-muted-foreground">{what}</span>
      </p>
      <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(at)}</span>
    </div>
  );
}
