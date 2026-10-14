import { cn } from "@joyorogo/ui/lib/utils";

import { fmtInt } from "@/lib/format";
import { MACRO_META } from "@/lib/macro-icons";

/**
 * Macro chips with the shared macro icons (lib/macro-icons): protein makan (green),
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
    { ...MACRO_META.protein, grams: protein ?? null },
    { ...MACRO_META.carbs, grams: carbs ?? null },
    { ...MACRO_META.fat, grams: fat ?? null },
    { ...MACRO_META.fiber, grams: fiber ?? null },
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
          <macro.Icon className={cn("size-3.5 shrink-0", macro.tone)} aria-hidden />
          <span className="tabular-nums">
            {compact ? `${fmtInt(macro.grams)} g` : `${macro.label} ${fmtInt(macro.grams)} g`}
          </span>
        </span>
      ))}
    </span>
  );
}
