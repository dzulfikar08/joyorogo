import { cn } from "@joyorogo/ui/lib/utils";
import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

export type BarChartDatum = {
  key: string;
  value: number;
  /** Short axis label under the bar; leave out to skip this bar's label (long ranges label every few bars). */
  label?: string;
  /** What the readout line says while this bar is selected ("Sel 21 Okt: 6 gelas"). */
  readout: string;
  /** Screen-reader name of the bar. */
  ariaLabel: string;
};

/**
 * Daily bars with an optional dashed target line and a one-line readout above them. Hover, tap or drag
 * across the bars and the readout names that day; arrow keys walk the bars (one tab stop). Bars that reach
 * the target carry the strong colour, the others a soft one.
 */
export function BarChart({
  data,
  target,
  hint,
  ariaLabel,
  height = 112,
  className,
}: {
  data: BarChartDatum[];
  /** Bars at or above it use the strong colour; omit for a single colour. */
  target?: number;
  /** Readout text while nothing is selected. */
  hint: string;
  /** Accessible name of the whole chart. */
  ariaLabel: string;
  height?: number;
  className?: string;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const [tabStop, setTabStop] = useState(Math.max(data.length - 1, 0));
  const area = useRef<HTMLDivElement>(null);
  const bars = useRef<(HTMLButtonElement | null)[]>([]);

  const count = data.length;
  const gap = count <= 10 ? "gap-2" : "gap-[3px]";
  const max = Math.max(target ?? 0, ...data.map((d) => d.value), 1);
  const active = selected !== null ? data[selected] : undefined;
  // A range switch can shrink the list under a remembered index.
  const stop = Math.min(tabStop, Math.max(count - 1, 0));

  const pick = (event: PointerEvent<HTMLDivElement>) => {
    const rect = area.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || count === 0) return;
    const index = Math.floor(((event.clientX - rect.left) / rect.width) * count);
    setSelected(Math.min(Math.max(index, 0), count - 1));
  };

  const walk = (event: KeyboardEvent<HTMLDivElement>) => {
    const from = bars.current.findIndex((node) => node === document.activeElement);
    if (from < 0) return;
    const to =
      event.key === "ArrowLeft"
        ? from - 1
        : event.key === "ArrowRight"
          ? from + 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? count - 1
              : null;
    if (to === null) return;
    event.preventDefault();
    bars.current[Math.min(Math.max(to, 0), count - 1)]?.focus();
  };

  return (
    <div className={className}>
      {/* The bars below carry the same text as their accessible names. */}
      <p
        aria-hidden
        className={cn(
          "h-6 truncate text-sm font-semibold tabular-nums",
          active ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {active ? active.readout : hint}
      </p>
      <div
        ref={area}
        role="group"
        aria-label={ariaLabel}
        style={{ height }}
        className={cn("relative flex touch-pan-y select-none", gap)}
        onPointerDown={pick}
        onPointerMove={pick}
        onPointerLeave={(event) => {
          if (event.pointerType === "mouse" && !area.current?.contains(document.activeElement)) {
            setSelected(null);
          }
        }}
        onKeyDown={walk}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setSelected(null);
        }}
      >
        {target !== undefined && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 border-t border-dashed border-muted-foreground/50"
            style={{ bottom: `${(target / max) * 100}%` }}
          />
        )}
        {data.map((d, i) => {
          const reached = target === undefined || d.value >= target;
          return (
            <button
              key={d.key}
              ref={(node) => {
                bars.current[i] = node;
              }}
              type="button"
              aria-label={d.ariaLabel}
              tabIndex={i === stop ? 0 : -1}
              onFocus={() => {
                setTabStop(i);
                setSelected(i);
              }}
              className="flex h-full min-w-0 flex-1 items-end rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
            >
              <span
                aria-hidden
                className={cn(
                  "block w-full rounded-t-[min(0.375rem,50%)] transition-opacity duration-150",
                  d.value === 0 ? "bg-border" : reached ? "bg-tidur" : "bg-tidur/40",
                  selected !== null && selected !== i && "opacity-45",
                )}
                style={{ height: `${Math.max((d.value / max) * 100, 0)}%`, minHeight: d.value > 0 ? 4 : 2 }}
              />
            </button>
          );
        })}
      </div>
      <div aria-hidden className={cn("mt-1 flex h-[18px]", gap)}>
        {data.map((d, i) => (
          <div key={d.key} className="relative min-w-0 flex-1">
            {d.label && (
              <span
                className={cn(
                  "absolute top-0 left-1/2 w-11 -translate-x-1/2 truncate text-center text-xs font-semibold",
                  selected === i ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {d.label}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
