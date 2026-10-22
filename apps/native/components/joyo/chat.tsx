// Ported from JoyoFit (watch-fit) src/features/ai/ui/JoyoAiChat.tsx (the screen), adapted for JoyoRogo.
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { FlatList, View, type ListRenderItemInfo } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import {
  displayTitle,
  lastIndexOfRole,
  type LiveState,
} from "@joyorogo/api/lib/joyo-ai/chat-state";
import type { ChatMessage } from "@joyorogo/api/lib/joyo-ai/conversations";
import { hostOf } from "@joyorogo/api/lib/joyo-ai/providers";
import { SAFETY_LIMITS } from "@joyorogo/api/lib/joyo-ai/safety";

import { Container } from "@/components/container";
import { PressableScale } from "@/components/motion";
import { BackButton, Skeleton, Text } from "@/components/ui";
import { Disclosure } from "@/components/disclosure";
import { fmtInt } from "@/utils/format";
import { HOSTED_MESSAGE } from "@/src/lib/joyo-ai/error-view";

import { AiErrorNotice } from "./ai-error-notice";
import { Composer } from "./composer";
import { EngineChip } from "./engine-chip";
import { GateCard } from "./gate-card";
import { IconButton } from "./icon-button";
import { LiveMessage } from "./live-message";
import { MessageView, modelShort } from "./message-view";
import { Notice } from "./notice";
import { RenameSheet } from "./rename-sheet";
import { SuggestionChip } from "./suggestion-chip";
import { useJoyoChat } from "./use-joyo-chat";
import { useLooseT } from "./use-translate";

const SUGGESTIONS = ["fiber", "remaining", "weight"] as const;

type Row =
  | { kind: "live"; key: string; live: LiveState }
  | {
      kind: "msg";
      key: string;
      message: ChatMessage;
      canEdit: boolean;
      canRegenerate: boolean;
      canRetry: boolean;
      busy: boolean;
    };

const rowKey = (row: Row): string => row.key;
const Gap = () => <View style={styles.gap} />;

