import { Info } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { MaternalInfo } from "@joyorogo/api/lib/maternal";
import { cn } from "@joyorogo/ui/lib/utils";

/** Neutral info notes for the plan flags (TWINS_ENERGY, OVERDUE, CONSULT ...). Never alarm-coloured. */
export function MaternalFlagNotes({
  info,
  className,
}: {
  info: MaternalInfo;
  className?: string;
}) {
  const { t } = useTranslation("maternal");
  const notes = info.flags.flatMap((flag) => [
    flag,
    ...(flag === "CONSULT" ? info.conditions : []),
  ]);
  if (notes.length === 0) return null;
  return (
    <ul className={cn("space-y-2", className)}>
      {notes.map((note) => (
        <li
          key={note}
          className="flex items-start gap-2.5 rounded-2xl bg-muted px-4 py-3 text-sm leading-snug text-muted-foreground"
        >
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{t(`notes.${note}`)}</span>
        </li>
      ))}
    </ul>
  );
}
