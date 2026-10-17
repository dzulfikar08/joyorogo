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

function blobToBase64(blob: Blob): Promise<string> {
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(blob);
  return promise;
}

/** The list as the user currently sees it: edited kcal and tapped kinds included. */
function toPayload(
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

/**
 * "Ada yang kurang pas?": fix the scan result by typing or by voice. The box
 * only talks to ai.correctScan; the screen owns the list, so it applies the
 * result (returning false when the list moved on while the request ran).
 */
export function CorrectBox({
  photoId,
  items,
  kcals,
  kinds,
  correctionsLeft,
  notice,
  canUndo,
  onUndo,
  onApply,
}: {
  photoId: string | null;
  items: AiFoodItem[];
  kcals: Record<number, string>;
  kinds: Record<number, FoodKind>;
  correctionsLeft: number | null;
  /** Summary of the last apply/undo, owned by the screen. */
  notice: string | null;
  canUndo: boolean;
  onUndo: () => void;
  onApply: (result: CorrectScanResult, base: AiFoodItem[]) => boolean;
}) {
  const { t } = useTranslation(["scan", "common"]);
  const [text, setText] = useState("");
  const [phase, setPhase] = useState<"idle" | "recording" | "working">("idle");
  const [error, setError] = useState<string | null>(null);
  const [heard, setHeard] = useState<string | null>(null);
  const [mime] = useState(recorderMime);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const discardRef = useRef(false);
  const stopTimerRef = useRef<number | undefined>(undefined);
  const abortRef = useRef<AbortController | null>(null);
  // The async result lands in whatever render is current by then.
  const onApplyRef = useRef(onApply);
  onApplyRef.current = onApply;

  // Release the mic and any in-flight request when the box goes away (retry,
  // save, new scan): a late answer must never touch a list it wasn't made for.
  useEffect(
    () => () => {
      discardRef.current = true;
      recorderRef.current?.stop();
      clearTimeout(stopTimerRef.current);
      abortRef.current?.abort();
    },
    [],
  );

  const submit = async (input: { text: string } | { audioBase64: string }) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
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
      if (controller.signal.aborted) return;
      setHeard(result.transcript);
      if (onApplyRef.current(result, items)) {
        setText("");
      } else {
        setError(t("correct.error.failed"));
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof Error && err.message ? err.message : t("correct.error.failed"));
      const transcript = (err as { data?: { transcript?: unknown } } | null)?.data?.transcript;
      if (typeof transcript === "string" && transcript) setHeard(transcript);
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setPhase("idle");
      }
    }
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

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const typed = text.trim();
    if (phase !== "idle" || typed.length < 2) return;
    void submit({ text: typed });
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
