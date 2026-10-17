import "@/unistyles";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Redirect, Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Share, Switch, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { MEAL_LABELS } from "@joyorogo/api/lib/engine";
import type { Meal } from "@joyorogo/api/lib/engine";

import {
  Avatar,
  Button,
  Card,
  Chip,
  ErrorState,
  Field,
  Input,
  ListGroup,
  ListRow,
  MacroBar,
  Num,
  PageHeader,
  Screen,
  SectionTitle,
  Segmented,
  Sheet,
  Skeleton,
  Text,
} from "@/components/ui";
import { authClient } from "@/lib/auth-client";
import { useSessionGate } from "@/lib/use-session-gate";
import { ConfirmSheet } from "@/components/confirm-sheet";
import { ChallengesSection } from "@/components/challenge/challenges-section";
import { useToast } from "@/components/toast";
import type { GroupActivityEvent, GroupMember } from "@/src/lib/group";
import { inviteMessage, timeAgoId } from "@/src/lib/group";
import { errorMessage, fmtInt, fmtKg } from "@/utils/format";
import { client, orpc, queryClient } from "@/utils/orpc";
import { useOptimisticMutation } from "@/lib/optimistic";

const NOTE_SUGGESTIONS = [
  "Ayo jalan 10 menit!",
  "Jangan lupa minum air",
  "Jangan lupa sarapan",
  "Semangat catat kalorinya!",
];

function activityRow(event: GroupActivityEvent): { icon: "restaurant" | "fitness" | "scale"; title: string; subtitle: string } {
  const who = event.userName ?? "Teman";
  if (event.type === "food") {
    const meal = MEAL_LABELS[event.meal as Meal] ?? "Makan";
    return {
      icon: "restaurant",
      title: who,
      subtitle: `${meal} • ${fmtInt(event.kcal)} kcal${event.name === null ? " (disembunyikan)" : ` • ${event.name}`}`,
    };
  }
  if (event.type === "exercise") {
    return {
      icon: "fitness",
      title: who,
      subtitle: `${event.name ?? "Olahraga"} • ${event.minutes ?? "?"} mnt • ${fmtInt(event.kcal)} kcal`,
    };
  }
  return { icon: "scale", title: who, subtitle: `Timbang • ${fmtKg(event.kg)} kg` };
}

function MemberCard({
  member,
  isMe,
  isOwner,
  onPoke,
  onNote,
  onVar,
  onRemove,
}: {
  member: GroupMember;
  isMe: boolean;
  isOwner: boolean;
  onPoke: () => void;
  onNote: () => void;
  onVar: () => void;
  onRemove: () => void;
}) {
  const { theme } = useUnistyles();
  const today = member.today;
  const lastActive = member.lastActiveAt ? `aktif ${timeAgoId(member.lastActiveAt)}` : "belum aktif";
  const delta = today.weightDeltaKg7d;

  return (
    <Card>
      <View style={styles.memberHead}>
        <Avatar name={member.name} image={member.image ?? null} size={44} />
        <View style={styles.memberName}>
          <Text style={styles.memberTitle}>
            {member.name}
            {isMe ? " (kamu)" : ""}
          </Text>
          <Text style={styles.memberSub}>
            {member.role === "owner" ? "Pemilik • " : ""}
            {lastActive}
          </Text>
        </View>
        {member.streakDays > 0 ? (
          <View style={[styles.streak, { backgroundColor: theme.colors.bakarSoft }]}>
            <Ionicons name="flame" size={12} color={theme.colors.bakarText} />
            <Num style={[styles.streakText, { color: theme.colors.bakarText }]}>
              {member.streakDays}
            </Num>
          </View>
        ) : null}
      </View>

      <MacroBar
        label="Asupan hari ini"
        eaten={today.eatenKcal}
        budget={today.eatTargetKcal}
        unit="kcal"
      />

      <Text style={styles.memberStats}>
        Bakar {fmtInt(today.burnedKcal)} kcal • {today.mealsLogged} makan
        {today.exerciseMinutes !== null ? ` • ${today.exerciseMinutes} mnt olahraga` : ""}
        {today.weightKg !== null ? ` • ${fmtKg(today.weightKg)} kg` : ""}
        {today.weightKg !== null && delta !== null
          ? ` (${delta <= 0 ? "−" : "+"}${fmtKg(Math.abs(delta))}/7hr)`
          : ""}
      </Text>

      {member.varStatus ? (
        <View style={styles.varChip}>
          <Ionicons name="tv" size={12} color={theme.colors.primary} />
          <Text style={[styles.varChipText, { color: theme.colors.primary }]} numberOfLines={1}>
            VAR perut {isMe ? "kamu" : (member.name.split(" ")[0] ?? "")}:{" "}
            {bellyChipLabel(member.varStatus.verdict)} • {chipDate(member.varStatus.date)}
          </Text>
        </View>
      ) : null}

      {!isMe ? (
        <View style={styles.memberActions}>
          <Button size="sm" variant="secondary" icon="hand-left" label="Colek" onPress={onPoke} />
          <Button size="sm" variant="secondary" icon="pencil" label="Catatan" onPress={onNote} />
          <Button size="sm" icon="tv" label="VAR" onPress={onVar} />
          {isOwner ? (
            <Button size="sm" variant="ghost" destructive label="Keluarkan" onPress={onRemove} />
          ) : null}
        </View>
      ) : (
        <View style={styles.memberActions}>
          <Button size="sm" icon="tv" label="Scan VAR perut" onPress={onVar} />
        </View>
      )}
    </Card>
  );
}

