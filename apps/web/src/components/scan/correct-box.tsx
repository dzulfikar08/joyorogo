import type { FoodKind } from "@joyorogo/api/lib/food-kind";
import { Button } from "@joyorogo/ui/components/button";
import { Input } from "@joyorogo/ui/components/input";
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
/** The remaining-corrections hint only shows when the limit is near. */
const LEFT_HINT_AT = 3;

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
  /** Sends a typed or recorded correction; resolves true when the screen applied it. */
  submit: (input: CorrectionInput) => Promise<boolean>;
  startRecording: () => Promise<void>;
  stopRecording: (discard: boolean) => void;
  /** Drops any recording and in-flight request (the list the answer was made for is gone). */
  cancel: () => void;
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
  const { t } = useTranslation("scan");
  const [phase, setPhase] = useState<ScanCorrection["phase"]>("idle");
  const [error, setError] = useState<string | null>(null);
  const [heard, setHeard] = useState<string | null>(null);
  const [mime] = useState(recorderMime);

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
    abortRef.current?.abort();
    abortRef.current = null;
    setPhase("idle");
    setError(null);
    setHeard(null);
  };

  // Release the mic and any in-flight request when the screen goes away.
  useEffect(
    () => () => {
      discardRef.current = true;
      recorderRef.current?.stop();
      clearTimeout(stopTimerRef.current);
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

  const startRecording = async () => {
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

  const stopRecording = (discard: boolean) => {
    discardRef.current = discard;
    recorderRef.current?.stop();
  };

  return { phase, error, heard, submit, startRecording, stopRecording, cancel };
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
  const { phase, error, heard, submit, startRecording, stopRecording } = correction;
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
