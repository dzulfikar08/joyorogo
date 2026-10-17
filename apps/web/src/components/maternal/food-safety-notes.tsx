import { useQuery } from "@tanstack/react-query";
import { CircleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";

import { jakartaToday } from "@joyorogo/api/lib/engine";
import { CAFFEINE_LIMIT_MG, foodFlagsFor } from "@joyorogo/api/lib/maternal";
import type { FoodFlagKey } from "@joyorogo/api/lib/maternal";
import { cn } from "@joyorogo/ui/lib/utils";

import { fmtInt } from "@/lib/format";
import { orpc } from "@/utils/orpc";
import { useMaternalInfo } from "./use-maternal";

/**
 * Gentle food-safety reminders for a Hamil / Menyusui user, one card per kind
 * (de-duplicated across the items). Renders nothing for everyone else and never
 * blocks saving. `addToDay`: the items are not logged yet, so their caffeine is
 * added to the day's total shown on the day line.
 */
export function FoodSafetyNotes({
  names,
  date,
  addToDay = false,
  className,
}: {
  names: string[];
  date?: string;
  addToDay?: boolean;
  className?: string;
}) {
  const { t } = useTranslation("maternal");
  const info = useMaternalInfo();
  const day = useQuery({
    ...orpc.day.summary.queryOptions({ input: { date: date ?? jakartaToday() } }),
    enabled: info !== null,
  });
  if (!info) return null;

  const byKey = new Map<FoodFlagKey, number>();
  for (const name of names) {
    for (const flag of foodFlagsFor(name, info.mode)) {
      byKey.set(flag.key, (byKey.get(flag.key) ?? 0) + (flag.caffeineMg ?? 0));
    }
  }
  if (byKey.size === 0) return null;

  const caffeineMg = byKey.get("caffeine");
  const caffeine = day.data?.maternal?.caffeine;
  const dayMg = caffeine ? Math.round(caffeine.mg + (addToDay ? (caffeineMg ?? 0) : 0)) : null;
  const limit = caffeine?.limitMg ?? CAFFEINE_LIMIT_MG;
  const over = dayMg !== null && dayMg > limit;

  return (
    <section aria-label={t("flags.title")} className={cn("rounded-3xl bg-card p-4", className)}>
      <h2 className="px-1 text-base font-bold tracking-tight">{t("flags.title")}</h2>
      <ul className="mt-3 space-y-2">
        {[...byKey.entries()].map(([key, mg]) => (
          <li key={key} className="flex items-start gap-3 rounded-2xl bg-muted px-4 py-3">
            <CircleAlert className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            <div className="min-w-0">
              <p className="text-sm font-bold">{t(`flags.${key}.title`)}</p>
              <p className="mt-0.5 text-sm leading-snug text-muted-foreground">
                {key === "caffeine"
                  ? t("flags.caffeine.body", { mg: fmtInt(mg) })
                  : t(`flags.${key}.body`)}
              </p>
            </div>
          </li>
        ))}
      </ul>
      {caffeineMg !== undefined && dayMg !== null && (
        <p className="mt-3 px-1 text-sm leading-snug font-semibold tabular-nums">
          {over
            ? t("flags.caffeineOver", { mg: fmtInt(dayMg), limit: fmtInt(limit) })
            : t("flags.caffeineDay", { mg: fmtInt(dayMg), limit: fmtInt(limit) })}
        </p>
      )}
      <p className="mt-3 px-1 text-xs leading-relaxed text-muted-foreground">{t("flags.footer")}</p>
    </section>
  );
}
