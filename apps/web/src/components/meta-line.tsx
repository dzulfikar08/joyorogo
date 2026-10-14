import { Fragment, type ReactNode } from "react";

import { cn } from "@joyorogo/ui/lib/utils";

/**
 * Inline list metadata laid out for real: items sit in a gapped row with a
 * small neutral dot between them, instead of joining strings with " · ".
 * Falsy items drop out; nothing renders when all are empty.
 */
export function MetaLine({
  items,
  className,
}: {
  items: Array<ReactNode | null | false | undefined>;
  className?: string;
}) {
  const visible = items.filter((item) => item !== null && item !== false && item !== undefined);
  if (visible.length === 0) return null;
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5", className)}>
      {visible.map((item, index) => (
        <Fragment key={index}>
          {index > 0 && <span className="size-1 rounded-full bg-muted-foreground/60" aria-hidden />}
          <span>{item}</span>
        </Fragment>
      ))}
    </span>
  );
}