/** The chat of Joyo AI: one screen for both engines. The header, the inverted list, the notices, the composer. */
export function JoyoChat() {
  const { t } = useTranslation("joyoAiApp");
  const { t: tj } = useTranslation("joyoAi");
  const tl = useLooseT();
  const { theme } = useUnistyles();
  const params = useLocalSearchParams<{ ask?: string }>();
  const onAskApplied = useCallback(() => router.setParams({ ask: undefined }), []);
  const chat = useJoyoChat({
    ask: typeof params.ask === "string" && params.ask !== "" ? params.ask : undefined,
    onAskApplied,
  });
  const { scroll, gate, messages, sending, live } = chat;
  const [renaming, setRenaming] = useState(false);

  const lastUser = lastIndexOfRole(messages, "user");
  const lastIndex = messages.length - 1;
  const shownTitle = displayTitle(chat.title, t("chat.newTitle"));
  const ready = gate.kind === "ready";
  const listReady = ready && !chat.opening;

  // Newest first: the list is inverted, so the newest message is at the bottom and growing text never moves what is above it.
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i]!;
      out.push({
        kind: "msg",
        key: message.id,
        message,
        canEdit: i === lastUser,
        canRegenerate: i === lastIndex && message.role === "assistant",
        canRetry: i === lastIndex && message.role === "user" && !sending,
        busy: sending,
      });
    }
    return out;
  }, [messages, lastUser, lastIndex, sending]);
  const data = useMemo<Row[]>(() => {
    if (!listReady) return [];
    return sending && live ? [{ kind: "live", key: chat.liveId, live }, ...rows] : rows;
  }, [listReady, sending, live, rows, chat.liveId]);

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<Row>) =>
      item.kind === "live" ? (
        <LiveMessage live={item.live} locale={chat.locale} />
      ) : (
        <MessageView
          message={item.message}
          canEdit={item.canEdit}
          canRegenerate={item.canRegenerate}
          canRetry={item.canRetry}
          busy={item.busy}
          onCopy={chat.copy}
          onRegenerate={chat.regenerate}
          onEdit={chat.edit}
          onRetry={chat.retry}
        />
      ),
    [chat.copy, chat.regenerate, chat.edit, chat.retry, chat.locale],
  );

  const hostedLabel = chat.hostedUsage
    ? t("chip.hostedUsed", {
        used: fmtInt(chat.hostedUsage.used),
        cap: fmtInt(chat.hostedUsage.cap),
      })
    : t("chip.hosted");
  const chipLabel = chat.own ? t("chip.own", { model: modelShort(chat.own.model) }) : hostedLabel;
  const providerName = chat.own
    ? chat.own.provider === "custom"
      ? hostOf(chat.own.baseUrl)
      : tj(`provider.${chat.own.provider}`)
    : "";
  const goSample = useCallback(() => router.push("/joyo-data"), []);

  // At the bottom of the list (below the newest message): what the last answer left to say.
  const notice = chat.notice;
  const hasNotices = chat.toolsOff || notice !== null;
  const bottom =
    listReady && hasNotices ? (
      <View style={styles.notices}>
        {chat.toolsOff ? (
          <Notice
            icon="construct-outline"
            action={{
              label: t("err.action.model"),
              onPress: () => router.push({ pathname: "/joyo-ai-settings", params: { model: "1" } }),
            }}
          >
            {t("chat.toolsOff")}
          </Notice>
        ) : null}
        {notice?.kind === "own" ? (
          <AiErrorNotice view={notice.view} provider={chat.own?.provider ?? null} />
        ) : null}
        {notice?.kind === "hosted" && notice.failure !== "aborted" ? (
          <Notice tone="danger">{tl(HOSTED_MESSAGE[notice.failure])}</Notice>
        ) : null}
        {notice?.kind === "paywall" ? (
          <GateCard
            gate={{ kind: "paywall" }}
            ownReady={chat.ownUsable}
            onAgreeHosted={chat.agreeHosted}
            onSample={goSample}
          />
        ) : null}
      </View>
    ) : null;

  // At the top of the list (above the oldest message): which engine answers, why nothing can, or the empty chat.
  const top = (
    <View style={styles.top}>
      {ready ? (
        <View style={styles.head}>
          <EngineChip label={chipLabel} />
          {chat.usage ? (
            <Text style={styles.caption}>
              {t("chat.usageToday", {
                tokens: fmtInt(chat.usage.tokens),
                calls: fmtInt(chat.usage.calls),
                ceiling: fmtInt(chat.usage.ceiling),
              })}
            </Text>
          ) : null}
        </View>
      ) : null}
      {gate.kind === "checking" || (ready && chat.opening) ? (
        <Skeleton width="100%" height={140} radius={24} />
      ) : null}
      {gate.kind !== "checking" && gate.kind !== "ready" ? (
        <GateCard
          gate={gate}
          ownReady={chat.ownUsable}
          onAgreeHosted={chat.agreeHosted}
          onSample={goSample}
        />
      ) : null}
      {listReady && messages.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>{t("chat.emptyTitle")}</Text>
          <Text style={styles.body}>
            {chat.own
              ? t("chat.emptyOwn", { model: chat.own.model, provider: providerName })
              : t("chat.emptyHosted")}
          </Text>
          {!sending ? (
            <View style={styles.suggestions}>
              {SUGGESTIONS.map((key) => (
                <SuggestionChip
                  key={key}
                  label={tj(`suggestions.${key}`)}
                  onPress={() => chat.submit(tj(`suggestions.${key}`))}
                />
              ))}
            </View>
          ) : null}
          <Disclosure title={t("chat.privacyTitle")} plain>
            <Text style={styles.caption}>
              {chat.own
                ? t("chat.privacyOwn", { provider: providerName, host: hostOf(chat.own.baseUrl) })
                : t("chat.privacyHosted")}
            </Text>
          </Disclosure>
        </View>
      ) : null}
    </View>
  );

  const jump = scroll.away ? (
    <View pointerEvents="box-none" style={styles.jumpWrap}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={t("chat.jump")}
        onPress={scroll.follow}
        scaleTo={0.96}
        style={styles.jump}
      >
        <Ionicons name="arrow-down" size={16} color={theme.colors.foreground} />
        <Text style={styles.jumpLabel}>{t("chat.jump")}</Text>
      </PressableScale>
    </View>
  ) : null;

  return (
    <Container>
      <View style={styles.header}>
        <BackButton />
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={
            chat.conversationId ? `${shownTitle}. ${t("chat.renameHint")}` : shownTitle
          }
          disabled={!chat.conversationId}
          onPress={() => setRenaming(true)}
          scaleTo={0.98}
          style={styles.titleBox}
        >
          <Text style={styles.title} numberOfLines={1}>
            {shownTitle}
          </Text>
        </PressableScale>
        <IconButton
          icon="time-outline"
          label={t("chat.history")}
          onPress={() => router.push("/joyo-chats")}
          tone="foreground"
        />
        <IconButton
          icon="add"
          label={t("chat.new")}
          onPress={chat.startNew}
          tone="foreground"
          size={24}
        />
      </View>
      <KeyboardAvoidingView behavior="padding" style={styles.flex}>
        <View style={styles.flex}>
          <FlatList
            ref={scroll.ref}
            data={data}
            renderItem={renderItem}
            keyExtractor={rowKey}
            inverted
            ItemSeparatorComponent={Gap}
            ListHeaderComponent={bottom}
            ListFooterComponent={top}
            // No native anchoring: the list only moves for the person (see use-chat-scroll).
            onScroll={scroll.scrollProps.onScroll}
            onContentSizeChange={scroll.scrollProps.onContentSizeChange}
            scrollEventThrottle={scroll.scrollProps.scrollEventThrottle}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            showsVerticalScrollIndicator={false}
            initialNumToRender={10}
            windowSize={9}
            // In an inverted list the native top is the bottom of the screen: swap the padding, and push a short chat to the top.
            contentContainerStyle={[
              styles.listContent,
              { paddingTop: theme.spacing.sm + scroll.room },
            ]}
          />
          {listReady ? jump : null}
        </View>
        {ready ? (
          <View style={styles.footer}>
            <Composer
              text={chat.text}
              onChangeText={chat.setText}
              onSend={() => chat.submit(chat.text)}
              onStop={chat.stop}
              sending={sending}
              editing={chat.editing !== null}
              onCancelEdit={chat.cancelEdit}
              maxLength={SAFETY_LIMITS.maxMessageChars}
              inputRef={chat.inputRef}
            />
          </View>
        ) : null}
      </KeyboardAvoidingView>
      <RenameSheet
        visible={renaming}
        title={chat.title}
        onClose={() => setRenaming(false)}
        onSave={(next) => {
          chat.rename(next);
          setRenaming(false);
        }}
      />
    </Container>
  );
}

