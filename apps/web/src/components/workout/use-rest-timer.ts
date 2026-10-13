import { useCallback, useEffect, useRef, useState } from "react";

/** Short beep via WebAudio (no asset needed). */
function beep(): void {
  try {
    // Legacy Safari prefixed the constructor; named cast, DOM-only.
    const win = window as Window & { webkitAudioContext?: typeof AudioContext };
    const Ctx = window.AudioContext ?? win.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.4);
    osc.onended = () => void ctx.close();
  } catch {
    // Audio is best-effort (autoplay policies, headless tests).
  }
}

function chime(): void {
  if (typeof navigator.vibrate === "function") navigator.vibrate([200, 120, 200]);
  beep();
}

export type RestTimer = {
  /** Seconds left; null when idle. */
  remaining: number | null;
  total: number | null;
  start: (seconds: number) => void;
  adjust: (delta: number) => void;
  stop: () => void;
};

/**
 * Rest countdown between sets. Vibrates and beeps once at zero; auto-stops.
 */
export function useRestTimer(): RestTimer {
  const [remaining, setRemaining] = useState<number | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const firedRef = useRef(false);

  useEffect(() => {
    if (remaining === null) return;
    if (remaining <= 0) {
      if (!firedRef.current) {
        firedRef.current = true;
        chime();
      }
      const t = setTimeout(() => {
        setRemaining(null);
        setTotal(null);
      }, 1500);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setRemaining((prev) => (prev === null ? null : prev - 1)), 1000);
    return () => clearTimeout(t);
  }, [remaining]);

  const start = useCallback((seconds: number) => {
    if (seconds <= 0) return;
    firedRef.current = false;
    setTotal(seconds);
    setRemaining(seconds);
  }, []);

  const adjust = useCallback((delta: number) => {
    firedRef.current = false;
    setRemaining((prev) => {
      if (prev === null) return prev;
      const next = Math.max(1, prev + delta);
      setTotal((t) => (t === null ? t : Math.max(next, t)));
      return next;
    });
  }, []);

  const stop = useCallback(() => {
    setRemaining(null);
    setTotal(null);
  }, []);

  return { remaining, total, start, adjust, stop };
}

/** 95 → "1:35" */
export function fmtClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Elapsed ms → "12:34" or "1:02:05" */
export function fmtElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
