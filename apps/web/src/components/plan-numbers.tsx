import { Flame, Moon, Utensils } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { TargetNotes, Targets } from "@joyorogo/api/lib/engine";
import { cn } from "@joyorogo/ui/lib/utils";

import { StatTile } from "@/components/kit/surface";
import { fmtInt } from "@/lib/format";

export function TargetNotesList({ notes }: { notes: TargetNotes[] }) {
  const { t } = useTranslation("settings");
  // MATERNAL only marks the plan; its notes render from the maternal namespace.
  const shown = notes.filter((note): note is Exclude<TargetNotes, "MATERNAL"> => note !== "MATERNAL");
  if (shown.length === 0) return null;
  return (
    <ul className="space-y-2">
      {shown.map((note) => (
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
  const { t } = useTranslation(["settings", "gain"]);
  // Hamil / Menyusui has no burn target: the eating need and sleep only.
  const maternal = targets.maternal !== null;
  return (
    <div className={cn("grid gap-3", maternal ? "grid-cols-2" : "grid-cols-3")}>
      <StatTile
        metric="makan"
        icon={<Utensils className="size-[1.125rem]" aria-hidden />}
        label={t("settings:plan.numbers.eat")}
        value={fmtInt(targets.eatKcal)}
        unit="kcal"
        sub={targets.gain ? t("gain:plan.perDay", { kcal: fmtInt(targets.gain.surplusKcal) }) : undefined}
      />
      {!maternal && (
        <StatTile
          metric="bakar"
          icon={<Flame className="size-[1.125rem]" aria-hidden />}
          label={t("settings:plan.numbers.burn")}
          value={fmtInt(targets.burnKcal)}
          unit="kcal"
        />
      )}
      <StatTile
        metric="tidur"
        icon={<Moon className="size-[1.125rem]" aria-hidden />}
        label={t("settings:plan.numbers.sleep")}
        value={fmtInt(targets.sleepHours)}
        unit={t("settings:plan.numbers.unitHours")}
      />
    </div>
  );
}
