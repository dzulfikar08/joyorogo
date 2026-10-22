import "@/unistyles";

import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { displayTitle } from "@joyorogo/api/lib/joyo-ai/chat-state";
import type { ConversationMeta } from "@joyorogo/api/lib/joyo-ai/conversations";

import { ConfirmSheet } from "@/components/confirm-sheet";
import { IconButton } from "@/components/joyo/icon-button";
import { useToast } from "@/components/toast";
import {
  Button,
  EmptyState,
  ListGroup,
  ListRow,
  PageHeader,
  Screen,
  Skeleton,
} from "@/components/ui";
import { joyoChats } from "@/src/lib/joyo-ai/stores";
import { localDay } from "@/src/lib/joyo-ai/usage-store";
import { fmtDateMedium } from "@/utils/format";

/** Past conversations with Joyo AI, on this phone only: open one, delete one or all. */
export default function JoyoChatsScreen() {
  const { t } = useTranslation("joyoAiApp");
  const { theme } = useUnistyles();
  const toast = useToast();
  const [list, setList] = useState<ConversationMeta[] | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<ConversationMeta | "all" | null>(null);

  const reload = useCallback(async () => {
    const [metas, id] = await Promise.all([joyoChats.list(), joyoChats.current()]);
    setList(metas);
    setCurrent(id);
  }, []);
  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );
  useEffect(() => joyoChats.subscribe(() => void reload()), [reload]);

  const open = async (id: string) => {
    await joyoChats.setCurrent(id);
    if (router.canGoBack()) router.back();
    else router.replace("/joyo");
  };
  const startNew = async () => {
    await joyoChats.setCurrent(null);
    if (router.canGoBack()) router.back();
    else router.replace("/joyo");
  };

  const confirmDelete = async () => {
    const target = deleting;
    setDeleting(null);
    if (target === null) return;
    try {
      if (target === "all") {
        await joyoChats.clearAll();
        toast.success(t("chats.allDeleted"));
      } else {
        await joyoChats.remove(target.id);
        toast.success(t("chats.deleted"));
      }
    } catch {
      toast.error(t("chats.deleteFailed"));
    }
  };

  return (
    <Screen>
      <PageHeader title={t("chats.title")} />
      {list === null ? (
        <Skeleton width="100%" height={160} radius={24} />
      ) : list.length === 0 ? (
        <EmptyState
          icon="chatbubble-outline"
          title={t("chats.emptyTitle")}
          description={t("chats.emptyBody")}
          action={<Button label={t("chats.new")} onPress={() => void startNew()} />}
        />
      ) : (
        <>
          <Button
            label={t("chats.new")}
            variant="secondary"
            icon="add"
            onPress={() => void startNew()}
          />
          <ListGroup>
            {list.map((chat) => {
              const title = displayTitle(chat.title, t("chat.newTitle"));
              return (
                <ListRow
                  key={chat.id}
                  title={title}
                  subtitle={`${t("chats.count", { count: chat.messageCount })} · ${fmtDateMedium(localDay(chat.updatedAt))}`}
                  chevron={false}
                  onPress={() => void open(chat.id)}
                  right={
                    <View style={styles.right}>
                      {chat.id === current ? (
                        <Ionicons
                          name="checkmark"
                          size={18}
                          color={theme.colors.primary}
                          accessibilityLabel={t("chats.current")}
                        />
                      ) : null}
                      <IconButton
                        icon="trash-outline"
                        label={t("chats.deleteOne", { title })}
                        onPress={() => setDeleting(chat)}
                      />
                    </View>
                  }
                />
              );
            })}
          </ListGroup>
          <Button
            label={t("chats.deleteAll")}
            variant="ghost"
            destructive
            icon="trash-outline"
            onPress={() => setDeleting("all")}
          />
        </>
      )}
      <ConfirmSheet
        visible={deleting !== null}
        onClose={() => setDeleting(null)}
        title={deleting === "all" ? t("chats.deleteAllTitle") : t("chats.deleteTitle")}
        message={
          deleting === "all"
            ? t("chats.deleteAllMessage", { count: list?.length ?? 0 })
            : t("chats.deleteMessage", {
                title: deleting ? displayTitle(deleting.title, t("chat.newTitle")) : "",
              })
        }
        confirmLabel={deleting === "all" ? t("chats.deleteAllConfirm") : t("chats.deleteConfirm")}
        cancelLabel={t("chats.cancel")}
        onConfirm={() => void confirmDelete()}
      />
    </Screen>
  );
}

const styles = StyleSheet.create((theme) => ({
  right: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.xs,
    marginRight: -theme.spacing.sm,
  },
}));