/** Salinan label chip VAR perut (mirror lib/varscan.ts untuk klien). */
function bellyChipLabel(verdict: NonNullable<GroupMember["varStatus"]>["verdict"]): string {
  switch (verdict) {
    case "turun":
      return "mengecil";
    case "naik":
      return "lebih penuh";
    case "sama":
      return "belum beda";
    case "beda":
      return "foto beda";
    case "pertama":
      return "scan pertama";
  }
}

/** "12 Okt" untuk chip status VAR. */
function chipDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

export default function GroupDetail() {
  const { theme } = useUnistyles();
  const gate = useSessionGate();
  const router = useRouter();
  const { data: session } = authClient.useSession();
  const { id } = useLocalSearchParams<{ id: string }>();
  const groupId = Array.isArray(id) ? (id[0] ?? "") : (id ?? "");

  const detail = useQuery(orpc.group.detail.queryOptions({ input: { groupId } }));
  const activityQuery = useQuery(orpc.group.activity.queryOptions({ input: { groupId, limit: 30 } }));

  const [tab, setTab] = useState<"anggota" | "aktivitas" | "tantangan">("anggota");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [noteTarget, setNoteTarget] = useState<GroupMember | null>(null);
  const [noteText, setNoteText] = useState("");
  const [confirm, setConfirm] = useState<
    { kind: "leave" } | { kind: "remove"; member: GroupMember } | null
  >(null);
  const toast = useToast();

  const invalidate = () => queryClient.invalidateQueries({ queryKey: orpc.group.key() });

  const nudge = useMutation(
    orpc.group.nudge.mutationOptions({
      onSuccess: invalidate,
      onError: (e) => toast.error("Gagal mengirim", errorMessage(e)),
    }),
  );
  type DetailRow = NonNullable<typeof detail.data>;

  const setShareFood = useOptimisticMutation<
    { groupId: string; shareFood: boolean },
    unknown,
    boolean | undefined
  >({
    mutationFn: (input) => client.group.setShareFood(input),
    patch: (input, cache) => {
      const key = orpc.group.detail.queryOptions({ input: { groupId } }).queryKey;
      const previous = (queryClient.getQueryData<DetailRow>(key)?.members ?? []).find(
        (m) => m.userId === session?.user.id,
      )?.shareFood;
      cache.value<DetailRow>(key, (old) =>
        old === undefined
          ? undefined
          : {
              ...old,
              members: old.members.map((m) =>
                m.userId === session?.user.id ? { ...m, shareFood: input.shareFood } : m,
              ),
            },
      );
      return previous;
    },
    success: (_input, _data, previous) => ({
      message: "Pengaturan grup disimpan",
      undo: previous === undefined ? undefined : () => setShareFood.mutate({ groupId, shareFood: previous }),
    }),
    onError: (e) => toast.error("Gagal mengubah bagikan", errorMessage(e)),
    invalidate: () => [orpc.group.key()],
  });
  const setShareVar = useOptimisticMutation<
    { groupId: string; shareVar: boolean },
    unknown,
    boolean | undefined
  >({
    mutationFn: (input) => client.group.varSetShare(input),
    patch: (input, cache) => {
      const key = orpc.group.detail.queryOptions({ input: { groupId } }).queryKey;
      const previous = (queryClient.getQueryData<DetailRow>(key)?.members ?? []).find(
        (m) => m.userId === session?.user.id,
      )?.shareVar;
      cache.value<DetailRow>(key, (old) =>
        old === undefined
          ? undefined
          : {
              ...old,
              members: old.members.map((m) =>
                m.userId === session?.user.id ? { ...m, shareVar: input.shareVar } : m,
              ),
            },
      );
      return previous;
    },
    success: (_input, _data, previous) => ({
      message: "Pengaturan grup disimpan",
      undo: previous === undefined ? undefined : () => setShareVar.mutate({ groupId, shareVar: previous }),
    }),
    onError: (e) => toast.error("Gagal mengubah bagikan", errorMessage(e)),
    invalidate: () => [orpc.group.key()],
  });
  const rename = useOptimisticMutation<
    { groupId: string; name: string },
    unknown,
    string | undefined
  >({
    mutationFn: (input) => client.group.rename(input),
    patch: (input, cache) => {
      const key = orpc.group.detail.queryOptions({ input: { groupId } }).queryKey;
      const previous = queryClient.getQueryData<DetailRow>(key)?.group.name;
      cache.value<DetailRow>(key, (old) =>
        old === undefined ? undefined : { ...old, group: { ...old.group, name: input.name } },
      );
      return previous;
    },
    success: (_input, _data, previous) => {
      setRenameOpen(false);
      return {
        message: "Nama grup diganti",
        undo:
          previous === undefined ? undefined : () => rename.mutate({ groupId, name: previous }),
      };
    },
    onError: (e) => toast.error("Gagal mengubah nama", errorMessage(e)),
    invalidate: () => [orpc.group.key()],
  });
  const rotateInvite = useMutation(
    orpc.group.rotateInvite.mutationOptions({
      onSuccess: invalidate,
      onError: (e) => toast.error("Gagal ganti kode", errorMessage(e)),
    }),
  );
  const removeMember = useMutation(
    orpc.group.removeMember.mutationOptions({
      onSuccess: async () => {
        setConfirm(null);
        await invalidate();
      },
      onError: (e) => toast.error("Gagal mengeluarkan", errorMessage(e)),
    }),
  );
  const leave = useMutation(
    orpc.group.leave.mutationOptions({
      onSuccess: async () => {
        await invalidate();
        router.replace("/grup");
      },
      onError: (e) => toast.error("Gagal keluar", errorMessage(e)),
    }),
  );

  if (gate === "loading") {
    return (
      <Screen>
        <PageHeader title="Grup" />
        <Skeleton width="100%" height={180} radius={24} />
        <Skeleton width="100%" height={140} radius={24} />
      </Screen>
    );
  }
  if (gate === "anon") {
    return <Redirect href="/login" />;
  }

  if (detail.isPending) {
    return (
      <Screen>
        <PageHeader title="Grup" />
        <Skeleton width="100%" height={180} radius={24} />
        <Skeleton width="100%" height={140} radius={24} />
      </Screen>
    );
  }
  if (detail.isError) {
    return (
      <Screen>
        <PageHeader title="Grup" />
        <ErrorState message={errorMessage(detail.error)} onRetry={() => detail.refetch()} />
      </Screen>
    );
  }

  const { group, members } = detail.data;
  const me = members.find((m) => m.userId === session?.user.id) ?? null;
  const isOwner = me?.role === "owner";

  const shareInvite = () => {
    void Share.share({ message: inviteMessage(group.name, group.inviteCode) });
  };

  const poke = (member: GroupMember) => {
    nudge.mutate({ groupId, toUserId: member.userId, kind: "poke" });
  };

  const openNote = (member: GroupMember) => {
    setNoteText("");
    setNoteTarget(member);
  };

  const sendNote = () => {
    if (!noteTarget) return;
    nudge.mutate(
      { groupId, toUserId: noteTarget.userId, kind: "note", message: noteText.trim() },
      {
        onSuccess: () => {
          setNoteTarget(null);
          toast.success("Catatan terkirim", `Catatan untuk ${noteTarget.name} sudah dikirim.`);
        },
      },
    );
  };

  const confirmLeave = () => setConfirm({ kind: "leave" });

  const confirmRemove = (member: GroupMember) => setConfirm({ kind: "remove", member });

  // Sorted by activity: most recently active first, never-active last.
  const sortedMembers = [...members].sort(
    (a, b) =>
      new Date(b.lastActiveAt ?? 0).getTime() - new Date(a.lastActiveAt ?? 0).getTime(),
  );

  return (
    <>
      <Stack.Screen options={{ title: group.name }} />
      <Screen>
        <PageHeader
          title={group.name}
          caption={`${members.length} anggota • kode ${group.inviteCode}`}
          right={
            <View style={styles.headActions}>
              <Button size="sm" variant="secondary" icon="share-social" label="Undang" onPress={shareInvite} />
              <Button
                size="sm"
                variant="secondary"
                icon="settings-outline"
                label="Setelan"
                onPress={() => setSettingsOpen(true)}
              />
            </View>
          }
        />

        <Segmented
          options={[
            { value: "anggota", label: "Anggota" },
            { value: "aktivitas", label: "Aktivitas" },
            { value: "tantangan", label: "Tantangan" },
          ]}
          value={tab}
          onChange={setTab}
        />

        {tab === "anggota" ? (
          <View style={styles.stack}>
            {sortedMembers.map((member) => {
              const isMe = member.userId === session?.user.id;
              return (
                <MemberCard
                  key={member.userId}
                  member={member}
                  isMe={isMe}
                  isOwner={isOwner && member.role !== "owner"}
                  onPoke={() => poke(member)}
                  onNote={() => openNote(member)}
                  onVar={() =>
                    isMe
                      ? router.push({
                          pathname: "/grup/[id]/var-saya",
                          params: { id: groupId },
                        })
                      : router.push({
                          pathname: "/grup/[id]/var",
                          params: {
                            id: groupId,
                            userId: member.userId,
                            name: member.name,
                            shareFood: member.shareFood ? "1" : "0",
                          },
                        })
                  }
                  onRemove={() => confirmRemove(member)}
                />
              );
            })}
          </View>
        ) : tab === "aktivitas" ? (
          <View style={styles.stack}>
            <SectionTitle title="Aktivitas 7 hari terakhir" />
            {activityQuery.isPending ? (
              <Skeleton width="100%" height={220} radius={24} />
            ) : activityQuery.isError ? (
              <ErrorState
                message={errorMessage(activityQuery.error)}
                onRetry={() => activityQuery.refetch()}
              />
            ) : (activityQuery.data ?? []).length === 0 ? (
              <Text style={styles.emptyLine}>
                Belum ada aktivitas. Waktunya logging makan pertama!
              </Text>
            ) : (
              <ListGroup>
                {activityQuery.data.map((event, index) => {
                  const row = activityRow(event);
                  return (
                    <ListRow
                      key={`${event.userId}-${event.at instanceof Date ? event.at.getTime() : String(event.at)}-${index}`}
                      icon={row.icon}
                      iconTint={event.type === "food" ? "makan" : event.type === "exercise" ? "bakar" : "tidur"}
                      title={row.title}
                      subtitle={row.subtitle}
                      value={timeAgoId(event.at)}
                    />
                  );
                })}
              </ListGroup>
            )}
          </View>
        ) : (
          <ChallengesSection groupId={groupId} />
        )}

        {/* Settings sheet: invite, owner tools, privacy, leave. */}
        <Sheet visible={settingsOpen} onClose={() => setSettingsOpen(false)} title="Setelan Grup">
          <ListGroup>
            <ListRow
              icon="share-social"
              iconTint="makan"
              title="Bagikan undangan"
              subtitle={`Kode ${group.inviteCode}`}
              chevron
              onPress={() => {
                setSettingsOpen(false);
                shareInvite();
              }}
            />
            {isOwner ? (
              <ListRow
                icon="refresh"
                iconTint="makan"
                title="Ganti kode undangan"
                subtitle={rotateInvite.isPending ? "Mengganti…" : "Kode lama tidak berlaku"}
                onPress={() => rotateInvite.mutate({ groupId })}
              />
            ) : null}
            {isOwner ? (
              <ListRow
                icon="pencil"
                iconTint="makan"
                title="Ubah nama grup"
                chevron
                onPress={() => {
                  setNewName(group.name);
                  setSettingsOpen(false);
                  setRenameOpen(true);
                }}
              />
            ) : null}
            <ListRow
              icon="eye"
              iconTint="tidur"
              title="Tampilkan makananku ke grup"
              subtitle="Total kalorimu tetap terlihat apapun pilihanmu"
              right={
                <Switch
                  value={me?.shareFood ?? false}
                  disabled={setShareFood.isPending}
                  onValueChange={(value) => setShareFood.mutate({ groupId, shareFood: value })}
                />
              }
            />
            <ListRow
              icon="tv"
              iconTint="bakar"
              title="Status VAR perut"
              subtitle="Verdict + tanggal scan terakhirmu terlihat di grup ini. Foto perut tidak pernah ikut."
              right={
                <Switch
                  value={me?.shareVar ?? false}
                  disabled={setShareVar.isPending}
                  onValueChange={(value) => setShareVar.mutate({ groupId, shareVar: value })}
                />
              }
            />
            <ListRow
              icon="log-out-outline"
              iconTint="muted"
              title="Keluar dari grup"
              destructive
              onPress={confirmLeave}
            />
          </ListGroup>
        </Sheet>

        <ConfirmSheet
          visible={confirm !== null}
          onClose={() => setConfirm(null)}
          title={confirm?.kind === "remove" ? "Keluarkan anggota?" : "Keluar dari grup?"}
          message={
            confirm?.kind === "remove"
              ? `${confirm.member.name} tidak bisa lihat grup ini lagi.`
              : `${group.name} akan hilang dari daftar grupmu.`
          }
          confirmLabel={confirm?.kind === "remove" ? "Keluarkan" : "Keluar"}
          loading={removeMember.isPending || leave.isPending}
          onConfirm={() => {
            if (confirm?.kind === "remove") {
              removeMember.mutate({ groupId, userId: confirm.member.userId });
            } else if (confirm?.kind === "leave") {
              setConfirm(null);
              leave.mutate({ groupId });
            }
          }}
        />

        <Sheet
          visible={renameOpen}
          onClose={() => setRenameOpen(false)}
          title="Ubah Nama Grup"
          footer={
            <Button
              label="Simpan"
              disabled={newName.trim().length === 0}
              loading={rename.isPending}
              onPress={() => rename.mutate({ groupId, name: newName.trim() })}
            />
          }
        >
          <Field label="Nama grup">
            <Input value={newName} onChangeText={setNewName} maxLength={40} />
          </Field>
        </Sheet>

        <Sheet
          visible={noteTarget !== null}
          onClose={() => setNoteTarget(null)}
          title={noteTarget ? `Catatan untuk ${noteTarget.name}` : "Catatan"}
          footer={
            <Button
              label={`Kirim (${noteText.trim().length}/140)`}
              disabled={noteText.trim().length === 0 || noteText.trim().length > 140}
              loading={nudge.isPending}
              onPress={sendNote}
            />
          }
        >
          <View style={styles.chips}>
            {NOTE_SUGGESTIONS.map((suggestion) => (
              <Chip
                key={suggestion}
                label={suggestion}
                onPress={() => setNoteText(suggestion)}
                selected={noteText === suggestion}
              />
            ))}
          </View>
          <Field label="Pesan" hint="Maksimal 140 huruf, dikirim lewat notifikasi.">
            <Input
              value={noteText}
              onChangeText={setNoteText}
              maxLength={140}
              multiline
              placeholder="mis. Ayo jalan 10 menit!"
            />
          </Field>
        </Sheet>
      </Screen>
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  headActions: {
    flexDirection: "row",
    gap: theme.spacing.sm,
  },
  stack: {
    gap: theme.spacing.md,
    marginTop: theme.spacing.md,
  },
  memberHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    marginBottom: theme.spacing.md,
  },
  memberName: {
    flex: 1,
    gap: 2,
  },
  memberTitle: {
    fontSize: theme.fontSize.md,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  memberSub: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.mutedForeground,
  },
  streak: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 4,
    borderRadius: theme.radius.pill,
  },
  streakText: {
    fontSize: theme.fontSize.xs,
    fontWeight: "700",
  },
  memberStats: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.mutedForeground,
    marginTop: theme.spacing.sm,
  },
  memberActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing.sm,
    marginTop: theme.spacing.md,
  },
  varChip: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 6,
    marginTop: theme.spacing.md,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 6,
    borderRadius: theme.radius.pill,
    backgroundColor: "rgba(46, 125, 70, 0.12)",
  },
  varChipText: {
    fontSize: theme.fontSize.xs,
    fontWeight: "700",
  },
  emptyLine: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.md,
  },
}));
