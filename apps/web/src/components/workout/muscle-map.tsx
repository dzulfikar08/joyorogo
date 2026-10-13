import { AlertTriangle, ArrowDownRight, Lightbulb } from "lucide-react";

import type { WorkoutStatus } from "@/lib/api-types";
import { fmtInt } from "@/lib/format";

/** Weekly effective sets per muscle, loudest first, with warning callouts. */
export function MuscleMap({ status }: { status: WorkoutStatus }) {
  const maxSets = Math.max(...status.weekly.map((m) => m.sets), 1);
  const warnings = status.warnings.slice(0, 3);

  return (
    <div className="space-y-4">
      {status.trendHint && (
        <div className="flex gap-2 rounded-2xl bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
          <ArrowDownRight className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>{status.trendHint.message}</p>
        </div>
      )}

      {warnings.map((warning) => (
        <div
          key={warning.muscle}
          className="rounded-2xl border border-border p-3"
        >
          <p className="flex items-start gap-2 text-sm font-semibold">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" aria-hidden />
            {warning.message}
          </p>
          {warning.suggestions.length > 0 && (
            <p className="mt-1.5 flex items-start gap-2 pl-6 text-xs text-muted-foreground">
              <Lightbulb className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>
                Coba: {warning.suggestions.map((s) => s.name).join(", ")}
              </span>
            </p>
          )}
        </div>
      ))}

      <ul className="space-y-2">
        {status.weekly.map((muscle) => (
          <li key={muscle.muscle} className="flex items-center gap-3">
            <span className="w-28 shrink-0 text-sm font-semibold">{muscle.label}</span>
            <span
              className="h-2.5 rounded-full bg-primary/70"
              style={{ width: `${Math.max((muscle.sets / maxSets) * 100, muscle.sets > 0 ? 4 : 0)}%` }}
              role="presentation"
            />
            <span className="ml-auto shrink-0 text-xs font-bold text-muted-foreground tabular-nums">
              {muscle.sets > 0
                ? `${muscle.sets % 1 === 0 ? fmtInt(muscle.sets) : muscle.sets.toFixed(1)} set`
                : "–"}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        Set efektif minggu ini: gerakan utama dihitung 1, gerakan pendukung 0,5.
      </p>
    </div>
  );
}
