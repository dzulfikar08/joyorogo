import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, View } from "react-native";
import Reanimated from "react-native-reanimated";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { PressableScale, useEnter, usePopIn } from "@/components/motion";
import { Button, Input, Text } from "@/components/ui";

import { useCorrectionRun } from "./use-correction-run";
import { useVoiceRecorder } from "./use-voice-recorder";

/** What the screen reports back after it applied a correction. */
export type CorrectOutcome = {
  /** Rows renamed, re-portioned, added or removed. */
  count: number;
  removed: string[];
  /** What Whisper heard (voice only). */
  transcript: string | null;
  correctionsLeft: number | null;
};

export type CorrectInput = { text: string } | { audioBase64: string };

function fmtClock(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Result line under the box; fades up, with a popped check once a correction landed. */
function Summary({ check = false, children }: { check?: boolean; children: React.ReactNode }) {
  const { theme } = useUnistyles();
  const enter = useEnter();
  const pop = usePopIn();
  return (
    <Reanimated.View entering={enter} style={styles.summaryRow}>
      {check ? (
        <Reanimated.View entering={pop}>
          <Ionicons name="checkmark-circle" size={18} color={theme.colors.makanText} />
        </Reanimated.View>
      ) : null}
      <Text style={styles.summary} accessibilityLiveRegion="polite">
        {children}
      </Text>
    </Reanimated.View>
  );
}

/**
 * "Ada yang kurang pas?": fix the scan result by typing or saying it. The
 * screen owns the list, so it applies the answer (`onSubmit`) and keeps the
 * undo stack (`canUndo` / `onUndo`); this box owns input, recording and copy.
 * `onSubmit` resolves null when the answer is stale and must be ignored.
 */
export function CorrectBox({
  busy,
  canUndo,
  onSubmit,
  onUndo,
}: {
  /** The correction request is in flight. */
  busy: boolean;
  canUndo: boolean;
  onSubmit: (input: CorrectInput) => Promise<CorrectOutcome | null>;
  onUndo: () => void;
}) {
  const { t } = useTranslation(["scan", "common"]);
  const { theme } = useUnistyles();
  const [text, setText] = useState("");
  const correction = useCorrectionRun(onSubmit);
  const { error, heard, outcome, undone, left, run } = correction;
  const voice = useVoiceRecorder({
    onAudio: async (audioBase64) => {
      await run({ audioBase64 });
    },
    onError: correction.setVoiceError,
  });
  const { recording, elapsed } = voice;

  const working = busy || correction.processing || voice.processing;
  const cleanText = text.trim();
  const canSend = !working && !recording && cleanText.length >= 2;

  const send = () => {
    if (!canSend) return;
    void run({ text: cleanText }).then((result) => {
      if (result) setText("");
    });
  };

  const undo = () => {
    if (working || recording) return;
    onUndo();
    correction.markUndone();
  };

  return (
    <View style={styles.card}>
      <View>
        <Text style={styles.title}>{t("correct.title")}</Text>
        <Text style={styles.hint}>{t("correct.hint")}</Text>
      </View>

      {recording ? (
        <View style={styles.recordPanel} accessibilityLiveRegion="polite">
          <View style={styles.recordRow}>
            <Ionicons name="mic" size={18} color={theme.colors.destructive} />
            <Text style={styles.recordClock}>{fmtClock(elapsed)}</Text>
          </View>
          <Text style={styles.recordHint}>{t("correct.recording")}</Text>
          <View style={styles.recordActions}>
            <Button
              variant="secondary"
              size="sm"
              label={t("common:actions.cancel")}
              onPress={() => voice.stop(true)}
            />
            <Button
              size="sm"
              icon="stop"
              label={t("correct.micStop")}
              onPress={() => voice.stop(false)}
            />
          </View>
        </View>
      ) : (
        <View style={styles.row}>
          <Input
            value={text}
            onChangeText={setText}
            placeholder={t("correct.placeholder")}
            accessibilityLabel={t("correct.title")}
            editable={!working}
            maxLength={300}
            returnKeyType="send"
            onSubmitEditing={send}
            style={styles.input}
          />
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={t("correct.mic")}
            disabled={working}
            onPress={() => void voice.start()}
            dimTo={0.6}
            scaleTo={0.94}
            style={[styles.roundButton, styles.micButton, working && styles.pressedSoft]}
          >
            <Ionicons name="mic" size={20} color={theme.colors.primary} />
          </PressableScale>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={t("correct.send")}
            disabled={!canSend}
            onPress={send}
            dimTo={0.6}
            scaleTo={0.94}
            style={[styles.roundButton, styles.sendButton, !canSend && styles.pressedSoft]}
          >
            <Ionicons name="send" size={18} color={theme.colors.primaryForeground} />
          </PressableScale>
        </View>
      )}

      {working && !recording ? (
        <View style={styles.statusRow} accessibilityLiveRegion="polite">
          <ActivityIndicator size="small" color={theme.colors.primary} />
          <Text style={styles.status}>{t("correct.working")}</Text>
        </View>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {heard ? <Text style={styles.status}>{t("correct.heard", { text: heard })}</Text> : null}
      {outcome ? (
        <Summary check>
          {t("correct.applied", { count: outcome.count })}
          {outcome.removed.length > 0
            ? ` ${t("correct.removed", { names: outcome.removed.join(", ") })}`
            : ""}
        </Summary>
      ) : null}
      {undone ? <Summary>{t("correct.undone")}</Summary> : null}
      {left !== null && left <= 3 ? (
        <Text style={styles.status}>{t("correct.left", { count: left })}</Text>
      ) : null}

      {canUndo ? (
        <View style={styles.undoRow}>
          <Button
            variant="ghost"
            size="sm"
            icon="arrow-undo"
            label={t("correct.undo")}
            disabled={working || recording}
            onPress={undo}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  card: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.card,
    padding: theme.spacing.md,
    gap: theme.spacing.sm,
  },
  title: {
    fontSize: theme.fontSize.base,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  hint: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
    marginTop: 2,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
  },
  input: {
    flex: 1,
  },
  roundButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  micButton: {
    backgroundColor: theme.colors.muted,
  },
  sendButton: {
    backgroundColor: theme.colors.primary,
  },
  pressedSoft: {
    opacity: 0.6,
  },
  recordPanel: {
    backgroundColor: theme.colors.muted,
    borderRadius: theme.radius.card,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    gap: theme.spacing.xs,
    alignItems: "center",
    justifyContent: "center",
  },
  recordRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
  },
  recordClock: {
    fontSize: theme.fontSize.base,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  recordHint: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.mutedForeground,
    textAlign: "center",
  },
  recordActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    marginTop: theme.spacing.xs,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
  },
  status: {
    fontSize: theme.fontSize.xs,
    color: theme.colors.mutedForeground,
  },
  summaryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.xs,
  },
  summary: {
    flexShrink: 1,
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    color: theme.colors.makanText,
  },
  error: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.destructive,
  },
  undoRow: {
    flexDirection: "row",
  },
}));
