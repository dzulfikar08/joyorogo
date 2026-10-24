import { Ionicons } from "@expo/vector-icons";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Pressable, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { Button, Text } from "@/components/ui";

import type { CorrectInput, CorrectOutcome } from "./correct-box";
import { useCorrectionRun } from "./use-correction-run";
import { useVoiceRecorder } from "./use-voice-recorder";

/** A press shorter than this is a tap: the take keeps running until the next tap. */
const TAP_MS = 350;

/**
 * Simple scan result: one big hold-to-talk button for the spoken correction. Press and hold, release to send; a quick
 * tap starts a take that the next tap sends (for screen readers and anyone who cannot hold). It sends through the same
 * path as the correction box (`onSubmit` = the screen's `submitCorrection`), so rows, highlight and undo behave alike.
 */
export function SimpleMic({
  busy,
  canUndo,
  onSubmit,
  onUndo,
  context,
}: {
  /** A correction request is in flight (started elsewhere). */
  busy: boolean;
  canUndo: boolean;
  onSubmit: (input: CorrectInput) => Promise<CorrectOutcome | null>;
  onUndo: () => void;
  /**
   * While the photo is still being analyzed: the take goes to `onSubmit` (which queues it, resolving null) instead of
   * correcting rows, the queued line replaces the outcome lines, and the colors suit the dark overlay.
   */
  context?: {
    queued: CorrectInput | null;
    onRemove: () => void;
    /** True from the first press until the take was handed to `onSubmit`. */
    onActive: (active: boolean) => void;
  };
}) {
  const { t } = useTranslation(["scan", "common"]);
  const { theme } = useUnistyles();
  const correction = useCorrectionRun(onSubmit);
  const { error, heard, outcome, undone, run } = correction;
  const voice = useVoiceRecorder({
    onAudio: async (audioBase64) => {
      await run({ audioBase64 });
    },
    onText: async (text) => {
      await run({ text });
    },
    onError: correction.setVoiceError,
  });
  const { recording, caption } = voice;
  const working = busy || correction.processing || voice.processing;
  const onActive = context?.onActive;
  const active = recording || working;
  useEffect(() => {
    onActive?.(active);
  }, [active, onActive]);
  useEffect(() => () => onActive?.(false), [onActive]);
  const dark = context ? styles.onDark : null;
  const mutedDark = context ? styles.onDarkMuted : null;

  const press = useRef({ held: false, latched: false, starting: false, at: 0, ignoreOut: false });
  const [latched, setLatched] = useState(false);
  const recordingRef = useRef(recording);
  recordingRef.current = recording;
  useEffect(() => {
    if (recording) return;
    press.current.latched = false;
    setLatched(false);
  }, [recording]);

  const onPressIn = () => {
    const state = press.current;
    if (working && !recording) return;
    if (recording) {
      // The take is latched by an earlier tap: this press sends it.
      state.ignoreOut = true;
      voice.stop(false);
      return;
    }
    if (state.starting) return;
    state.held = true;
    state.latched = false;
    state.at = Date.now();
    state.starting = true;
    void voice.start().then((started) => {
      state.starting = false;
      // Let go while the permission dialog or the recorder was still coming up: nothing worth sending.
      if (started && !state.held && !state.latched) voice.stop(true);
    });
  };

  const onPressOut = () => {
    const state = press.current;
    state.held = false;
    if (state.ignoreOut) {
      state.ignoreOut = false;
      return;
    }
    if (Date.now() - state.at < TAP_MS) {
      state.latched = true;
      setLatched(true);
      return;
    }
    if (recordingRef.current) voice.stop(false);
  };

  const undo = () => {
    if (working || recording) return;
    onUndo();
    correction.markUndone();
  };

  const label = recording
    ? t("simple.listening")
    : working
      ? t("simple.working")
      : t(context ? "analyzing.contextMic" : "simple.mic");

  return (
    <View style={styles.wrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("simple.micAria")}
        accessibilityState={{ busy: working && !recording, disabled: working && !recording }}
        accessibilityLiveRegion="polite"
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        pressRetentionOffset={{ top: 400, bottom: 400, left: 200, right: 200 }}
        style={({ pressed }) => [
          styles.mic,
          recording ? styles.micRecording : null,
          working && !recording ? styles.micBusy : null,
          pressed && !recording ? styles.micPressed : null,
        ]}
      >
        {working && !recording ? (
          <ActivityIndicator color={theme.colors.primaryForeground} />
        ) : (
          <Ionicons name="mic" size={26} color={theme.colors.primaryForeground} />
        )}
        <View style={styles.micText}>
          <Text style={styles.micLabel}>{label}</Text>
          {recording && !latched ? <Text style={styles.micHint}>{t("simple.micRelease")}</Text> : null}
        </View>
      </Pressable>

      {error ? <Text style={[styles.error, dark]}>{error}</Text> : null}
      {context ? (
        context.queued && !recording ? (
          <View style={styles.queued}>
            <Text style={[styles.status, dark, styles.queuedText]} numberOfLines={2} accessibilityLiveRegion="polite">
              {t("analyzing.contextQueued", {
                text: "text" in context.queued ? context.queued.text : "…",
              })}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("analyzing.contextRemove")}
              onPress={context.onRemove}
              hitSlop={12}
              style={styles.queuedRemove}
            >
              <Ionicons name="close" size={18} color="#FFFFFF" />
            </Pressable>
          </View>
        ) : null
      ) : (
        <>
          {heard ? <Text style={styles.status}>{t("correct.heard", { text: heard })}</Text> : null}
          {outcome ? (
            <Text style={styles.status} accessibilityLiveRegion="polite">
              {t("correct.applied", { count: outcome.count })}
              {outcome.removed.length > 0
                ? ` ${t("correct.removed", { names: outcome.removed.join(", ") })}`
                : ""}
            </Text>
          ) : null}
          {undone ? <Text style={styles.status}>{t("correct.undone")}</Text> : null}
          {canUndo ? (
            <Button
              variant="ghost"
              size="sm"
              icon="arrow-undo"
              label={t("correct.undo")}
              disabled={working || recording}
              onPress={undo}
            />
          ) : null}
        </>
      )}
      {caption ? (
        <Text
          style={[styles.caption, dark]}
          numberOfLines={3}
          ellipsizeMode="head"
          accessibilityLiveRegion="polite"
        >
          {t(caption.sending ? "simple.liveSending" : "simple.liveHeard", { text: caption.text })}
        </Text>
      ) : (
        <Text style={[styles.examples, mutedDark]}>
          {t(context ? "analyzing.contextExamples" : "simple.examples")}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  wrap: {
    alignItems: "center",
    gap: theme.spacing.sm,
  },
  mic: {
    alignSelf: "stretch",
    minHeight: 72,
    borderRadius: theme.radius.tile,
    backgroundColor: theme.colors.primary,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg,
  },
  micRecording: {
    backgroundColor: theme.colors.destructive,
  },
  micBusy: {
    opacity: 0.7,
  },
  micPressed: {
    opacity: 0.85,
  },
  micText: {
    alignItems: "flex-start",
  },
  micLabel: {
    fontSize: theme.fontSize.md,
    fontWeight: "700",
    color: theme.colors.primaryForeground,
  },
  micHint: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.primaryForeground,
    opacity: 0.85,
  },
  error: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.destructive,
    textAlign: "center",
  },
  status: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
    textAlign: "center",
  },
  caption: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
    textAlign: "center",
  },
  examples: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
    textAlign: "center",
  },
  onDark: {
    color: "#FFFFFF",
  },
  onDarkMuted: {
    color: "rgba(255,255,255,0.75)",
  },
  queued: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing.sm,
  },
  queuedText: {
    flexShrink: 1,
  },
  queuedRemove: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.2)",
  },
}));
