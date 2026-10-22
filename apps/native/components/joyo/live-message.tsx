// Ported from JoyoFit (watch-fit) src/features/ai/ui/LiveMessage.tsx, adapted for JoyoRogo.
import { memo, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import {
  liveStatus,
  splitStable,
  stepLabel,
  type LiveState,
} from "@joyorogo/api/lib/joyo-ai/chat-state";
import { formatDurations } from "@joyorogo/api/lib/joyo-ai/durations";
import type { Locale } from "@joyorogo/i18n";

import { Text } from "@/components/ui";

import { Markdown } from "./markdown";
import { ReasoningBlock, StepsCard } from "./steps";
import { useJoyoAiT } from "./use-translate";

/**
 * The answer while it is being written, in the slot where the finished message will be: the steps (folded), the reasoning (folded),
 * the text as it grows, and one still marker after it. Without text yet, one line says what the model is doing. No animation loops:
 * what changes is the text itself.
 */
export const LiveMessage = memo(function LiveMessage({
  live,
  locale,
}: {
  live: LiveState;
  locale: Locale;
}) {
  const { t } = useTranslation("joyoAiApp");
  const tj = useJoyoAiT();
  const status = liveStatus(live);
  const line =
    status.kind === "tool"
      ? stepLabel(status.step, tj)
      : status.kind === "reasoning"
        ? t("chat.reasoningLive")
        : t("chat.writing");
  const writing = live.text !== "";
  // Finished paragraphs are drawn once and left alone; only the paragraph being written is parsed and drawn on each update.
  const shown = useMemo(() => formatDurations(live.text, locale), [live.text, locale]);
  const { head, tail } = useMemo(() => splitStable(shown), [shown]);
  return (
    <View style={styles.wrap}>
      <StepsCard steps={live.steps} />
      <ReasoningBlock text={live.reasoning} live />
      {writing ? (
        <>
          {head === "" ? null : <Markdown text={head} />}
          <Markdown text={tail} streaming />
          <View style={styles.marker} />
        </>
      ) : live.reasoning === "" && !live.steps.some((step) => step.running) ? (
        <Text accessibilityLiveRegion="polite" style={styles.line}>
          {line}
        </Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create((theme) => ({
  wrap: { gap: theme.spacing.sm },
  line: { fontSize: theme.fontSize.sm, color: theme.colors.mutedForeground },
  marker: { width: 8, height: 8, borderRadius: 4, backgroundColor: theme.colors.mutedForeground },
}));
