import { cn } from "@joyorogo/ui/lib/utils";
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

/**
 * Circular progress for the three daily numbers. `value / max` is clamped to
 * a full circle; going over budget is shown by the caller's copy, not by a
 * second lap. Fills once from empty on mount (off under reduced motion).
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
}) {
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
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - fraction)}
            className={cn(
              "ring-fill transition-[stroke-dashoffset] duration-500 ease-out",
              STROKE[metric],
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
