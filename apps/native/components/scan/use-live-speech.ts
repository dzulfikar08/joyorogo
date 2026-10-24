import { getActiveLocale } from "@joyorogo/i18n";
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
  type ExpoSpeechRecognitionErrorCode,
  type ExpoSpeechRecognitionOptions,
} from "expo-speech-recognition";
import { useEffect, useRef, useState } from "react";
import { Platform } from "react-native";

import {
  applyResult,
  commitInterim,
  EMPTY_LIVE_TEXT,
  hasInstalledLocale,
  isAvailabilityError,
  liveTranscript,
  speechLang,
  type LiveText,
} from "@/src/lib/live-speech";

/** After stop(), a final result usually lands within this; after that the last interim wins. */
const FINAL_WAIT_MS = 1_500;
/** After abort(), wait this long for the recognizer to say it is done so a stale "end" cannot hit the next take. */
const ABORT_WAIT_MS = 500;
/** Recognizers end a take on their own after a silence; restart that many times in a row without any speech. */
const MAX_IDLE_RESTARTS = 3;
const ON_DEVICE_CHECK_MS = 1_500;

export type LiveFinish = {
  text: string;
  /** The recognizer's error for this take, if any. */
  error: ExpoSpeechRecognitionErrorCode | null;
};

/** Live recognition that failed for environment reasons stays off for the rest of the session. */
let liveBroken = false;

/** Resolves null after `ms`: a race partner so a stuck native call cannot hold the press forever. */
function timeoutAfter(ms: number): Promise<null> {
  const { promise, resolve } = Promise.withResolvers<null>();
  setTimeout(() => resolve(null), ms);
  return promise;
}

/** Android only: an installed on-device pack for the language, so the take stays off the network. */
const onDeviceByLang: Record<string, boolean> = {};

async function onDeviceReady(lang: string): Promise<boolean> {
  if (Platform.OS !== "android") return false;
  const known = onDeviceByLang[lang];
  if (known !== undefined) return known;
  try {
    if (!ExpoSpeechRecognitionModule.supportsOnDeviceRecognition()) {
      onDeviceByLang[lang] = false;
      return false;
    }
    const supported = await Promise.race([
      ExpoSpeechRecognitionModule.getSupportedLocales({}),
      timeoutAfter(ON_DEVICE_CHECK_MS),
    ]);
    if (!supported) return false;
    const ready = hasInstalledLocale(supported.installedLocales, lang);
    onDeviceByLang[lang] = ready;
    return ready;
  } catch {
    return false;
  }
}

/**
 * Live speech recognition for one spoken correction: `begin` starts it (resolves false when it is not available or
 * permitted, so the caller can record audio instead), `text` is the transcript so far, `finish` stops it and returns the
 * final transcript. `onEnded` fires when the recognizer stops by itself and cannot be restarted (error, long silence).
 */
