import { Flame, Moon, Utensils } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { TargetNotes, Targets } from "@joyorogo/api/lib/engine";
import { cn } from "@joyorogo/ui/lib/utils";

import { StatTile } from "@/components/kit/surface";
import { fmtInt } from "@/lib/format";

export function TargetNotesList({ notes }: { notes: TargetNotes[] }) {
  const { t } = useTranslation("settings");
  if (notes.length === 0) return null;
  return (
    <ul className="space-y-2">
      {notes.map((note) => (
        <li
          key={note}
          className={cn(
            "rounded-2xl px-4 py-3 text-sm leading-snug font-medium",
            note === "BELOW_HEALTHY_RANGE"
              ? "bg-destructive/10 text-destructive"
              : "bg-muted text-muted-foreground",
          )}
        >
          {t(`plan.note.${note}`)}
        </li>
      ))}
    </ul>
  );
}

/** The three daily numbers as tinted tiles, same language as beranda. */
export function PlanNumbers({ targets }: { targets: Targets }) {
  const { t } = useTranslation("settings");
  return (
    <div className="grid grid-cols-3 gap-3">
      <StatTile
        metric="makan"
        icon={<Utensils className="size-[1.125rem]" aria-hidden />}
        label={t("plan.numbers.eat")}
        value={fmtInt(targets.eatKcal)}
        unit="kcal"
      />
      <StatTile
        metric="bakar"
        icon={<Flame className="size-[1.125rem]" aria-hidden />}
        label={t("plan.numbers.burn")}
        value={fmtInt(targets.burnKcal)}
        unit="kcal"
      />
      <StatTile
        metric="tidur"
        icon={<Moon className="size-[1.125rem]" aria-hidden />}
        label={t("plan.numbers.sleep")}
        value={fmtInt(targets.sleepHours)}
        unit={t("plan.numbers.unitHours")}
      />
    </div>
  );
}
