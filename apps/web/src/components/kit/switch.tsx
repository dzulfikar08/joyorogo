import { cn } from "@joyorogo/ui/lib/utils";

/**
 * On/off switch for settings rows. 44px hit area via padding, visible focus
 * ring, thumb slides with a short transition (no loop).
 */
export function Switch({
  checked,
  onCheckedChange,
  disabled,
  label,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  /** Accessible name; the control has no visible text. */
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative -my-2 inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full p-1 transition-colors duration-200 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:opacity-50",
        checked ? "bg-primary" : "bg-foreground/25",
      )}
    >
      <span
        className={cn(
          "pointer-events-none size-5 rounded-full bg-card shadow-[0_1px_3px_oklch(0.3_0.02_85/25%)] transition-translate duration-200 ease-out",
          checked ? "translate-x-5" : "translate-x-0",
        )}
      />
    </button>
  );
}