export function useLiveSpeech({ onEnded }: { onEnded: () => void }) {
  const [text, setText] = useState("");

  const textRef = useRef<LiveText>(EMPTY_LIVE_TEXT);
  const optionsRef = useRef<ExpoSpeechRecognitionOptions | null>(null);
  const activeRef = useRef(false);
  const stoppingRef = useRef(false);
  const endedRef = useRef(true);
  const errorRef = useRef<ExpoSpeechRecognitionErrorCode | null>(null);
  const idleRestartsRef = useRef(0);
  const waiterRef = useRef<(() => void) | null>(null);
  const onEndedRef = useRef(onEnded);
  onEndedRef.current = onEnded;

  const settle = () => {
    const waiter = waiterRef.current;
    waiterRef.current = null;
    waiter?.();
  };

  /** Resolves when the recognizer reports it ended (or errored), or after `ms`. */
  const waitEnded = (ms: number): Promise<void> => {
    if (endedRef.current) return Promise.resolve();
    const { promise, resolve } = Promise.withResolvers<void>();
    const timer = setTimeout(() => {
      waiterRef.current = null;
      resolve();
    }, ms);
    waiterRef.current = () => {
      clearTimeout(timer);
      resolve();
    };
    return promise;
  };

  const ended = () => {
    endedRef.current = true;
    if (waiterRef.current) {
      settle();
      return;
    }
    if (activeRef.current && !stoppingRef.current) onEndedRef.current();
  };

  useSpeechRecognitionEvent("result", (event) => {
    if (!activeRef.current) return;
    const transcript = event.results[0]?.transcript;
    if (typeof transcript !== "string") return;
    idleRestartsRef.current = 0;
    textRef.current = applyResult(textRef.current, { transcript, isFinal: event.isFinal });
    setText(liveTranscript(textRef.current));
  });

  useSpeechRecognitionEvent("error", (event) => {
    if (event.error === "aborted") {
      endedRef.current = true;
      settle();
      return;
    }
    if (!activeRef.current) return;
    errorRef.current = event.error;
    ended();
  });

  useSpeechRecognitionEvent("end", () => {
    if (!activeRef.current) return;
    if (
      !stoppingRef.current &&
      !errorRef.current &&
      !waiterRef.current &&
      idleRestartsRef.current < MAX_IDLE_RESTARTS &&
      optionsRef.current
    ) {
      // The recognizer gave up on a silence while the user is still talking or about to: keep listening.
      idleRestartsRef.current += 1;
      textRef.current = commitInterim(textRef.current);
      try {
        endedRef.current = false;
        ExpoSpeechRecognitionModule.start(optionsRef.current);
        return;
      } catch {
        endedRef.current = true;
      }
    }
    ended();
  });

  // Release the microphone when the owner goes away.
  useEffect(
    () => () => {
      if (!activeRef.current) return;
      activeRef.current = false;
      try {
        ExpoSpeechRecognitionModule.abort();
      } catch {
        // Nothing left to release.
      }
    },
    [],
  );

  /** Starts a take. False: live recognition is not available or not permitted, record audio instead. */
  const begin = async (): Promise<boolean> => {
    if (liveBroken) return false;
    try {
      if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) return false;
      const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!permission.granted) return false;
      const lang = speechLang(getActiveLocale());
      const options: ExpoSpeechRecognitionOptions = {
        lang,
        interimResults: true,
        continuous: true,
        requiresOnDeviceRecognition: await onDeviceReady(lang),
      };
      textRef.current = EMPTY_LIVE_TEXT;
      setText("");
      errorRef.current = null;
      idleRestartsRef.current = 0;
      stoppingRef.current = false;
      endedRef.current = false;
      optionsRef.current = options;
      activeRef.current = true;
      ExpoSpeechRecognitionModule.start(options);
      return true;
    } catch {
      activeRef.current = false;
      endedRef.current = true;
      liveBroken = true;
      return false;
    }
  };

  /** Stops the take and returns what was heard; `discard` aborts instead and waits only for the recognizer to settle. */
  const finish = async (discard: boolean): Promise<LiveFinish> => {
    if (!activeRef.current) return { text: "", error: null };
    stoppingRef.current = true;
    if (!endedRef.current) {
      try {
        if (discard) {
          ExpoSpeechRecognitionModule.abort();
          await waitEnded(ABORT_WAIT_MS);
        } else {
          ExpoSpeechRecognitionModule.stop();
          await waitEnded(FINAL_WAIT_MS);
          if (!endedRef.current) {
            ExpoSpeechRecognitionModule.abort();
            await waitEnded(ABORT_WAIT_MS);
          }
        }
      } catch {
        endedRef.current = true;
      }
    }
    activeRef.current = false;
    const error = errorRef.current;
    if (error && isAvailabilityError(error) && !liveTranscript(textRef.current)) liveBroken = true;
    const result = { text: liveTranscript(textRef.current), error };
    textRef.current = EMPTY_LIVE_TEXT;
    setText("");
    return result;
  };

  return { text, begin, finish };
}
