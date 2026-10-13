import "@/unistyles";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Redirect, Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Alert, Share, Switch, View } from "react-native";
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
import type { GroupActivityEvent, GroupMember } from "@/src/lib/group";
import { inviteLink, timeAgoId } from "@/src/lib/group";
import { errorMessage, fmtKcal, fmtKg } from "@/utils/format";
import { orpc, queryClient } from "@/utils/orpc";

const NOTE_SUGGESTIONS = [
  "Ayo jalan 10 menit! 🚶",
  "Jangan lupa minum air 💧",
  "Jangan lupa sarapan 🍳",
  "Semangat catat kalorinya! 💪",
];

function activityRow(event: GroupActivityEvent): { icon: "restaurant" | "fitness" | "scale"; title: string; subtitle: string } {
  const who = event.userName ?? "Teman";
  if (event.type === "food") {
    const meal = MEAL_LABELS[event.meal as Meal] ?? "Makan";
    return {
      icon: "restaurant",
      title: who,
      subtitle: `${meal} • ${fmtKcal(event.kcal)} kcal${event.name === null ? " (disembunyikan)" : ` • ${event.name}`}`,
    };
  }
  if (event.type === "exercise") {
    return {
      icon: "fitness",
      title: who,
      subtitle: `${event.name ?? "Olahraga"} • ${event.minutes ?? "?"} mnt • ${fmtKcal(event.kcal)} kcal`,
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
        <Avatar name={member.name} size={44} />
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
            <Text style={[styles.streakText, { color: theme.colors.bakarText }]}>
              🔥 {member.streakDays}
            </Text>
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
        🔥 bakar {fmtKcal(today.burnedKcal)} kcal • 🍽️ {today.mealsLogged} makan
        {today.exerciseMinutes !== null ? ` • 🏃 ${today.exerciseMinutes} mnt` : ""}
        {today.weightKg !== null ? ` • ⚖️ ${fmtKg(today.weightKg)} kg` : ""}
        {today.weightKg !== null && delta !== null
          ? ` (${delta <= 0 ? "−" : "+"}${fmtKg(Math.abs(delta))}/7hr)`
          : ""}
      </Text>

      {!isMe ? (
        <View style={styles.memberActions}>
          <Button size="sm" variant="secondary" label="Colek 👉" onPress={onPoke} />
          <Button size="sm" variant="secondary" label="Catatan ✍️" onPress={onNote} />
          <Button size="sm" label="VAR 📺" onPress={onVar} />
          {isOwner ? (
            <Button size="sm" variant="ghost" destructive label="Keluarkan" onPress={onRemove} />
          ) : null}
        </View>
      ) : null}
    </Card>
  );
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

  const [tab, setTab] = useState<"anggota" | "aktivitas">("anggota");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [noteTarget, setNoteTarget] = useState<GroupMember | null>(null);
  const [noteText, setNoteText] = useState("");

  const invalidate = () => queryClient.invalidateQueries({ queryKey: orpc.group.key() });

  const nudge = useMutation(
    orpc.group.nudge.mutationOptions({
      onSuccess: invalidate,
      onError: (e) => Alert.alert("Gagal mengirim", errorMessage(e)),
    }),
  );
  const setShareFood = useMutation(orpc.group.setShareFood.mutationOptions({ onSuccess: invalidate }));
  const rename = useMutation(
    orpc.group.rename.mutationOptions({
      onSuccess: async () => {
        setRenameOpen(false);
        await invalidate();
      },
      onError: (e) => Alert.alert("Gagal mengubah nama", errorMessage(e)),
    }),
  );
  const rotateInvite = useMutation(
    orpc.group.rotateInvite.mutationOptions({
      onSuccess: invalidate,
      onError: (e) => Alert.alert("Gagal ganti kode", errorMessage(e)),
    }),
  );
  const removeMember = useMutation(
    orpc.group.removeMember.mutationOptions({
      onSuccess: invalidate,
      onError: (e) => Alert.alert("Gagal mengeluarkan", errorMessage(e)),
    }),
  );
  const leave = useMutation(
    orpc.group.leave.mutationOptions({
      onSuccess: async () => {
        await invalidate();
        router.replace("/grup");
      },
      onError: (e) => Alert.alert("Gagal keluar", errorMessage(e)),
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
    void Share.share({
      message: `Ayo gabung grup ${group.name} di JoyoRogo! 🌾\nKode: ${group.inviteCode}\n${inviteLink(group.inviteCode)}`,
    });
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
          Alert.alert("Terkirim ✍️", `Catatan untuk ${noteTarget.name} sudah dikirim.`);
        },
      },
    );
  };

  const confirmLeave = () => {
    Alert.alert("Keluar dari grup?", `${group.name} akan hilang dari daftar grupmu.`, [
      { text: "Batal", style: "cancel" },
      { text: "Keluar", style: "destructive", onPress: () => leave.mutate({ groupId }) },
    ]);
  };

  const confirmRemove = (member: GroupMember) => {
    Alert.alert("Keluarkan anggota?", `${member.name} tidak bisa lihat grup ini lagi.`, [
      { text: "Batal", style: "cancel" },
      {
        text: "Keluarkan",
        style: "destructive",
        onPress: () => removeMember.mutate({ groupId, userId: member.userId }),
      },
    ]);
  };

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
          ]}
          value={tab}
          onChange={setTab}
        />

        {tab === "anggota" ? (
          <View style={styles.stack}>
            {sortedMembers.map((member) => (
              <MemberCard
                key={member.userId}
                member={member}
                isMe={member.userId === session?.user.id}
                isOwner={isOwner && member.role !== "owner"}
                onPoke={() => poke(member)}
                onNote={() => openNote(member)}
                onVar={() =>
                  router.push({
                    pathname: "/grup/[id]/var",
                    params: { id: groupId, userId: member.userId, name: member.name },
                  })
                }
                onRemove={() => confirmRemove(member)}
              />
            ))}
          </View>
        ) : (
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
                Belum ada aktivitas. Waktunya logging makan pertama! 🍽️
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
              icon="log-out-outline"
              iconTint="muted"
              title="Keluar dari grup"
              destructive
              onPress={confirmLeave}
            />
          </ListGroup>
        </Sheet>

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
