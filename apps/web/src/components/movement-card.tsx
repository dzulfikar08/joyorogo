import { Flame, Footprints } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

import { movementFor } from "@joyorogo/api/lib/engine";

import { fmtInt } from "@/lib/format";
import { orpc } from "@/utils/orpc";

/**
 * "Gerak dikit" — converts the viewed day's remaining burn target into walking
 * equivalents (steps / km / minutes), so the number feels doable.
 */
export default function MovementCard({ date }: { date?: string }) {
  const summary = useQuery(
    orpc.day.summary.queryOptions({ input: date === undefined ? {} : { date } }),
  );
  if (!summary.data?.targets) return null;

  const remaining = Math.max(0, summary.data.targets.burnKcal - summary.data.burnedKcal);
  if (remaining <= 0) {
    return (
      <section aria-label="Gerak hari ini" className="rounded-2xl bg-muted p-4">
        <p className="flex items-center gap-1.5 text-sm font-bold">
          <Flame className="size-4 text-makan" aria-hidden />
          Target gerak hari ini lunas. Mantap.
        </p>
      </section>
    );
  }

  const weight = summary.data.latestWeightKg ?? summary.data.targets.bmr / 20; // fallback ≈ start weight
  const { steps, km, minutes } = movementFor(remaining, weight);

  return (
    <section aria-label="Gerak hari ini" className="rounded-2xl bg-makan-soft p-4">
      <div className="flex items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-card text-makan">
          <Footprints className="size-[1.125rem]" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-bold">Gerak dikit</p>
          <p className="mt-0.5 text-sm">
            Sisa{" "}
            <strong className="font-extrabold text-makan-ink tabular-nums">
              {fmtInt(remaining)} kcal
            </strong>{" "}
            = <strong className="font-bold tabular-nums">{fmtInt(steps)} langkah</strong> (±{" "}
            <span className="tabular-nums">{km.toLocaleString("id-ID")} km</span> /{" "}
            <span className="tabular-nums">{minutes} menit</span> jalan kaki)
          </p>
        </div>
      </div>
      <p className="mt-2 pl-12 text-xs text-muted-foreground">
        Santai jalan sore aja udah kebayang habisnya.
      </p>
    </section>
  );
}
