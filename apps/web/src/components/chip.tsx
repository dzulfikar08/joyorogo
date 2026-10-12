import { cn } from "@joyorogo/ui/lib/utils";
import type { ReactNode } from "react";

/** Selection chip for pickers (meal slots, recent foods, sleep presets). */
export function Chip({
  active,
  onClick,
  children,
  className,
  disabled,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex min-h-11 items-center justify-center rounded-full px-4 text-sm font-semibold whitespace-nowrap transition-colors duration-150 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 md:min-h-10",
        active
          ? "pressable bg-foreground text-background"
          : "bg-muted text-foreground hover:bg-border",
        className,
      )}
    >
      {children}
    </button>
  );
}
