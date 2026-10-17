import "@/unistyles";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Redirect, Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Share, Switch, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { MEAL_LABELS } from "@joyorogo/api/lib/engine";
import type { Meal } from "@joyorogo/api/lib/engine";
import type { TFunction } from "@joyorogo/i18n";

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
import { errorMessage, fmtDateShort, fmtInt, fmtKg } from "@/utils/format";
import { client, orpc, queryClient } from "@/utils/orpc";
import { useOptimisticMutation } from "@/lib/optimistic";

const NOTE_SUGGESTION_KEYS = ["s1", "s2", "s3", "s4"] as const;

function activityRow(
  event: GroupActivityEvent,
  t: TFunction<"grup">,
): { icon: "restaurant" | "fitness" | "scale"; title: string; subtitle: string } {
  const who = event.userName ?? t("activity.someone");
  if (event.type === "food") {
    const meal = MEAL_LABELS[event.meal as Meal] ?? t("activity.mealFallback");
    return {
      icon: "restaurant",
      title: who,
      subtitle: `${meal} • ${fmtInt(event.kcal)} kcal${event.name === null ? ` (${t("activity.hidden")})` : ` • ${event.name}`}`,
    };
  }
  if (event.type === "exercise") {
    return {
      icon: "fitness",
      title: who,
      subtitle: t("activity.exerciseLine", {
        name: event.name ?? t("activity.exerciseFallback"),
        minutes: event.minutes ?? "?",
        kcal: fmtInt(event.kcal),
      }),
    };
  }
  return { icon: "scale", title: who, subtitle: t("activity.weightLine", { kg: fmtKg(event.kg) }) };
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
  const { t } = useTranslation("grup");
  const today = member.today;
  const lastActive = member.lastActiveAt ? t("member.active", { time: timeAgoId(member.lastActiveAt) }) : t("member.inactiveShort");
  const delta = today.weightDeltaKg7d;
  const fitness = today.fitness;
  const fitnessChips = fitness
    ? [
        fitness.recoveryPct !== null ? t("fitness.recovery", { pct: fmtInt(fitness.recoveryPct) }) : null,
        fitness.strain !== null ? t("fitness.strain", { n: fitness.strain.toFixed(1) }) : null,
        fitness.sleepPct !== null ? t("fitness.sleep", { pct: fmtInt(fitness.sleepPct) }) : null,
        fitness.readiness !== null ? t(`fitness.readiness.${fitness.readiness}`) : null,
      ].filter((label) => label !== null)
    : [];

  return (
    <Card>
      <View style={styles.memberHead}>
        <Avatar name={member.name} image={member.image ?? null} size={44} />
        <View style={styles.memberName}>
          <Text style={styles.memberTitle}>
            {member.name}
            {isMe ? ` (${t("member.you")})` : ""}
          </Text>
          <Text style={styles.memberSub}>
            {member.role === "owner" ? `${t("member.ownerCap")} • ` : ""}
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
        label={t("member.intake")}
        eaten={today.eatenKcal}
        budget={today.eatTargetKcal}
        unit="kcal"
      />

      <Text style={styles.memberStats}>
        {[
          t("member.statBurn", { kcal: fmtInt(today.burnedKcal) }),
          t("member.statMeals", { count: today.mealsLogged }),
          today.exerciseMinutes !== null ? t("member.statExercise", { minutes: today.exerciseMinutes }) : null,
          today.weightKg !== null
            ? `${fmtKg(today.weightKg)} kg${
                delta !== null
                  ? ` ${t("member.statDelta", { value: `${delta <= 0 ? "−" : "+"}${fmtKg(Math.abs(delta))}` })}`
                  : ""
              }`
            : null,
        ]
          .filter((part) => part !== null)
          .join(" • ")}
      </Text>

      {fitnessChips.length > 0 ? (
        <View style={styles.fitnessRow}>
          {fitnessChips.map((label) => (
            <View key={label} style={styles.fitnessChip}>
              <Ionicons name="pulse" size={12} color={theme.colors.mutedForeground} />
              <Text style={styles.fitnessChipText}>{label}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {member.varStatus ? (
        <View style={styles.varChip}>
          <Ionicons name="tv" size={12} color={theme.colors.primary} />
          <Text style={[styles.varChipText, { color: theme.colors.primary }]} numberOfLines={1}>
            {t(isMe ? "var.chip.self" : "var.chip.other", {
              name: member.name.split(" ")[0] ?? "",
              verdict: t(`var.verdict.${member.varStatus.verdict}`),
              date: fmtDateShort(member.varStatus.date),
            })}
          </Text>
        </View>
      ) : null}

      {!isMe ? (
        <View style={styles.memberActions}>
          <Button size="sm" variant="secondary" icon="hand-left" label={t("member.poke")} onPress={onPoke} />
          <Button size="sm" variant="secondary" icon="pencil" label={t("member.note")} onPress={onNote} />
          <Button size="sm" icon="tv" label={t("member.var")} onPress={onVar} />
          {isOwner ? (
            <Button size="sm" variant="ghost" destructive label={t("settings.members.remove")} onPress={onRemove} />
          ) : null}
        </View>
      ) : (
        <View style={styles.memberActions}>
          <Button size="sm" icon="tv" label={t("member.scanVar")} onPress={onVar} />
        </View>
      )}
    </Card>
  );
}


export default function GroupDetail() {
  const { t } = useTranslation(["grup", "common"]);
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
      onError: (e) => toast.error(t("toast.sendFailed"), errorMessage(e)),
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
      message: t("toast.settingsSaved"),
      undo: previous === undefined ? undefined : () => setShareFood.mutate({ groupId, shareFood: previous }),
    }),
    onError: (e) => toast.error(t("toast.shareFailed"), errorMessage(e)),
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
      message: t("toast.settingsSaved"),
      undo: previous === undefined ? undefined : () => setShareVar.mutate({ groupId, shareVar: previous }),
    }),
    onError: (e) => toast.error(t("toast.shareFailed"), errorMessage(e)),
    invalidate: () => [orpc.group.key()],
  });
  const setShareFitness = useOptimisticMutation<
    { groupId: string; shareFitness: boolean },
    unknown,
    boolean | undefined
  >({
    mutationFn: (input) => client.group.setShareFitness(input),
    patch: (input, cache) => {
      const key = orpc.group.detail.queryOptions({ input: { groupId } }).queryKey;
      const previous = (queryClient.getQueryData<DetailRow>(key)?.members ?? []).find(
        (m) => m.userId === session?.user.id,
      )?.shareFitness;
      cache.value<DetailRow>(key, (old) =>
        old === undefined
          ? undefined
          : {
              ...old,
              members: old.members.map((m) =>
                m.userId === session?.user.id ? { ...m, shareFitness: input.shareFitness } : m,
              ),
            },
      );
      return previous;
    },
    success: (_input, _data, previous) => ({
      message: t("toast.settingsSaved"),
      undo: previous === undefined ? undefined : () => setShareFitness.mutate({ groupId, shareFitness: previous }),
    }),
    onError: (e) => toast.error(t("toast.shareFailed"), errorMessage(e)),
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
        message: t("toast.renamed"),
        undo:
          previous === undefined ? undefined : () => rename.mutate({ groupId, name: previous }),
      };
    },
    onError: (e) => toast.error(t("toast.renameFailed"), errorMessage(e)),
    invalidate: () => [orpc.group.key()],
  });
  const rotateInvite = useMutation(
    orpc.group.rotateInvite.mutationOptions({
      onSuccess: invalidate,
      onError: (e) => toast.error(t("toast.rotateFailed"), errorMessage(e)),
    }),
  );
  const removeMember = useMutation(
    orpc.group.removeMember.mutationOptions({
      onSuccess: async () => {
        setConfirm(null);
        await invalidate();
      },
      onError: (e) => toast.error(t("toast.removeFailed"), errorMessage(e)),
    }),
  );
  const leave = useMutation(
    orpc.group.leave.mutationOptions({
      onSuccess: async () => {
        await invalidate();
        router.replace("/grup");
      },
      onError: (e) => toast.error(t("toast.leaveFailed"), errorMessage(e)),
    }),
  );

  if (gate === "loading") {
    return (
      <Screen>
        <PageHeader title={t("list.title")} />
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
        <PageHeader title={t("list.title")} />
        <Skeleton width="100%" height={180} radius={24} />
        <Skeleton width="100%" height={140} radius={24} />
      </Screen>
    );
  }
  if (detail.isError) {
    return (
      <Screen>
        <PageHeader title={t("list.title")} />
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
          toast.success(t("toast.noteSent"), t("toast.noteSentBody", { name: noteTarget.name }));
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
          caption={t("detail.subtitle", { count: members.length, code: group.inviteCode })}
          right={
            <View style={styles.headActions}>
              <Button size="sm" variant="secondary" icon="share-social" label={t("detail.invite")} onPress={shareInvite} />
              <Button
                size="sm"
                variant="secondary"
                icon="settings-outline"
                label={t("detail.settings")}
                onPress={() => setSettingsOpen(true)}
              />
            </View>
          }
        />

        <Segmented
          options={[
            { value: "anggota", label: t("detail.tab.members") },
            { value: "aktivitas", label: t("detail.tab.activity") },
            { value: "tantangan", label: t("detail.tab.challenges") },
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
            <SectionTitle title={t("activity.listLabel")} />
            {activityQuery.isPending ? (
              <Skeleton width="100%" height={220} radius={24} />
            ) : activityQuery.isError ? (
              <ErrorState
                message={errorMessage(activityQuery.error)}
                onRetry={() => activityQuery.refetch()}
              />
            ) : (activityQuery.data ?? []).length === 0 ? (
              <Text style={styles.emptyLine}>
                {t("activity.emptyNative")}
              </Text>
            ) : (
              <ListGroup>
                {activityQuery.data.map((event, index) => {
                  const row = activityRow(event, t);
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
        <Sheet visible={settingsOpen} onClose={() => setSettingsOpen(false)} title={t("settings.title")}>
          <ListGroup>
            <ListRow
              icon="share-social"
              iconTint="makan"
              title={t("settings.shareInvite")}
              subtitle={t("settings.codeLine", { code: group.inviteCode })}
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
                title={t("settings.rotate")}
                subtitle={rotateInvite.isPending ? t("settings.rotating") : t("settings.rotateHint")}
                onPress={() => rotateInvite.mutate({ groupId })}
              />
            ) : null}
            {isOwner ? (
              <ListRow
                icon="pencil"
                iconTint="makan"
                title={t("settings.rename")}
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
              title={t("settings.privacy.food.titleNative")}
              subtitle={t("settings.privacy.food.hintNative")}
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
              title={t("settings.privacy.var.title")}
              subtitle={t("settings.privacy.var.hint")}
              right={
                <Switch
                  value={me?.shareVar ?? false}
                  disabled={setShareVar.isPending}
                  onValueChange={(value) => setShareVar.mutate({ groupId, shareVar: value })}
                />
              }
            />
            <ListRow
              icon="pulse"
              iconTint="tidur"
              title={t("fitness.share.title")}
              subtitle={t("fitness.share.hint")}
              right={
                <Switch
                  value={me?.shareFitness ?? false}
                  disabled={setShareFitness.isPending}
                  onValueChange={(value) => setShareFitness.mutate({ groupId, shareFitness: value })}
                  accessibilityLabel={t("fitness.share.label")}
                />
              }
            />
            <ListRow
              icon="log-out-outline"
              iconTint="muted"
              title={t("settings.leave.button")}
              destructive
              onPress={confirmLeave}
            />
          </ListGroup>
        </Sheet>

        <ConfirmSheet
          visible={confirm !== null}
          onClose={() => setConfirm(null)}
          title={confirm?.kind === "remove" ? t("confirm.removeTitle") : t("confirm.leaveTitle")}
          message={
            confirm?.kind === "remove"
              ? t("confirm.removeBody", { name: confirm.member.name })
              : t("confirm.leaveBody", { name: group.name })
          }
          confirmLabel={confirm?.kind === "remove" ? t("settings.members.remove") : t("confirm.leaveConfirm")}
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
          title={t("settings.rename")}
          footer={
            <Button
              label={t("common:actions.save")}
              disabled={newName.trim().length === 0}
              loading={rename.isPending}
              onPress={() => rename.mutate({ groupId, name: newName.trim() })}
            />
          }
        >
          <Field label={t("create.nameLabel")}>
            <Input value={newName} onChangeText={setNewName} maxLength={40} />
          </Field>
        </Sheet>

        <Sheet
          visible={noteTarget !== null}
          onClose={() => setNoteTarget(null)}
          title={noteTarget ? t("note.title", { name: noteTarget.name }) : t("member.note")}
          footer={
            <Button
              label={t("note.sendCount", { count: noteText.trim().length })}
              disabled={noteText.trim().length === 0 || noteText.trim().length > 140}
              loading={nudge.isPending}
              onPress={sendNote}
            />
          }
        >
          <View style={styles.chips}>
            {NOTE_SUGGESTION_KEYS.map((key) => t(`note.suggestion.${key}`)).map((suggestion) => (
              <Chip
                key={suggestion}
                label={suggestion}
                onPress={() => setNoteText(suggestion)}
                selected={noteText === suggestion}
              />
            ))}
          </View>
          <Field label={t("note.messageLabel")} hint={t("note.hintNative")}>
            <Input
              value={noteText}
              onChangeText={setNoteText}
              maxLength={140}
              multiline
              placeholder={t("note.placeholderNative")}
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
    marginBottom: theme.spacing.sm,
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
  fitnessRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing.sm,
    marginTop: theme.spacing.md,
  },
  fitnessChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 6,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.muted,
  },
  fitnessChipText: {
    fontSize: theme.fontSize.xs,
    fontWeight: "700",
    color: theme.colors.mutedForeground,
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
