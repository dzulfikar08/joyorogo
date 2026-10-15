import { READINESS_ID, fitnessHints, hasFitnessData } from "@joyorogo/api/lib/fitness-hint";
import { useQuery } from "@tanstack/react-query";

import { Card } from "@/components/kit/surface";
import { orpc } from "@/utils/orpc";

function Metric({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="min-w-0 flex-1">
      <p className="text-xl leading-tight font-extrabold tabular-nums">{value ?? "-"}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

/**
 * Recovery, strain and sleep of the day from JoyoFit (the Huawei watch app),
 * with a short food hint. Renders nothing for a day JoyoFit pushed no scores
 * for, and nothing while loading or when the request fails.
 */
export function FitnessCard({ date }: { date: string }) {
  const { data } = useQuery(orpc.fitness.byDate.queryOptions({ input: { date } }));
  if (!hasFitnessData(data)) return null;
  const hints = fitnessHints(data);

  return (
    <Card className="mt-3 space-y-3" aria-label="Skor kebugaran dari JoyoFit">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-muted-foreground">Kebugaran dari JoyoFit</p>
        {data.readiness ? (
          <p className="text-sm font-bold text-tidur-ink">{READINESS_ID[data.readiness]}</p>
        ) : null}
      </div>
      <div className="flex gap-3">
        <Metric label="Pemulihan" value={data.recoveryPct === null ? null : `${data.recoveryPct}%`} />
        <Metric label="Strain" value={data.strain === null ? null : `${data.strain.toFixed(1)} / 21`} />
        <Metric label="Tidur" value={data.sleepPct === null ? null : `${data.sleepPct}%`} />
      </div>
      {hints.map((hint) => (
        <p key={hint} className="text-sm">
          {hint}
        </p>
      ))}
    </Card>
  );
}
