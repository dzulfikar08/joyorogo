// Ported from JoyoFit (watch-fit) src/features/ai/ui/Steps.tsx, adapted for JoyoRogo.
import { Ionicons } from "@expo/vector-icons";
import { memo, useState, type ComponentProps } from "react";
import { useTranslation } from "react-i18next";
import { Platform, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { stepCall, stepLabel, type StepView } from "@joyorogo/api/lib/joyo-ai/chat-state";
import type { ToolName } from "@joyorogo/api/lib/joyo-ai/tools";

import { PressableScale } from "@/components/motion";
import { Text } from "@/components/ui";

import { useJoyoAiT } from "./use-translate";

type IconName = ComponentProps<typeof Ionicons>["name"];

const TOOL_ICON: Record<ToolName, IconName> = {
  get_day: "calendar-outline",
  get_range: "calendar-number-outline",
  get_weight_trend: "trending-up-outline",
  get_targets: "flag-outline",
  search_foods: "search-outline",
  compare_foods: "git-compare-outline",
  fits_today: "checkmark-done-outline",
};

function StepRow({ step }: { step: StepView }) {
  const { t } = useTranslation("joyoAiApp");
  const tj = useJoyoAiT();
  const { theme } = useUnistyles();
  const [open, setOpen] = useState(false);
  const label = stepLabel(step, tj);
  const bad = step.failed || step.notConnected;
  return (
    <View>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={bad ? `${label}. ${t("steps.failed")}` : label}
        accessibilityState={{ expanded: open }}
        scaleTo={0.99}
        onPress={() => setOpen((v) => !v)}
        style={styles.row}
      >
        <Ionicons
          name={bad ? "alert-circle-outline" : TOOL_ICON[step.tool]}
          size={16}
          color={bad ? theme.colors.destructive : theme.colors.mutedForeground}
        />
        <Text style={[styles.phrase, bad && { color: theme.colors.destructive }]} numberOfLines={2}>
          {label}
        </Text>
        <Ionicons
          name={open ? "chevron-up" : "chevron-down"}
          size={14}
          color={theme.colors.mutedForeground}
        />
      </PressableScale>
      {open ? (
        <View style={styles.call}>
          <Text style={styles.small}>{t("steps.call")}</Text>
          <Text selectable style={[styles.small, styles.mono]}>
            {stepCall(step)}
          </Text>
          {bad ? (
            <Text style={[styles.small, { color: theme.colors.destructive }]}>
              {step.notConnected ? t("steps.notConnected") : t("steps.failed")}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/**
 * The data an answer read, in one folded card above the answer text. The header says how many reads (or, while one is running,
 * which); open it for the rows, and each row for the exact call (tool and plain arguments, never a value read).
 */
export const StepsCard = memo(function StepsCard({ steps }: { steps: readonly StepView[] }) {
  const { t } = useTranslation("joyoAiApp");
  const tj = useJoyoAiT();
  const { theme } = useUnistyles();
  const [open, setOpen] = useState(false);
  if (steps.length === 0) return null;
  const running = steps.findLast((s) => s.running);
  const title = running ? stepLabel(running, tj) : t("steps.group", { count: steps.length });
  return (
    <View style={styles.card}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ expanded: open }}
        scaleTo={0.99}
        onPress={() => setOpen((v) => !v)}
        style={styles.header}
      >
        <Text
          style={[styles.headerText, { color: theme.colors.mutedForeground }]}
          numberOfLines={1}
        >
          {title}
        </Text>
        <Ionicons
          name={open ? "chevron-up" : "chevron-down"}
          size={14}
          color={theme.colors.mutedForeground}
        />
      </PressableScale>
      {open ? (
        <View style={styles.rows}>
          {steps.map((step) => (
            <StepRow key={step.id} step={step} />
          ))}
        </View>
      ) : null}
    </View>
  );
});

/** The model's reasoning: one muted row, closed until tapped. `live` words it as in progress ("Berpikir"), after the answer it is "Proses berpikir". */
export const ReasoningBlock = memo(function ReasoningBlock({
  text,
  live,
}: {
  text: string;
  live?: boolean;
}) {
  const { t } = useTranslation("joyoAiApp");
  const { theme } = useUnistyles();
  const [open, setOpen] = useState(false);
  const body = text.trim();
  if (body === "") return null;
  const title = live ? t("chat.thinking") : t("chat.thought");
  return (
    <View style={styles.reasoning}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ expanded: open }}
        scaleTo={0.99}
        onPress={() => setOpen((v) => !v)}
        style={styles.reasoningHeader}
      >
        <Text style={styles.small}>{title}</Text>
        <Ionicons
          name={open ? "chevron-up" : "chevron-down"}
          size={14}
          color={theme.colors.mutedForeground}
        />
      </PressableScale>
      {open ? (
        <Text selectable style={styles.small}>
          {body}
        </Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create((theme) => ({
  card: {
    backgroundColor: theme.colors.muted,
    borderRadius: theme.radius.input,
    paddingHorizontal: theme.spacing.md,
  },
  header: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: theme.spacing.sm },
  headerText: { flex: 1, fontSize: theme.fontSize.sm, fontWeight: "600" },
  rows: { paddingBottom: theme.spacing.xs },
  row: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: theme.spacing.sm },
  phrase: { flex: 1, fontSize: theme.fontSize.sm, lineHeight: 18 },
  call: { gap: 2, paddingLeft: 16 + theme.spacing.sm, paddingBottom: theme.spacing.sm },
  small: { fontSize: theme.fontSize.sm, lineHeight: 18, color: theme.colors.mutedForeground },
  mono: { fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }) },
  reasoning: { gap: theme.spacing.xs },
  reasoningHeader: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    alignSelf: "flex-start",
  },
}));
