import { cn } from "@joyorogo/ui/lib/utils";
import { SET_TYPES, setTypeBadge, setTypeLabel } from "@joyorogo/api/lib/workout";
import type { SetType } from "@/lib/workout-contract";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * The SET column: shows the set number, or P/D/G (W/D/F in English) for
 * non-normal types. Tap to open the type menu.
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
  const { t } = useTranslation("olahraga");
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

  const isWarmup = setType === "warmup";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("latihan.active.aria.setType", { n: index + 1, type: setTypeLabel(setType) })}
        onClick={() => setOpen((prev) => !prev)}
        className={cn(
          "flex size-9 items-center justify-center rounded-full text-sm font-bold tabular-nums focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none",
          isWarmup && "bg-amber-500/15 text-amber-600",
          setType === "drop" && "bg-violet-500/15 text-violet-600",
          setType === "failure" && "bg-destructive/15 text-destructive",
          done && "text-primary",
        )}
      >
        {setTypeBadge(setType) || index + 1}
      </button>
      {open && (
        <div
          role="menu"
          className="absolute top-full left-0 z-20 mt-1 w-40 overflow-hidden rounded-xl border border-border bg-card shadow-float"
        >
          {SET_TYPES.map((option) => (
            <button
              key={option}
              type="button"
              role="menuitemradio"
              aria-checked={option === setType}
              onClick={() => {
                onChange(option);
                setOpen(false);
              }}
              className={cn(
                "block w-full px-3 py-2.5 text-left text-sm font-semibold hover:bg-muted focus-visible:bg-muted focus-visible:outline-none",
                option === setType && "bg-muted",
              )}
            >
              {setTypeBadge(option)
                ? `${setTypeBadge(option)} · ${setTypeLabel(option)}`
                : setTypeLabel(option)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
