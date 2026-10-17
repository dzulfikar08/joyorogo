import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, Dumbbell } from "lucide-react";
import { useTranslation } from "react-i18next";

import { warningMessage } from "@joyorogo/api/lib/workout";

import { Card } from "@/components/kit/surface";
import { orpc } from "@/utils/orpc";

/** Compact Beranda card: missed-muscle warnings today + door to /latihan. */
export function WorkoutCard() {
  const { t } = useTranslation("home");
  const status = useQuery(orpc.workout.status.queryOptions({ input: {} }));

  // Silent while loading or failing: Beranda stays calm, /latihan owns errors.
  if (status.isPending || status.isError) return null;

  const { warnings, sessionCount28d } = status.data;
  const top = warnings.slice(0, 2);

  return (
    <Card className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="flex size-8 items-center justify-center rounded-full bg-bakar-soft text-bakar-ink">
          <Dumbbell className="size-4" aria-hidden />
        </span>
        <p className="text-sm font-extrabold">{t("workout.title")}</p>
        <Link
          to="/latihan"
          className="ml-auto rounded-full bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
        >
          {t("workout.open")}
        </Link>
      </div>
      {top.length > 0 ? (
        <ul className="space-y-1">
          {top.map((warning) => (
            <li key={warning.muscle} className="flex items-start gap-1.5 text-sm text-muted-foreground">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-500" aria-hidden />
              <span>{warningMessage(warning)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          {sessionCount28d > 0 ? t("workout.allGood") : t("workout.keepMuscle")}
        </p>
      )}
    </Card>
  );
}
