import { cn } from "@joyorogo/ui/lib/utils";
import type { SetType } from "@/lib/workout-contract";
import { useEffect, useRef, useState } from "react";

const SET_TYPE_OPTIONS: { value: SetType; label: string; badge: string }[] = [
  { value: "normal", label: "Normal", badge: "" },
  { value: "warmup", label: "Pemanasan", badge: "W" },
  { value: "drop", label: "Drop set", badge: "D" },
  { value: "failure", label: "Gagal", badge: "F" },
];

const BADGE_BY_TYPE: Record<SetType, string> = {
  normal: "",
  warmup: "W",
  drop: "D",
  failure: "F",
};

/**
 * The SET column: shows the set number, or W/D/F for non-normal types. Tap to
 * open the type menu (Pemanasan / Normal / Drop / Gagal).
 */
export function SetTypeBadge({
  index,
  setType,
  onChange,
  done,
}: {
  index: number;
  setType: SetType;
  onChange: (next: SetType) => void;
  done?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const active = SET_TYPE_OPTIONS.find((option) => option.value === setType);
  const isWarmup = setType === "warmup";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Jenis set ${index + 1}: ${active?.label ?? "Normal"}. Ganti jenis.`}
        onClick={() => setOpen((prev) => !prev)}
        className={cn(
          "flex size-9 items-center justify-center rounded-full text-sm font-bold tabular-nums focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none",
          isWarmup && "bg-amber-500/15 text-amber-600",
          setType === "drop" && "bg-violet-500/15 text-violet-600",
          setType === "failure" && "bg-destructive/15 text-destructive",
          done && "text-primary",
        )}
      >
        {active?.badge || index + 1}
      </button>
      {open && (
        <div
          role="menu"
          className="absolute top-full left-0 z-20 mt-1 w-40 overflow-hidden rounded-xl border border-border bg-card shadow-float"
        >
          {SET_TYPE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="menuitemradio"
              aria-checked={option.value === setType}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
              className={cn(
                "block w-full px-3 py-2.5 text-left text-sm font-semibold hover:bg-muted focus-visible:bg-muted focus-visible:outline-none",
                option.value === setType && "bg-muted",
              )}
            >
              {option.badge ? `${option.badge} · ${option.label}` : option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export { BADGE_BY_TYPE };
