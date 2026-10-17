import { AlertTriangle, ArrowDownRight, ChevronRight, Lightbulb } from "lucide-react";
import { useTranslation } from "react-i18next";

import { fmtNumber } from "@joyorogo/i18n";
import { muscleLabel, trendMessage, warningMessage } from "@joyorogo/api/lib/workout";

import type { WorkoutStatus } from "@/lib/api-types";

/** Weekly effective sets per muscle, loudest first, with warning callouts. */
export function MuscleMap({ status }: { status: WorkoutStatus }) {
  const { t } = useTranslation("olahraga");
  const maxSets = Math.max(...status.weekly.map((m) => m.sets), 1);
  const warnings = status.warnings.slice(0, 3);
  const { trendHint } = status;

  return (
    <div className="space-y-3">
      {trendHint && (
        <div className="flex gap-2 rounded-2xl bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
          <ArrowDownRight className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>{trendMessage(trendHint.name, trendHint.dropPct)}</p>
        </div>
      )}

      {warnings.map((warning) => (
        <div key={warning.muscle} className="rounded-2xl border border-border px-3 py-2">
          <p className="flex items-start gap-2 text-sm font-semibold">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" aria-hidden />
            {warningMessage(warning)}
          </p>
          {warning.suggestions.length > 0 && (
            <p className="mt-1 flex items-start gap-2 pl-6 text-xs text-muted-foreground">
              <Lightbulb className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>
                {t("latihan.map.try", { names: warning.suggestions.map((s) => s.name).join(", ") })}
              </span>
            </p>
          )}
        </div>
      ))}

      <ul className="space-y-1.5">
        {status.weekly.map((muscle) => (
          <li key={muscle.muscle} className="flex items-center gap-3">
            <span className="w-28 shrink-0 text-sm font-semibold">{muscleLabel(muscle.muscle)}</span>
            <span
              className="h-2.5 rounded-full bg-primary/70"
              style={{ width: `${Math.max((muscle.sets / maxSets) * 100, muscle.sets > 0 ? 4 : 0)}%` }}
              role="presentation"
            />
            <span className="ml-auto shrink-0 text-xs font-bold text-muted-foreground tabular-nums">
              {muscle.sets > 0
                ? t("latihan.map.sets", { count: muscle.sets, sets: fmtNumber(muscle.sets, 1) })
                : "–"}
            </span>
          </li>
        ))}
      </ul>

      <details className="group text-xs text-muted-foreground">
        <summary className="flex cursor-pointer list-none items-center gap-2 font-semibold select-none [&::-webkit-details-marker]:hidden">
          <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" aria-hidden />
          {t("latihan.map.how.title")}
        </summary>
        <p className="mt-1.5 pl-5.5">{t("latihan.map.how.body")}</p>
      </details>
    </div>
  );
}
