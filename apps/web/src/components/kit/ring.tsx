import { cn } from "@joyorogo/ui/lib/utils";
import { useEffect, useRef } from "react";
import type { CSSProperties, ReactNode } from "react";

export type Metric = "makan" | "bakar" | "tidur";

const STROKE: Record<Metric, string> = {
  makan: "stroke-makan",
  bakar: "stroke-bakar",
  tidur: "stroke-tidur",
};
const TRACK: Record<Metric, string> = {
  makan: "stroke-makan-soft",
  bakar: "stroke-bakar-soft",
  tidur: "stroke-tidur-soft",
};
/** Arc color override for the eat budget: near limit, then over it. */
const TONE_STROKE = { near: "stroke-amber-400", over: "stroke-destructive" } as const;

/**
 * Circular progress for the three daily numbers. `value / max` is clamped to
 * a full circle; going over budget is shown by the caller's copy, not by a
 * second lap. `tone` recolors the arc near/over budget. Fills once from
 * empty on mount (off under reduced motion).
 */
export function Ring({
  value,
  max,
  metric,
  size = 200,
  stroke = 14,
  label,
  children,
  className,
  tone = "ok",
  whenVisible = false,
}: {
  value: number;
  max: number;
  metric: Metric;
  size?: number;
  stroke?: number;
  /** Accessible description of the progress, e.g. "Makan 985 dari 2.020 kcal". */
  label: string;
  children?: ReactNode;
  className?: string;
  tone?: "ok" | keyof typeof TONE_STROKE;
  /** Start the first fill when the ring scrolls into view (landing rings below the fold). */
  whenVisible?: boolean;
}) {
  const arc = useRef<SVGCircleElement>(null);
  const hasArc = max > 0 && value > 0;

  // Below the fold the first fill would play unseen: hold it until the arc is on screen.
  useEffect(() => {
    const node = arc.current;
    if (!whenVisible || !node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          node.style.animationPlayState = "running";
          observer.disconnect();
        } else {
          node.style.animationPlayState = "paused";
        }
      },
      { threshold: 0.5 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [whenVisible, hasArc]);

  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const fraction = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const center = size / 2;
  return (
    <div
      role="img"
      aria-label={label}
      className={cn("relative grid shrink-0 place-items-center", className)}
      style={{ width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="-rotate-90"
        aria-hidden
      >
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          className={TRACK[metric]}
        />
        {/* No arc at 0: a round cap would still paint a dot. */}
        {fraction > 0 && (
          <circle
            ref={arc}
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - fraction)}
            className={cn(
              "ring-fill transition-[stroke-dashoffset,stroke] duration-500 ease-out",
              tone === "ok" ? STROKE[metric] : TONE_STROKE[tone],
            )}
            style={{ "--ring-circumference": circumference } as CSSProperties}
          />
        )}
      </svg>
      {children && (
        <div className="absolute inset-0 grid place-items-center text-center">{children}</div>
      )}
    </div>
  );
}
