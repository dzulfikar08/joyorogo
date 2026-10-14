import { cn } from "@joyorogo/ui/lib/utils";

import { fmtInt } from "@/lib/format";

/**
 * Macro chips with the app's data colors as dots: protein makan (green),
 * karbo bakar (terracotta), lemak tidur (purple), serat neutral. Null and
 * zero grams drop out; nothing renders when all four are empty. `compact`
 * keeps tight rows readable by showing the dot plus value only, with the
 * full label as tooltip and screen-reader text.
 */
export function MacroLine({
  protein,
  carbs,
  fat,
  fiber,
  compact = false,
  className,
}: {
  protein?: number | null;
  carbs?: number | null;
  fat?: number | null;
  fiber?: number | null;
  compact?: boolean;
  className?: string;
}) {
  const macros = [
    { label: "Protein", grams: protein ?? null, dot: "bg-makan" },
    { label: "Karbo", grams: carbs ?? null, dot: "bg-bakar" },
    { label: "Lemak", grams: fat ?? null, dot: "bg-tidur" },
    { label: "Serat", grams: fiber ?? null, dot: "bg-muted-foreground" },
  ].filter((macro): macro is typeof macro & { grams: number } => (macro.grams ?? 0) > 0);
  if (macros.length === 0) return null;
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-x-3 gap-y-0.5", className)}>
      {macros.map((macro) => (
        <span
          key={macro.label}
          className="inline-flex items-center gap-1.5"
          title={compact ? `${macro.label} ${fmtInt(macro.grams)} g` : undefined}
          aria-label={compact ? `${macro.label} ${fmtInt(macro.grams)} g` : undefined}
        >
          <span className={cn("size-1.5 shrink-0 rounded-full", macro.dot)} aria-hidden />
          <span className="tabular-nums">
            {compact ? `${fmtInt(macro.grams)} g` : `${macro.label} ${fmtInt(macro.grams)} g`}
          </span>
        </span>
      ))}
    </span>
  );
}
