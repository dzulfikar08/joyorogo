import { Ionicons } from "@expo/vector-icons";
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
} from "expo-audio";
import { File } from "expo-file-system";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Pressable, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { Button, Input, Text } from "@/components/ui";

/** A correction is a short sentence; thirty seconds is plenty and keeps the upload small. */
const MAX_RECORD_MS = 30_000;
/** Matches the server's audioBase64 floor; anything tinier never transcribes. */
const MIN_AUDIO_BASE64 = 1_332;

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

/** Server messages are already localized; the transcript survives a failed parse. */
function errorTranscript(err: unknown): string | null {
  const data = (err as { data?: { transcript?: unknown } } | null)?.data;
  return typeof data?.transcript === "string" && data.transcript ? data.transcript : null;
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
  const [error, setError] = useState<string | null>(null);
  const [heard, setHeard] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<CorrectOutcome | null>(null);
  const [undone, setUndone] = useState(false);
  const [left, setLeft] = useState<number | null>(null);
  const [processing, setProcessing] = useState(false);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const discardRef = useRef(false);
  const stoppingRef = useRef(false);

  const working = busy || processing;
  const cleanText = text.trim();
  const canSend = !working && !recording && cleanText.length >= 2;

  // Release the mic and audio focus when the box goes away.
  useEffect(
    () => () => {
      discardRef.current = true;
      void recorder.stop().catch(() => {});
      void setAudioModeAsync({ allowsRecording: false }).catch(() => {});
    },
    [recorder],
  );

  const run = async (input: CorrectInput) => {
    setError(null);
    setHeard(null);
    setOutcome(null);
    setUndone(false);
    setProcessing(true);
    try {
      const result = await onSubmit(input);
      if (!result) return;
      if ("text" in input) setText("");
      setOutcome(result);
      setHeard(result.transcript);
      if (result.correctionsLeft !== null) setLeft(result.correctionsLeft);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : t("correct.error.failed"));
      setHeard(errorTranscript(err));
    } finally {
      setProcessing(false);
    }
  };

  const finishRecording = async () => {
    if (stoppingRef.current) return;
    stoppingRef.current = true;
    setProcessing(true);
    try {
      try {
        await recorder.stop();
        await setAudioModeAsync({ allowsRecording: false });
      } catch {
        setRecording(false);
        setError(t("correct.error.failed"));
        return;
      }
      setRecording(false);
      const uri = recorder.uri;
      const discarded = discardRef.current;
      if (discarded) {
        if (uri) {
          try {
            new File(uri).delete();
          } catch {
            // The temp file is gone either way.
          }
        }
        return;
      }
      if (!uri) {
        setError(t("correct.error.failed"));
        return;
      }
      let audioBase64: string;
      try {
        const file = new File(uri);
        audioBase64 = await file.base64();
        file.delete();
      } catch {
        setError(t("correct.error.failed"));
        return;
      }
      if (audioBase64.length < MIN_AUDIO_BASE64) {
        setError(t("correct.error.voiceEmpty"));
        return;
      }
      await run({ audioBase64 });
    } finally {
      stoppingRef.current = false;
      discardRef.current = false;
      setProcessing(false);
    }
  };

  const finishRef = useRef(finishRecording);
  finishRef.current = finishRecording;

  useEffect(() => {
    if (!recording) return;
    const startedAt = Date.now();
    setElapsed(0);
    const timer = setInterval(() => {
      const ms = Date.now() - startedAt;
      setElapsed(ms);
      if (ms >= MAX_RECORD_MS) void finishRef.current();
    }, 250);
    return () => clearInterval(timer);
  }, [recording]);

  const startRecording = async () => {
    setError(null);
    setHeard(null);
    let granted = false;
    try {
      granted = (await requestRecordingPermissionsAsync()).granted;
    } catch {
      setError(t("correct.micUnsupported"));
      return;
    }
    if (!granted) {
      setError(t("correct.micDenied"));
      return;
    }
    try {
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      discardRef.current = false;
      stoppingRef.current = false;
      // Each take needs a fresh prepared file; stop() finalizes the previous one.
      await recorder.prepareToRecordAsync();
      recorder.record();
      setRecording(true);
    } catch {
      void setAudioModeAsync({ allowsRecording: false }).catch(() => {});
      setError(t("correct.micUnsupported"));
    }
  };

  const stopRecording = (discard: boolean) => {
    discardRef.current = discard;
    void finishRef.current();
  };

  const send = () => {
    if (!canSend) return;
    void run({ text: cleanText });
  };

  const undo = () => {
    if (working || recording) return;
    onUndo();
    setOutcome(null);
    setHeard(null);
    setError(null);
    setUndone(true);
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
              onPress={() => stopRecording(true)}
            />
            <Button
              size="sm"
              icon="stop"
              label={t("correct.micStop")}
              onPress={() => stopRecording(false)}
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
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("correct.mic")}
            disabled={working}
            onPress={() => void startRecording()}
            style={({ pressed }) => [
              styles.roundButton,
              styles.micButton,
              (pressed || working) && styles.pressedSoft,
            ]}
          >
            <Ionicons name="mic" size={20} color={theme.colors.primary} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("correct.send")}
            disabled={!canSend}
            onPress={send}
            style={({ pressed }) => [
              styles.roundButton,
              styles.sendButton,
              (pressed || !canSend) && styles.pressedSoft,
            ]}
          >
            <Ionicons name="send" size={18} color={theme.colors.primaryForeground} />
          </Pressable>
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
        <Text style={styles.summary} accessibilityLiveRegion="polite">
          {t("correct.applied", { count: outcome.count })}
          {outcome.removed.length > 0
            ? ` ${t("correct.removed", { names: outcome.removed.join(", ") })}`
            : ""}
        </Text>
      ) : null}
      {undone ? (
        <Text style={styles.summary} accessibilityLiveRegion="polite">
          {t("correct.undone")}
        </Text>
      ) : null}
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
  summary: {
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
