import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
} from "expo-audio";
import { File } from "expo-file-system";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

/** A correction is a short sentence; thirty seconds is plenty and keeps the upload small. */
const MAX_RECORD_MS = 30_000;
/** Matches the server's audioBase64 floor; anything tinier never transcribes. */
const MIN_AUDIO_BASE64 = 1_332;

/**
 * The spoken half of a scan correction, shared by the correction box and the simple result screen: asks for the
 * microphone, records one take (capped at thirty seconds), reads it as base64 and hands it to `onAudio`. Problems
 * come back as the localized correction error strings through `onError`. `onAudio` owns its own failures.
 */
export function useVoiceRecorder({
  onAudio,
  onError,
}: {
  onAudio: (audioBase64: string) => Promise<void>;
  /** Called with a message; `null` means "clear the previous error" (a new take started). */
  onError: (message: string | null) => void;
}) {
  const { t } = useTranslation("scan");
  const [recording, setRecording] = useState(false);
  /** Recording stopped and the take is being read or sent. */
  const [processing, setProcessing] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const discardRef = useRef(false);
  const stoppingRef = useRef(false);

  // Release the mic and audio focus when the owner goes away.
  useEffect(
    () => () => {
      discardRef.current = true;
      void recorder.stop().catch(() => {});
      void setAudioModeAsync({ allowsRecording: false }).catch(() => {});
    },
    [recorder],
  );

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
        onError(t("correct.error.failed"));
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
        onError(t("correct.error.failed"));
        return;
      }
      let audioBase64: string;
      try {
        const file = new File(uri);
        audioBase64 = await file.base64();
        file.delete();
      } catch {
        onError(t("correct.error.failed"));
        return;
      }
      if (audioBase64.length < MIN_AUDIO_BASE64) {
        onError(t("correct.error.voiceEmpty"));
        return;
      }
      await onAudio(audioBase64);
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

  /** Resolves true once the take is running. */
  const start = async (): Promise<boolean> => {
    onError(null);
    let granted = false;
    try {
      granted = (await requestRecordingPermissionsAsync()).granted;
    } catch {
      onError(t("correct.micUnsupported"));
      return false;
    }
    if (!granted) {
      onError(t("correct.micDenied"));
      return false;
    }
    try {
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      discardRef.current = false;
      stoppingRef.current = false;
      // Each take needs a fresh prepared file; stop() finalizes the previous one.
      await recorder.prepareToRecordAsync();
      recorder.record();
      setRecording(true);
      return true;
    } catch {
      void setAudioModeAsync({ allowsRecording: false }).catch(() => {});
      onError(t("correct.micUnsupported"));
      return false;
    }
  };

  const stop = (discard: boolean) => {
    discardRef.current = discard;
    void finishRef.current();
  };

  return { recording, processing, elapsed, start, stop };
}
