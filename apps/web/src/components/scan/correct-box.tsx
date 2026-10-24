import type { FoodKind } from "@joyorogo/api/lib/food-kind";
import { Button } from "@joyorogo/ui/components/button";
import { Input } from "@joyorogo/ui/components/input";
import { cn } from "@joyorogo/ui/lib/utils";
import { Loader2, Mic, Send, Square, Undo2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useTranslation } from "react-i18next";

import { Card, SectionTitle } from "@/components/kit/surface";
import type { AiFoodItem } from "@/lib/api-types";
import { parseNum } from "@/lib/format";
import { client } from "@/utils/orpc";

/** How a corrected row differs from what it was before the correction. */
export type CorrectionKind = "renamed" | "portion" | "added";

/** Output of ai.correctScan: the corrected list plus how it maps onto the sent one. */
export interface CorrectScanResult {
  items: AiFoodItem[];
  /** Per new item: its index in the list that was sent, null for an added item. */
  origins: Array<number | null>;
  /** `index` is a position in the new list. */
  changes: Array<{ index: number; kind: CorrectionKind }>;
  removed: string[];
  /** What Whisper heard (voice only). */
  transcript: string | null;
  correctionsLeft: number | null;
}

/** Whisper reads these as-is: Chrome/Firefox record webm/opus, Safari mp4/aac. */
const AUDIO_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
/** A spoken correction is a sentence; the cap only guards a forgotten mic. */
const MAX_RECORD_MS = 30_000;
/** Below this the clip is a tap, not speech. */
const MIN_AUDIO_BYTES = 1000;
/** After a stop, how long to wait for the recognizer's final result before using the last interim one. */
const FINAL_WAIT_MS = 1500;
/** The caption shows the latest words only: longer transcripts lose their start. */
const CAPTION_TAIL = 90;
/** The remaining-corrections hint only shows when the limit is near. */
const LEFT_HINT_AT = 3;

