// Ported from JoyoFit (watch-fit) src/features/ai/ui/MessageView.tsx, adapted for JoyoRogo.
import { memo, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import type { StepView } from "@joyorogo/api/lib/joyo-ai/chat-state";
import type { ChatMessage } from "@joyorogo/api/lib/joyo-ai/conversations";

import { Text } from "@/components/ui";
import { fmtInt } from "@/utils/format";

import { IconButton } from "./icon-button";
import { Markdown } from "./markdown";
import { ReasoningBlock, StepsCard } from "./steps";

/** A model id without the router prefix ("anthropic/claude-haiku-5.5" shows as "claude-haiku-5.5"). */
export const modelShort = (model: string): string => model.split("/").pop() || model;

export interface MessageViewProps {
  message: ChatMessage;
  /** The last question: it can be edited. */
  canEdit: boolean;
  /** The last answer: it can be written again. */
  canRegenerate: boolean;
  /** A question with no answer after it (stopped or failed): it can be sent again. */
  canRetry: boolean;
  /** An answer is being written: actions that would start another one rest. */
  busy: boolean;
  onCopy: (message: ChatMessage) => void;
  onRegenerate: () => void;
  onEdit: (message: ChatMessage) => void;
  onRetry: () => void;
}

function UserMessage({ message, canEdit, canRetry, busy, onEdit, onRetry }: MessageViewProps) {
  const { t } = useTranslation("joyoAiApp");
  return (
    <View style={styles.mine}>
      <View style={styles.bubble}>
        <Text selectable style={styles.bubbleText}>
          {message.content}
        </Text>
      </View>
      {canEdit || canRetry ? (
        <View style={styles.actions}>
          {canRetry ? (
            <IconButton
              icon="refresh"
              label={t("chat.retry")}
              disabled={busy}
              onPress={onRetry}
              size={18}
            />
          ) : null}
          {canEdit ? (
            <IconButton
              icon="create-outline"
              label={t("chat.edit")}
              disabled={busy}
              onPress={() => onEdit(message)}
              size={18}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function AssistantMessage({
  message,
  canRegenerate,
  busy,
  onCopy,
  onRegenerate,
}: MessageViewProps) {
  const { t } = useTranslation("joyoAiApp");
  const steps = useMemo<StepView[]>(
    () => (message.steps ?? []).map((s) => ({ ...s, running: false })),
    [message.steps],
  );
  const label = message.fixed
    ? null
    : message.engine === "hosted"
      ? t("chat.hosted")
      : message.model
        ? modelShort(message.model)
        : null;
  const tokens =
    message.engine === "byok" && message.tokens
      ? t("chat.tokens", { tokens: fmtInt(message.tokens.input + message.tokens.output) })
      : null;
  const meta = [label, tokens, message.stopped ? t("chat.stopped") : null]
    .filter((x): x is string => x !== null)
    .join(" · ");
  return (
    <View style={styles.theirs}>
      <StepsCard steps={steps} />
      <Markdown text={message.content} />
      {message.reasoning ? <ReasoningBlock text={message.reasoning} /> : null}
      <View style={styles.metaRow}>
        <View style={styles.actionsStart}>
          <IconButton
            icon="copy-outline"
            label={t("chat.copy")}
            onPress={() => onCopy(message)}
            size={18}
          />
          {canRegenerate ? (
            <IconButton
              icon="refresh"
              label={t("chat.regenerate")}
              disabled={busy}
              onPress={onRegenerate}
              size={18}
            />
          ) : null}
        </View>
        {meta ? (
          <Text style={styles.meta} numberOfLines={1}>
            {meta}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/** One message of the conversation: the question in a bubble on the right, the answer as flowing text across the width. */
export const MessageView = memo(function MessageView(props: MessageViewProps) {
  return props.message.role === "user" ? (
    <UserMessage {...props} />
  ) : (
    <AssistantMessage {...props} />
  );
});

const styles = StyleSheet.create((theme) => ({
  mine: { alignItems: "flex-end" },
  bubble: {
    maxWidth: "85%",
    backgroundColor: theme.colors.muted,
    borderRadius: theme.radius.tile,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 10,
  },
  bubbleText: { fontSize: theme.fontSize.base, lineHeight: 22 },
  actions: { flexDirection: "row", marginRight: -10 },
  theirs: { gap: theme.spacing.sm },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    marginTop: -theme.spacing.sm,
  },
  actionsStart: { flexDirection: "row", marginLeft: -10 },
  meta: {
    flex: 1,
    textAlign: "right",
    fontSize: theme.fontSize.xs,
    color: theme.colors.mutedForeground,
  },
}));
