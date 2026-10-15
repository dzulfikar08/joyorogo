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
import { fmtInt, fmtKg, timeAgo } from "@/lib/format";
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
  return (
    <Page className="max-w-xl" aria-busy="true" aria-label="Memuat grup">
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
        toast.success(input.kind === "poke" ? "Colek terkirim" : "Catatan terkirim");
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
      if (prev === null) return { message: "Nama grup diganti" };
      return {
        message: "Nama grup diganti",
        undo: () => void client.group.rename({ groupId, name: prev }),
      };
    },
    onError: (error) => toast.error(error.message),
  });

  const rotate = useMutation(
    orpc.group.rotateInvite.mutationOptions({
      onSuccess: ({ inviteCode }) => {
        toast.success(`Kode baru: ${inviteCode}`);
        invalidate();
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  // Optimistic flip of my member row's share flag; undo re-applies the old value.
  const patchShare = (input: { groupId: string; shareFood: boolean } | { groupId: string; shareVar: boolean }, cache: OptimisticCache) => {
    cache.value<GroupDetail>(detailKey, (data) =>
      data
        ? {
            ...data,
            members: data.members.map((m) =>
              m.userId === meId ? { ...m, ...("shareFood" in input ? { shareFood: input.shareFood } : { shareVar: input.shareVar }) } : m,
            ),
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

  const removeMember = useMutation(
    orpc.group.removeMember.mutationOptions({
      onSuccess: (_data, input) => {
        const name = detail.data?.members.find((m) => m.userId === input.userId)?.name;
        toast.success(`${name ?? "Anggota"} dikeluarkan.`);
        invalidate();
      },
      onError: (error) => toast.error(error.message),
    }),
  );

  const leave = useMutation(
    orpc.group.leave.mutationOptions({
      onSuccess: () => {
        toast.success("Kamu keluar dari grup.");
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
        message={detail.error?.message ?? "Grup tidak ditemukan."}
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
        subtitle={`${detail.data.members.length} anggota · kode ${group.inviteCode}`}
        action={
          <Button
            variant="ghost"
            size="icon"
            aria-label="Pengaturan grup"
            onClick={() => setSettingsOpen(true)}
          >
            <Settings2 className="size-5" aria-hidden />
          </Button>
        }
      />

      <ChallengeSection groupId={groupId} />

      <Segmented
        className="mt-1"
        label="Tampilan grup"
        value={tab}
        onChange={setTab}
        options={[
          { value: "anggota", label: "Anggota" },
          { value: "aktivitas", label: "Aktivitas" },
        ]}
      />

      {tab === "anggota" ? (
        <div className="mt-4 space-y-3">
          {members.map((member) => (
            <MemberCard
              key={member.userId}
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
        title="Pengaturan grup"
        description="Undangan, privasi, dan keanggotaan."
      >
        <div className="space-y-5">
          <section>
            <SectionTitle>Undangan</SectionTitle>
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
                      if (result === "copied") toast.success("Tautan disalin");
                    });
                  }}
                >
                  <Share2 className="size-4" aria-hidden />
                  Bagikan
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    void navigator.clipboard
                      .writeText(inviteLink(group.inviteCode))
                      .then(() => toast.success("Tautan disalin"));
                  }}
                >
                  <Copy className="size-4" aria-hidden />
                  Salin
                </Button>
                {isOwner && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={rotate.isPending}
                    onClick={() => rotate.mutate({ groupId })}
                  >
                    <RefreshCw className="size-4" aria-hidden />
                    Putar kode
                  </Button>
                )}
              </div>
            </div>
          </section>

          <section>
            <SectionTitle>Privasiku</SectionTitle>
            <ListGroup className="mt-2">
              <ListRow
                title="Tampilkan makananku"
                subtitle="Total kalori tetap terlihat anggota tim, hanya nama makananmu yang disembunyikan."
                trailing={
                  <Switch
                    checked={me.shareFood}
                    label="Tampilkan makananku"
                    disabled={setShareFood.isPending}
                    onCheckedChange={(shareFood) => setShareFood.mutate({ groupId, shareFood })}
                  />
                }
              />
              <ListRow
                title="Status VAR perut"
                subtitle="Verdict + tanggal scan terakhirmu terlihat di tim ini. Foto perut tidak pernah ikut."
                trailing={
                  <Switch
                    checked={me.shareVar}
                    label="Bagikan status VAR perut"
                    disabled={setShareVar.isPending}
                    onCheckedChange={(shareVar) => setShareVar.mutate({ groupId, shareVar })}
                  />
                }
              />
            </ListGroup>
          </section>

          {isOwner && (
            <section>
              <SectionTitle>Nama grup</SectionTitle>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  rename.mutate({ groupId, name: newName });
                }}
                className="mt-2 flex gap-2"
              >
                <Input
                  aria-label="Nama grup baru"
                  placeholder={group.name}
                  maxLength={40}
                  value={newName}
                  onChange={(event) => setNewName(event.target.value)}
                />
                <Button type="submit" disabled={rename.isPending || newName.trim() === ""}>
                  <Pencil className="size-4" aria-hidden />
                  Ganti
                </Button>
              </form>
            </section>
          )}

          {isOwner && others.length > 0 && (
            <section>
              <SectionTitle>Anggota</SectionTitle>
              <ListGroup className="mt-2">
                {others.map((member) => (
                  <ListRow
                    key={member.userId}
                    icon={<Avatar name={member.name} image={member.image} />}
                    title={member.name}
                    subtitle={member.role === "owner" ? "pemilik" : "anggota"}
                    trailing={
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive"
                        disabled={removeMember.isPending}
                        onClick={() => removeMember.mutate({ groupId, userId: member.userId })}
                      >
                        <UserMinus className="size-4" aria-hidden />
                        Keluarkan
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
                  Keluar dari {group.name}{isOwner ? "? Grup pindah ke anggota lain." : "?"}
                </p>
                <div className="mt-3 flex gap-2">
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={leave.isPending}
                    onClick={() => leave.mutate({ groupId })}
                  >
                    Ya, keluar
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setConfirmLeave(false)}>
                    Batal
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
                Keluar dari grup
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
        title={`Catatan untuk ${noteTarget?.name ?? ""}`}
        description="Maksimal 20 catatan per hari, 140 karakter."
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
            {["Ayo jalan 10 menit!", "Jangan lupa minum air", "Catat sarapannya", "Semangat, hampir sampai!"].map(
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
              aria-label="Isi catatan"
              rows={3}
              maxLength={140}
              placeholder="Tulis catatan semangat…"
              value={noteMessage}
              onChange={(event) => setNoteMessage(event.target.value)}
              className="w-full resize-none rounded-2xl border border-border bg-background px-4 py-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
            />
            <span className="pointer-events-none absolute right-3 bottom-2 text-[0.6875rem] text-muted-foreground">
              {noteMessage.length}/140
            </span>
          </div>
          <Button type="submit" className="w-full" disabled={nudge.isPending || noteMessage.trim() === ""}>
            {nudge.isPending ? "Mengirim…" : "Kirim catatan"}
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
}: {
  groupId: string;
  member: Member;
  isSelf: boolean;
  onPoke: () => void;
  onNote: () => void;
  pokePending: boolean;
}) {
  const { today } = member;
  const delta = today.weightDeltaKg7d;
  const firstName = member.name.split(" ")[0] ?? member.name;
  return (
    <Card className="p-4">
      <div className="flex items-center gap-3">
        <Avatar name={member.name} image={member.image} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[0.9375rem] font-bold">
            {member.name}
            {member.role === "owner" && (
              <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 align-middle text-[0.625rem] font-bold text-primary">
                pemilik
              </span>
            )}
          </p>
          <p className="text-xs text-muted-foreground">
            {member.lastActiveAt
              ? `aktif ${timeAgo(member.lastActiveAt)}`
              : "belum aktif minggu ini"}
          </p>
        </div>
        {member.streakDays > 0 && (
          <span
            className="inline-flex shrink-0 items-center gap-1 rounded-full bg-bakar-soft px-2.5 py-1 text-xs font-bold text-bakar-ink tabular-nums"
            title={`${member.streakDays} hari beruntun`}
          >
            <Flame className="size-3.5" aria-hidden />
            {member.streakDays}
          </span>
        )}
      </div>

      <div className="mt-3">
        {today.eatTargetKcal !== null ? (
          <ProgressBar
            value={today.eatenKcal}
            max={today.eatTargetKcal}
            ariaLabel={`Makan ${fmtInt(today.eatenKcal)} dari ${fmtInt(today.eatTargetKcal)} kcal`}
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
            {fmtInt(today.burnedKcal)} dibakar
          </span>
          <span>{today.mealsLogged}x catat makan</span>
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

      {/* Shared VAR perut status: verdict + date only, never a photo. */}
      {member.varStatus && (
        <Link
          to="/grup/$groupId/var/$userId"
          params={{ groupId, userId: member.userId }}
          className="mt-3 flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1.5 text-xs font-bold text-primary transition-colors hover:bg-primary/15 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
        >
          <Tv className="size-3.5 shrink-0" aria-hidden />
          VAR perut {isSelf ? "kamu" : firstName} · {member.varStatus.verdict === "turun"
            ? "mengecil"
            : member.varStatus.verdict === "naik"
              ? "lebih penuh"
              : member.varStatus.verdict === "sama"
                ? "belum beda"
                : member.varStatus.verdict === "beda"
                  ? "foto beda"
                  : "scan pertama"}{" "}
          · {varChipDate(member.varStatus.date)}
        </Link>
      )}

      <div className="mt-3 flex gap-2">
        {isSelf ? (
          <Link
            to="/grup/$groupId/var/saya"
            params={{ groupId }}
            className={cn(CARD_ACTION, "bg-primary text-primary-foreground")}
          >
            <Tv className="size-4" aria-hidden />
            Scan VAR perut
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
              Colek
            </button>
            <button
              type="button"
              onClick={onNote}
              className={cn(CARD_ACTION, "bg-muted hover:bg-accent")}
            >
              <PenLine className="size-4" aria-hidden />
              Catatan
            </button>
            <Link
              to="/grup/$groupId/var/$userId"
              params={{ groupId, userId: member.userId }}
              className={cn(CARD_ACTION, "bg-primary text-primary-foreground")}
            >
              <Tv className="size-4" aria-hidden />
              VAR
            </Link>
          </>
        )}
      </div>
    </Card>
  );
}

/** "12 Okt" untuk chip tanggal status VAR. */
function varChipDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
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
  if (status === "pending") {
    return (
      <div className="mt-4 space-y-3" aria-busy="true" aria-label="Memuat aktivitas">
        <Skeleton className="h-16 rounded-3xl" />
        <Skeleton className="h-16 rounded-3xl" />
        <Skeleton className="h-16 rounded-3xl" />
      </div>
    );
  }
  if (status === "error") {
    return (
      <div className="mt-4">
        <EmptyHint title="Aktivitas gagal dimuat">{error?.message}</EmptyHint>
        <Button variant="secondary" className="mt-3 w-full" onClick={onRetry}>
          Coba lagi
        </Button>
      </div>
    );
  }
  const feed = events ?? [];
  if (feed.length === 0) {
    return (
      <div className="mt-4">
        <EmptyHint title="Belum ada aktivitas">
          Catat makan, olahraga, atau timbangan — aktivitas 7 hari terakhir muncul di sini.
        </EmptyHint>
      </div>
    );
  }
  return (
    <ul className="mt-4 space-y-2" aria-label="Aktivitas 7 hari terakhir">
      {feed.map((event, index) => (
        <li key={`${event.at instanceof Date ? event.at.getTime() : String(event.at)}-${index}`}>
          {event.type === "food" && (
            <ActivityRow
              icon={<Utensils className="size-4" aria-hidden />}
              who={event.userName}
              what={
                event.name
                  ? `${event.name} (${fmtInt(event.kcal ?? 0)} kcal)`
                  : `makan (${fmtInt(event.kcal ?? 0)} kcal)`
              }
              at={event.at}
            />
          )}
          {event.type === "exercise" && (
            <ActivityRow
              icon={<Dumbbell className="size-4" aria-hidden />}
              who={event.userName}
              what={`${event.name ?? "olahraga"}${event.minutes ? ` ${event.minutes} menit` : ""} (${fmtInt(event.kcal ?? 0)} kcal)`}
              at={event.at}
            />
          )}
          {event.type === "weight" && (
            <ActivityRow
              icon={<Scale className="size-4" aria-hidden />}
              who={event.userName}
              what={`timbangan: ${fmtKg(event.kg)} kg`}
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
  return (
    <div className="flex items-center gap-3 rounded-3xl bg-card px-4 py-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-muted" aria-hidden>
        {icon}
      </span>
      <p className="min-w-0 flex-1 text-sm">
        <span className="font-bold">{who ?? "Seseorang"}</span>{" "}
        <span className="text-muted-foreground">{what}</span>
      </p>
      <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(at)}</span>
    </div>
  );
}