const styles = StyleSheet.create((theme) => ({
  flex: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.xs,
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.sm,
    paddingBottom: theme.spacing.xs,
  },
  titleBox: { flex: 1, minHeight: 44, justifyContent: "center" },
  title: { fontSize: theme.fontSize.lg, fontWeight: "700" },
  head: { gap: theme.spacing.xs },
  top: { gap: theme.spacing.lg, paddingBottom: theme.spacing.lg },
  notices: { gap: theme.spacing.md, paddingTop: theme.spacing.md },
  empty: { gap: theme.spacing.md },
  emptyTitle: { fontSize: theme.fontSize.xl, fontWeight: "700" },
  body: { fontSize: theme.fontSize.base, lineHeight: 22, color: theme.colors.mutedForeground },
  caption: { fontSize: theme.fontSize.sm, lineHeight: 18, color: theme.colors.mutedForeground },
  suggestions: { gap: theme.spacing.sm },
  gap: { height: theme.spacing.lg },
  listContent: {
    flexGrow: 1,
    justifyContent: "flex-end",
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: theme.spacing.sm,
    "@md": { maxWidth: 640, width: "100%", alignSelf: "center" },
  },
  footer: {
    backgroundColor: theme.colors.background,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.hairline,
    "@md": { alignItems: "center" },
  },
  jumpWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: theme.spacing.sm,
    alignItems: "center",
  },
  jump: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.xs,
    paddingHorizontal: theme.spacing.md,
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.hairline,
  },
  jumpLabel: { fontSize: theme.fontSize.sm, fontWeight: "600" },
}));
