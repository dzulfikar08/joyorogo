import { Beef, Flame, Moon } from "lucide-react";

import type { TargetNotes, Targets } from "@joyorogo/api/lib/engine";
import { cn } from "@joyorogo/ui/lib/utils";

import { StatTile } from "@/components/kit/surface";
import { fmtInt } from "@/lib/format";

const NOTE_TEXT: Record<TargetNotes, string> = {
  MAINTENANCE: "Beratmu sudah di rentang sehat; rencananya menjaga berat, bukan menurun.",
  BELOW_HEALTHY_RANGE:
    "Target beratmu di bawah rentang berat sehat untuk tinggimu. Pertimbangkan menaikkannya.",
  PLAN_CLAMPED: "Rencana disesuaikan agar aman, defisit harian dibatasi.",
  ADAPTIVE: "Target disesuaikan dari data makan + timbanganmu 3 minggu terakhir.",
};

export function TargetNotesList({ notes }: { notes: TargetNotes[] }) {
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
          {NOTE_TEXT[note]}
        </li>
      ))}
    </ul>
  );
}

/** The three daily numbers as tinted tiles, same language as beranda. */
export function PlanNumbers({ targets }: { targets: Targets }) {
  return (
    <div className="grid grid-cols-3 gap-3">
      <StatTile
        metric="makan"
        icon={<Beef className="size-[1.125rem]" aria-hidden />}
        label="Makan"
        value={fmtInt(targets.eatKcal)}
        unit="kcal"
      />
      <StatTile
        metric="bakar"
        icon={<Flame className="size-[1.125rem]" aria-hidden />}
        label="Bakar"
        value={fmtInt(targets.burnKcal)}
        unit="kcal"
      />
      <StatTile
        metric="tidur"
        icon={<Moon className="size-[1.125rem]" aria-hidden />}
        label="Tidur"
        value={fmtInt(targets.sleepHours)}
        unit="jam"
      />
    </div>
  );
}
