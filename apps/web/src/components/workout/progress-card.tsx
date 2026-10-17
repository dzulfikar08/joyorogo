import type { WorkoutStatus } from "@/lib/api-types";
import { fmtDateMedium, fmtInt } from "@/lib/format";
import { orpc } from "@/utils/orpc";
import { fmtNumber } from "@joyorogo/i18n";
import { setSummaryLabel } from "@joyorogo/api/lib/workout";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Trophy } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

type Pr = WorkoutStatus["prs"][number];

/** Best lifts with an expandable per-session history. */
export function ProgressCard({ status }: { status: WorkoutStatus }) {
  const { t } = useTranslation(["olahraga", "common"]);
  const [openId, setOpenId] = useState<string | null>(null);
  const history = useQuery(orpc.workout.listSessions.queryOptions({ input: { limit: 20 } }));

  const recordLine = (pr: Pr): string => {
    const best = pr.bestSet;
    if (!best) return "–";
    const set =
      best.weightKg != null
        ? t("latihan.record.weighted", { reps: best.reps, kg: fmtNumber(best.weightKg, 1) })
        : t("latihan.record.bodyweight", { reps: best.reps });
    return pr.best1RM === null
      ? t("latihan.record.best", { set })
      : t("latihan.record.bestE1rm", { set, kg: fmtInt(pr.best1RM.e1rm ?? 0) });
  };

  if (status.prs.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("latihan.progress.empty")}</p>;
  }

  const open = status.prs.find((pr) => pr.exerciseId === openId) ?? null;
  const openHistory = open
    ? (history.data?.items ?? []).filter((item) =>
        item.sets.some((set) => set.exerciseId === open.exerciseId),
      )
    : [];

  return (
    <div className="space-y-1">
      {status.prs.slice(0, 12).map((pr) => {
        const isOpen = pr.exerciseId === openId;
        return (
          <div key={pr.exerciseId} className="rounded-2xl border border-border">
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={() => setOpenId(isOpen ? null : pr.exerciseId)}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-left focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
            >
              <Trophy className="size-4 shrink-0 text-amber-500" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold">{pr.name}</span>
                <span className="block text-xs text-muted-foreground">{recordLine(pr)}</span>
              </span>
              <ChevronDown
                className={`size-4 shrink-0 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`}
                aria-hidden
              />
            </button>
            {isOpen && (
              <ul className="space-y-1 border-t border-border px-4 py-3">
                {openHistory.length === 0 && (
                  <li className="text-xs text-muted-foreground">{t("common:state.loading")}</li>
                )}
                {openHistory.map((item) => {
                  if (!open) return null;
                  const sets = item.sets.filter((set) => set.exerciseId === open.exerciseId);
                  const best = sets.reduce(
                    (acc, s) =>
                      s.weightKg !== null && s.weightKg > (acc?.weightKg ?? -1) ? s : acc,
                    sets[0],
                  );
                  return (
                    <li key={item.session.id} className="text-xs text-muted-foreground">
                      <span className="font-bold text-foreground">
                        {fmtDateMedium(item.session.date)}
                      </span>
                      {" — "}
                      {sets
                        .map((s) =>
                          setSummaryLabel({
                            reps: s.reps,
                            weightKg: s.weightKg,
                            durationSec: s.durationSec ?? null,
                          }),
                        )
                        .join(", ")}
                      {best?.rpe != null ? ` · RPE ${fmtInt(best.rpe)}` : ""}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}
