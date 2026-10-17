import { useLayoutEffect, useRef } from "react";

import { fmtInt } from "@/lib/format";
import { useReducedMotion } from "@/lib/motion";

/**
 * A number that counts to its value: from 0 on first paint, then from whatever
 * it currently shows whenever `value` changes (a refetch, an optimistic add).
 * The digits are written straight to the DOM by one rAF loop, so the tree never
 * re-renders per frame, and tabular figures keep the width steady. Reduced
 * motion shows the final value at once.
 */
export function CountUp({
  value,
  format = fmtInt,
  duration = 600,
  className,
}: {
  value: number;
  format?: (n: number) => string;
  /** Milliseconds for the first count from 0; later changes run at half this. */
  duration?: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRef<number | null>(null);
  const reduced = useReducedMotion();

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const first = shown.current === null;
    const from = shown.current ?? 0;
    if (reduced || from === value) {
      shown.current = value;
      node.textContent = format(value);
      return;
    }
    const span = first ? duration : duration / 2;
    node.textContent = format(from);
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min(1, Math.max(0, (now - start) / span));
      const current = progress === 1 ? value : from + (value - from) * (1 - (1 - progress) ** 3);
      shown.current = current;
      node.textContent = format(current);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, format, duration, reduced]);

  return <span ref={ref} className={className} />;
}
