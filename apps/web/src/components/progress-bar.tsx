import { cn } from "@joyorogo/ui/lib/utils";

// The one green accent: progress indication only, never decoration.
export function ProgressBar({
  value,
  max,
  className,
  ariaLabel,
}: {
  value: number;
  max: number;
  className?: string;
  ariaLabel?: string;
}) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div
      role="progressbar"
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuemax={Math.round(max)}
      aria-valuenow={Math.round(Math.min(value, max))}
      className={cn("h-2 w-full overflow-hidden rounded-full bg-muted", className)}
    >
      <div
        className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out motion-reduce:transition-none"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
