import { useMutation, useQuery } from "@tanstack/react-query";
import { Redirect } from "expo-router";
import { useEffect, useState, type ComponentProps } from "react";
import { Pressable, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import {
  Button,
  Chip,
  EmptyState,
  Field,
  Input,
  ListGroup,
  ListRow,
  PageHeader,
  Screen,
  Sheet,
  Skeleton,
} from "@/components/ui";
import { useToast } from "@/components/toast";
import { useSessionGate } from "@/lib/use-session-gate";
import { timeAgoId, type InboxItem } from "@/src/lib/group";
import { pushInboxSnapshot } from "@/src/lib/widgets/push";
import { errorMessage } from "@/utils/format";
import { orpc, queryClient } from "@/utils/orpc";

const inboxOptions = orpc.group.inbox.queryOptions({ input: { limit: 50 } });
const NOTE_SUGGESTIONS = [
  "Semangat catat kalorinya hari ini!",
  "Jangan lupa minum air, ya.",
  "Ayo jalan 10 menit bareng!",
];

/**
 * Kotak Masuk: pokes and notes from groupmates. Opening a row marks it read
 * (optimistic, so the badge clears instantly); each row offers a quick reply.
 */
export default function Inbox() {
  const gate = useSessionGate();
  const toast = useToast();
  const inbox = useQuery(inboxOptions);

  // Mirror the freshest inbox state into the home-screen widget snapshot.
  const inboxData = inbox.data;
  useEffect(() => {
    if (gate !== "authed" || !inboxData) return;
    void pushInboxSnapshot({
      unread: inboxData.filter((item) => item.readAt === null).length,
      items: inboxData.slice(0, 3).map((item) => ({
        id: item.id,
        kind: item.kind,
        senderName: item.senderName,
        message: item.message,
        groupName: item.groupName,
        createdAt: item.createdAt,
        readAt: item.readAt,
      })),
    });
  }, [gate, inboxData]);

  const [replyTarget, setReplyTarget] = useState<InboxItem | null>(null);
  const [replyText, setReplyText] = useState("");

  const markRead = useMutation(
    orpc.group.markRead.mutationOptions({
      onMutate: (input) => markReadOptimistic(input.ids),
      onError: (e, _input, previous) => {
        previous?.restore();
        toast.error("Gagal menandai dibaca", errorMessage(e));
      },
      onSettled: () => queryClient.invalidateQueries({ queryKey: orpc.group.key() }),
    }),
  );

  const nudge = useMutation(
    orpc.group.nudge.mutationOptions({
      onMutate: (input) => {
        const items = queryClient.getQueryData<InboxItem[]>(inboxOptions.queryKey) ?? [];
        const target = items.find(
          (it) => it.senderId === input.toUserId && it.groupId === input.groupId,
        );
        return markReadOptimistic(target ? [target.id] : []);
      },
      onSuccess: (_data, input) => {
        toast.success(
          input.kind === "poke" ? "Colek balik terkirim" : "Catatan balasan terkirim",
          "Pesan masuk ke kotak temanmu.",
        );
        setReplyTarget(null);
        setReplyText("");
        queryClient.invalidateQueries({ queryKey: orpc.group.key() });
      },
      onError: (e, _input, previous) => {
        previous?.restore();
        toast.error("Gagal mengirim", errorMessage(e));
      },
    }),
  );

  if (gate === "loading") {
    return (
      <Screen>
        <PageHeader title="Kotak Masuk" />
        <Skeleton width="100%" height={64} radius={20} />
        <Skeleton width="100%" height={64} radius={20} />
        <Skeleton width="100%" height={64} radius={20} />
      </Screen>
    );
  }
  if (gate === "anon") {
    return <Redirect href="/login" />;
  }

  const items = inbox.data ?? [];

  return (
    <Screen>
      <PageHeader title="Kotak Masuk" caption="Colek dan catatan dari teman grupmu." />

      {inbox.isPending ? (
        <Skeleton width="100%" height={220} radius={24} />
      ) : items.length === 0 ? (
        <EmptyState
          icon="notifications-off-outline"
          title="Belum ada apa-apa"
          description="Colek dan catatan dari teman grup akan muncul di sini."
        />
      ) : (
        <ListGroup>
          {items.map((item) => {
            const unread = item.readAt === null;
            const reply = item.senderInGroup ? (
              <View style={styles.replyActions}>
                {item.kind === "poke" ? (
                  <IconButton
                    icon="hand-left"
                    label={`Colek balik ${item.senderName}`}
                    disabled={nudge.isPending}
                    onPress={() =>
                      nudge.mutate({
                        groupId: item.groupId,
                        toUserId: item.senderId,
                        kind: "poke",
                      })
                    }
                  />
                ) : (
                  <IconButton
                    icon="chatbubble-ellipses"
                    label={`Balas catatan dari ${item.senderName}`}
                    onPress={() => setReplyTarget(item)}
                  />
                )}
                {unread ? (
                  <View style={styles.dot} accessibilityLabel="Belum dibaca" />
                ) : null}
              </View>
            ) : unread ? (
              <View style={styles.dot} accessibilityLabel="Belum dibaca" />
            ) : undefined;
            return (
              <ListRow
                key={item.id}
                icon={item.kind === "poke" ? "hand-left" : "pencil"}
                iconTint={item.kind === "poke" ? "bakar" : "tidur"}
                title={item.senderName}
                subtitle={`${item.kind === "poke" ? "mencolek kamu" : (item.message ?? "mengirim catatan")} • ${item.groupName}`}
                value={timeAgoId(item.createdAt)}
                onPress={unread ? () => markRead.mutate({ ids: [item.id] }) : undefined}
                right={reply}
              />
            );
          })}
        </ListGroup>
      )}

      <Sheet
        visible={replyTarget !== null}
        onClose={() => {
          setReplyTarget(null);
          setReplyText("");
        }}
        title={replyTarget ? `Balas catatan ${replyTarget.senderName}` : "Balas catatan"}
        footer={
          <Button
            label={`Kirim (${replyText.trim().length}/140)`}
            disabled={replyText.trim().length === 0}
            loading={nudge.isPending}
            onPress={() => {
              if (!replyTarget) return;
              nudge.mutate({
                groupId: replyTarget.groupId,
                toUserId: replyTarget.senderId,
                kind: "note",
                message: replyText.trim(),
              });
            }}
          />
        }
      >
        <View style={styles.chips}>
          {NOTE_SUGGESTIONS.map((suggestion) => (
            <Chip
              key={suggestion}
              label={suggestion}
              onPress={() => setReplyText(suggestion)}
              selected={replyText === suggestion}
            />
          ))}
        </View>
        <Field label="Pesan" hint="Maksimal 140 huruf, dikirim lewat notifikasi.">
          <Input
            value={replyText}
            onChangeText={setReplyText}
            maxLength={140}
            multiline
            placeholder="Tulis catatan balasan…"
          />
        </Field>
      </Sheet>
    </Screen>
  );
}

/** Small round icon control used inside inbox rows (reply poke / reply note). */
function IconButton({
  icon,
  label,
  onPress,
  disabled,
}: {
  icon: ComponentProps<typeof Ionicons>["name"];
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const { theme } = useUnistyles();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => [styles.iconButton, pressed && styles.pressedSoft, disabled && { opacity: 0.5 }]}
    >
      <Ionicons name={icon} size={16} color={theme.colors.foreground} />
    </Pressable>
  );
}

/** Marks matching inbox rows read in cache right away; returns an undo snapshot. */
function markReadOptimistic(ids: string[] | undefined) {
  const key = inboxOptions.queryKey;
  const previous = queryClient.getQueryData<InboxItem[]>(key);
  queryClient.setQueryData<InboxItem[]>(key, (old) =>
    old?.map((item) =>
      (!ids || ids.includes(item.id)) && item.readAt === null
        ? { ...item, readAt: new Date() }
        : item,
    ),
  );
  return {
    restore: () => {
      queryClient.setQueryData(key, previous);
    },
  };
}

const styles = StyleSheet.create((theme) => ({
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: theme.colors.primary,
  },
  replyActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
  },
  iconButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.muted,
  },
  pressedSoft: {
    opacity: 0.7,
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.md,
  },
}));