// The Web Speech API is missing from some lib.dom versions and prefixed in Safari/old Chrome, so it is typed here.
interface RecognitionResultLike {
  readonly length: number;
  readonly [index: number]: { readonly transcript: string } | undefined;
}
interface RecognitionEventLike {
  readonly results: {
    readonly length: number;
    readonly [index: number]: RecognitionResultLike | undefined;
  };
}
interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onaudiostart: (() => void) | null;
  onresult: ((event: RecognitionEventLike) => void) | null;
  onerror: ((event: { readonly error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}
type RecognitionCtor = new () => RecognitionLike;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function speechLang(language: string): string {
  if (language.startsWith("en")) return "en-US";
  if (language.startsWith("ms")) return "ms-MY";
  return "id-ID";
}

/** Errors that mean live recognition can't work here: the recorder + Whisper path takes over. */
const UNAVAILABLE_ERRORS: Record<string, true> = {
  "not-allowed": true,
  "service-not-allowed": true,
  "language-not-supported": true,
  network: true,
};
/** Set once recognition fails for availability; later presses record audio instead. */
let liveUnavailable = false;

function transcriptOf(results: RecognitionEventLike["results"]): string {
  const parts: string[] = [];
  for (let i = 0; i < results.length; i++) parts.push(results[i]?.[0]?.transcript ?? "");
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function captionTail(text: string): string {
  if (text.length <= CAPTION_TAIL) return text;
  const cut = text.slice(-CAPTION_TAIL);
  const space = cut.indexOf(" ");
  return `…${space > 0 ? cut.slice(space + 1) : cut}`;
}

/** One press-to-release of live recognition. */
interface LiveSession {
  rec: RecognitionLike;
  text: string;
  gotResult: boolean;
  stopped: boolean;
  discard: boolean;
  capTimer: number | undefined;
  finalTimer: number | undefined;
}

/** What is being said (or, while the correction runs, sent). */
export interface LiveCaptionState {
  text: string;
  sending: boolean;
}

function recorderMime(): string | null {
  if (typeof window === "undefined" || typeof MediaRecorder === "undefined") return null;
  if (!navigator.mediaDevices?.getUserMedia) return null;
  return AUDIO_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

// new Promise, not Promise.withResolvers: Safari < 17.4 (iOS 17.3) lacks it.
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** The list as the user currently sees it: edited kcal and tapped kinds included. */
export function toPayload(
  items: AiFoodItem[],
  kcals: Record<number, string>,
  kinds: Record<number, FoodKind>,
) {
  return items.map((item, index) => {
    const typed = parseNum(kcals[index] ?? String(item.kcal));
    return {
      name: item.name,
      portion: item.portion ?? undefined,
      grams: item.grams ?? undefined,
      kcal: typed !== null && typed >= 0 ? typed : item.kcal,
      protein: item.protein ?? undefined,
      carbs: item.carbs ?? undefined,
      fat: item.fat ?? undefined,
      fiber: item.fiber ?? undefined,
      confidence: item.confidence ?? undefined,
      kind: kinds[index] ?? item.kind,
      box: item.box ? [...item.box] : undefined,
      pieces: item.pieces,
      grossGrams: item.grossGrams,
      edibleGrams: item.edibleGrams,
      withBone: item.withBone,
    };
  });
}

/** Small pill on a row the last correction touched. */
export function CorrectBadge({ kind }: { kind: CorrectionKind }) {
  const { t } = useTranslation("scan");
  return (
    <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[0.6875rem] leading-none font-bold text-primary">
      {t(`correct.badge.${kind}`)}
    </span>
  );
}

/** Row highlight while a correction's changes are still fresh. */
export const CORRECTED_ROW_CLASS = "bg-primary/[0.06] ring-1 ring-primary/25 ring-inset";

export type CorrectionInput = { text: string } | { audioBase64: string };

export interface ScanCorrection {
  phase: "idle" | "recording" | "working";
  error: string | null;
  /** What Whisper heard (voice only). */
  heard: string | null;
  /** Live caption of the speech; null when not using live recognition. */
  live: LiveCaptionState | null;
  /** Sends a typed or recorded correction; resolves true when the screen applied it. */
  submit: (input: CorrectionInput) => Promise<boolean>;
  startRecording: () => Promise<void>;
  stopRecording: (discard: boolean) => void;
  /** Drops any recording and in-flight request (the list the answer was made for is gone). */
  cancel: () => void;
}

/** The live transcript under a mic: the latest words, at most three lines. */
export function LiveCaption({
  live,
  polite,
  className,
}: {
  live: LiveCaptionState | null;
  polite?: boolean;
  className?: string;
}) {
  const { t } = useTranslation("scan");
  if (!live?.text) return null;
  return (
    <p
      className={cn("line-clamp-3 break-words", className)}
      {...(polite ? { role: "status" } : {})}
    >
      {live.sending
        ? t("simple.liveSending", { text: captionTail(live.text) })
        : t("simple.liveHeard", { text: captionTail(live.text) })}
    </p>
  );
}

/**
 * The one client for ai.correctScan, typed or by voice: MediaRecorder capture, the request and its error copy. The
 * screen owns the list, so it applies the result (`onApply` returns false when the list moved on while the request
 * ran). Every input is read at call time, so a recording that ends later still corrects the list as it is by then.
 */
export function useScanCorrection(args: {
  photoId: string | null;
  items: AiFoodItem[];
  kcals: Record<number, string>;
  kinds: Record<number, FoodKind>;
  onApply: (result: CorrectScanResult, base: AiFoodItem[]) => boolean;
}): ScanCorrection {
  const { t, i18n } = useTranslation("scan");
  const [phase, setPhase] = useState<ScanCorrection["phase"]>("idle");
  const [error, setError] = useState<string | null>(null);
  const [heard, setHeard] = useState<string | null>(null);
  const [live, setLive] = useState<LiveCaptionState | null>(null);
  const [mime] = useState(recorderMime);

  const liveRef = useRef<LiveSession | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const discardRef = useRef(false);
  const stopTimerRef = useRef<number | undefined>(undefined);
  const abortRef = useRef<AbortController | null>(null);
  const argsRef = useRef(args);
  argsRef.current = args;

  const cancel = () => {
    discardRef.current = true;
    recorderRef.current?.stop();
    clearTimeout(stopTimerRef.current);
    if (liveRef.current) dropLive(liveRef.current);
    abortRef.current?.abort();
    abortRef.current = null;
    setPhase("idle");
    setError(null);
    setHeard(null);
    setLive(null);
  };

  // Release the mic and any in-flight request when the screen goes away.
  useEffect(
    () => () => {
      discardRef.current = true;
      recorderRef.current?.stop();
      clearTimeout(stopTimerRef.current);
      const session = liveRef.current;
      if (session) {
        clearTimeout(session.capTimer);
        clearTimeout(session.finalTimer);
        session.rec.onaudiostart = null;
        session.rec.onresult = null;
        session.rec.onerror = null;
        session.rec.onend = null;
        session.rec.abort();
        liveRef.current = null;
      }
      abortRef.current?.abort();
    },
    [],
  );

  const submit = async (input: CorrectionInput): Promise<boolean> => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const { photoId, items, kcals, kinds } = argsRef.current;
    setError(null);
    setHeard(null);
    setPhase("working");
    try {
      const result = await client.ai.correctScan(
        {
          ...(photoId ? { photoId } : {}),
          items: toPayload(items, kcals, kinds),
          ...input,
        },
        { signal: controller.signal },
      );
      if (controller.signal.aborted) return false;
      setHeard(result.transcript);
      if (argsRef.current.onApply(result, items)) return true;
      setError(t("correct.error.failed"));
    } catch (err) {
      if (controller.signal.aborted) return false;
      setError(err instanceof Error && err.message ? err.message : t("correct.error.failed"));
      const transcript = (err as { data?: { transcript?: unknown } } | null)?.data?.transcript;
      if (typeof transcript === "string" && transcript) setHeard(transcript);
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setPhase("idle");
      }
    }
    return false;
  };

  const startAudio = async () => {
    if (mime === null) {
      setError(t("correct.micUnsupported"));
      return;
    }
    setError(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError(t("correct.micDenied"));
      return;
    }
    const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const chunks: Blob[] = [];
    discardRef.current = false;
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onstop = () => {
      for (const track of stream.getTracks()) track.stop();
      clearTimeout(stopTimerRef.current);
      recorderRef.current = null;
      if (discardRef.current) {
        setPhase("idle");
        return;
      }
      const blob = new Blob(chunks, { type: recorder.mimeType || mime || "audio/webm" });
      if (blob.size < MIN_AUDIO_BYTES) {
        setError(t("correct.error.voiceEmpty"));
        setPhase("idle");
        return;
      }
      void blobToBase64(blob).then((audioBase64) => submit({ audioBase64 }));
    };
    recorderRef.current = recorder;
    recorder.start();
    stopTimerRef.current = window.setTimeout(() => recorder.stop(), MAX_RECORD_MS);
    setPhase("recording");
  };

  /** Tears the session down (handlers off first, so the abort below reports nothing). */
  const dropLive = (session: LiveSession) => {
    clearTimeout(session.capTimer);
    clearTimeout(session.finalTimer);
    session.rec.onaudiostart = null;
    session.rec.onresult = null;
    session.rec.onerror = null;
    session.rec.onend = null;
    try {
      session.rec.abort();
    } catch {
      // Already stopped.
    }
    if (liveRef.current === session) liveRef.current = null;
  };

  /** The recognizer is done (or gave up waiting): send what was heard as a text correction. */
  const finishLive = (session: LiveSession) => {
    if (liveRef.current !== session) return;
    dropLive(session);
    if (session.discard) {
      setLive(null);
      setPhase("idle");
      return;
    }
    const text = session.text.trim().slice(0, 300).trim();
    if (text.replace(/\s/g, "").length < 2) {
      setLive(null);
      setError(t("correct.error.voiceEmpty"));
      setPhase("idle");
      return;
    }
    setLive({ text, sending: true });
    void submit({ text }).finally(() => {
      if (liveRef.current === null) setLive(null);
    });
  };

  const stopLive = (session: LiveSession, discard: boolean) => {
    if (liveRef.current !== session) return;
    if (discard) {
      session.discard = true;
      finishLive(session);
      return;
    }
    if (session.stopped) return;
    session.stopped = true;
    clearTimeout(session.capTimer);
    setPhase("working");
    setLive({ text: session.text, sending: true });
    // stop() delivers the final result, then `end`; the timer covers a recognizer that never ends.
    session.finalTimer = window.setTimeout(() => finishLive(session), FINAL_WAIT_MS);
    try {
      session.rec.stop();
    } catch {
      finishLive(session);
    }
  };

  const startLive = (Ctor: RecognitionCtor) => {
    if (liveRef.current) return;
    setError(null);
    const rec = new Ctor();
    rec.lang = speechLang(i18n.language);
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    const session: LiveSession = {
      rec,
      text: "",
      gotResult: false,
      stopped: false,
      discard: false,
      capTimer: undefined,
      finalTimer: undefined,
    };
    liveRef.current = session;
    rec.onaudiostart = () => {
      if (liveRef.current === session && !session.stopped) setPhase("recording");
    };
    rec.onresult = (event) => {
      if (liveRef.current !== session) return;
      session.gotResult = true;
      session.text = transcriptOf(event.results);
      setLive({ text: session.text, sending: session.stopped });
      if (!session.stopped) setPhase("recording");
    };
    rec.onerror = (event) => {
      if (liveRef.current !== session || !UNAVAILABLE_ERRORS[event.error]) return;
      if (event.error === "network" && session.gotResult) return;
      // Recognition can't work here: record audio instead (this press if still held, else the next one).
      liveUnavailable = true;
      const { stopped, discard } = session;
      dropLive(session);
      setLive(null);
      if (!stopped) {
        void startAudio();
      } else {
        if (!discard) setError(t("correct.error.voiceEmpty"));
        setPhase("idle");
      }
    };
    rec.onend = () => finishLive(session);
    try {
      rec.start();
    } catch {
      dropLive(session);
      liveUnavailable = true;
      void startAudio();
      return;
    }
    session.capTimer = window.setTimeout(() => stopLive(session, false), MAX_RECORD_MS);
  };

  const startRecording = async () => {
    const Ctor = liveUnavailable ? null : recognitionCtor();
    if (Ctor) startLive(Ctor);
    else await startAudio();
  };

  const stopRecording = (discard: boolean) => {
    const session = liveRef.current;
    if (session) {
      stopLive(session, discard);
      return;
    }
    discardRef.current = discard;
    recorderRef.current?.stop();
  };

  return { phase, error, heard, live, submit, startRecording, stopRecording, cancel };
}

/**
 * "Ada yang kurang pas?": fix the scan result by typing or by voice. The screen owns the correction (`useScanCorrection`)
 * and the list; the box is its typed/voice form.
 */
export function CorrectBox({
  correction,
  correctionsLeft,
  notice,
  canUndo,
  onUndo,
}: {
  correction: ScanCorrection;
  correctionsLeft: number | null;
  /** Summary of the last apply/undo, owned by the screen. */
  notice: string | null;
  canUndo: boolean;
  onUndo: () => void;
}) {
  const { t } = useTranslation(["scan", "common"]);
  const { phase, error, heard, live, submit, startRecording, stopRecording } = correction;
  const [text, setText] = useState("");

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const typed = text.trim();
    if (phase !== "idle" || typed.length < 2) return;
    void submit({ text: typed }).then((applied) => {
      if (applied) setText("");
    });
  };

  const working = phase === "working";
  const recording = phase === "recording";

  return (
    <section className="mt-4" aria-label={t("correct.title")}>
      <SectionTitle className="mb-2">{t("correct.title")}</SectionTitle>
      <Card className="space-y-2 px-4 py-3">
        <p className="text-sm text-muted-foreground">{t("correct.hint")}</p>
        <form className="flex items-center gap-2" onSubmit={onSubmit}>
          <Input
            aria-label={t("correct.title")}
            value={text}
            maxLength={300}
            onChange={(event) => setText(event.target.value)}
            placeholder={t("correct.placeholder")}
            autoComplete="off"
            enterKeyHint="send"
            disabled={phase !== "idle"}
            className="min-w-0 flex-1"
          />
          {recording ? (
            <>
              <Button
                type="button"
                variant="ghost"
                size="icon-lg"
                aria-label={t("common:actions.cancel")}
                onClick={() => stopRecording(true)}
              >
                <X aria-hidden />
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="icon-lg"
                aria-label={t("correct.micStop")}
                onClick={() => stopRecording(false)}
              >
                <Square aria-hidden />
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                variant="secondary"
                size="icon-lg"
                aria-label={t("correct.mic")}
                disabled={working}
                onClick={() => void startRecording()}
              >
                <Mic aria-hidden />
              </Button>
              <Button
                type="submit"
                size="icon-lg"
                aria-label={t("correct.send")}
                disabled={working || text.trim().length < 2}
              >
                {working ? <Loader2 className="animate-spin" aria-hidden /> : <Send aria-hidden />}
              </Button>
            </>
          )}
        </form>
        {recording && (
          <p className="animate-pulse text-sm font-semibold text-destructive" role="status">
            {t("correct.recording")}
          </p>
        )}
        {working && (
          <p className="animate-pulse text-sm text-muted-foreground" role="status">
            {t("correct.working")}
          </p>
        )}
        <LiveCaption live={live} polite className="text-sm text-foreground" />
        {heard && (
          <p className="text-sm text-muted-foreground">{t("correct.heard", { text: heard })}</p>
        )}
        {error && (
          <p className="text-sm font-semibold text-destructive" role="alert">
            {error}
          </p>
        )}
        {!working && !recording && !error && notice && (
          <p className="text-sm font-semibold text-primary" role="status">
            {notice}
          </p>
        )}
        {correctionsLeft !== null && correctionsLeft <= LEFT_HINT_AT && (
          <p className="text-xs text-muted-foreground">
            {t("correct.left", { count: correctionsLeft })}
          </p>
        )}
        {canUndo && !working && !recording && (
          <Button type="button" variant="ghost" size="xs" onClick={onUndo}>
            <Undo2 aria-hidden />
            {t("correct.undo")}
          </Button>
        )}
      </Card>
    </section>
  );
}
