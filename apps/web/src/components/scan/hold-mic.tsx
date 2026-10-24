import { Button } from "@joyorogo/ui/components/button";
import { Loader2, Mic } from "lucide-react";
import { useEffect, useRef } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import { useTranslation } from "react-i18next";

import type { ScanCorrection } from "@/components/scan/correct-box";

/** A press shorter than this is a tap (record until the next tap), longer is hold-to-talk (release sends). */
const HOLD_MS = 400;

/**
 * The full-width hold-to-talk button over `useScanCorrection`: pointer and Space/Enter share one press/release pair,
 * and a short tap records until the next tap. Where the recording goes (a correction, or a queued context) is the
 * screen's call.
 */
export function HoldMic({
  correction,
  idleLabel,
  ariaLabel,
}: {
  correction: ScanCorrection;
  idleLabel: string;
  ariaLabel: string;
}) {
  const { t } = useTranslation("scan");
  const { phase, startRecording, stopRecording } = correction;
  const recording = phase === "recording";
  const working = phase === "working";

  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const downRef = useRef(false);
  const startedAtRef = useRef<number | null>(null);
  const swallowReleaseRef = useRef(false);

  useEffect(() => {
    // Released while the mic was still opening (permission prompt): keep recording until the next tap.
    startedAtRef.current = phase === "recording" && downRef.current ? performance.now() : null;
  }, [phase]);

  const press = () => {
    downRef.current = true;
    if (phaseRef.current === "recording") {
      swallowReleaseRef.current = true;
      stopRecording(false);
    } else if (phaseRef.current === "idle") {
      void startRecording();
    }
  };
  const release = () => {
    if (!downRef.current) return;
    downRef.current = false;
    if (swallowReleaseRef.current) {
      swallowReleaseRef.current = false;
      return;
    }
    const startedAt = startedAtRef.current;
    if (
      phaseRef.current === "recording" &&
      startedAt !== null &&
      performance.now() - startedAt >= HOLD_MS
    ) {
      stopRecording(false);
    }
  };

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    press();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== " " && event.key !== "Enter") return;
    event.preventDefault();
    if (!event.repeat) press();
  };
  const onKeyUp = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== " " && event.key !== "Enter") return;
    event.preventDefault();
    release();
  };

  const label = working
    ? t("simple.working")
    : recording
      ? t("simple.listening")
      : idleLabel;

  return (
    <Button
      type="button"
      size="lg"
      variant={recording ? "destructive" : "default"}
      aria-label={phase === "idle" ? ariaLabel : undefined}
      aria-pressed={recording}
      disabled={working}
      className="h-16 w-full touch-none text-base select-none"
      onPointerDown={onPointerDown}
      onPointerUp={release}
      onPointerCancel={release}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      onBlur={release}
      onContextMenu={(event) => event.preventDefault()}
    >
      {working ? <Loader2 className="animate-spin" aria-hidden /> : <Mic aria-hidden />}
      {label}
    </Button>
  );
}
