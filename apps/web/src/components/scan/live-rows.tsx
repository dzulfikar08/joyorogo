import { kcalUnit } from "@joyorogo/i18n";
import { Skeleton } from "@joyorogo/ui/components/skeleton";
import { cn } from "@joyorogo/ui/lib/utils";
import { useEffect, useState } from "react";

import type { LiveRow } from "@joyorogo/api/lib/scan-live";

import { Card } from "@/components/kit/surface";
import { fmtInt } from "@/lib/format";

/** Skeleton rows shown before the first name arrives. */
const SKELETON_ROWS = 2;

/** One item the model has written; fades in on first paint. */
function Row({ row }: { row: LiveRow }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  return (
    <li
      className={cn(
        "flex items-center justify-between gap-3 px-4 py-3 text-sm transition duration-200 motion-reduce:transition-none",
        shown ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0",
      )}
    >
      <span className="min-w-0 truncate font-semibold">{row.name}</span>
      {row.item ? (
        <span className="shrink-0 font-bold tabular-nums">{fmtInt(row.item.kcal)} {kcalUnit()}</span>
      ) : (
        <Skeleton className="h-3 w-12 shrink-0" />
      )}
    </li>
  );
}

/**
 * What the model has found so far while the scan runs (ai.analyzeFoodStream):
 * skeleton bars first, then one row per item, name first and kcal once the
 * item is complete. A trailing skeleton row says more may follow. The final
 * list comes from the finished result, not from these rows.
 */
export function LiveRows({ rows }: { rows: LiveRow[] }) {
  return (
    <Card className="mt-3 overflow-hidden p-0">
      <ul className="divide-y divide-border" aria-live="polite">
        {rows.map((row) => (
          <Row key={row.index} row={row} />
        ))}
        {Array.from({ length: rows.length === 0 ? SKELETON_ROWS : 1 }, (_, i) => (
          <li
            key={`skeleton-${i}`}
            aria-hidden
            className="flex items-center justify-between gap-3 px-4 py-3"
          >
            <Skeleton className={cn("h-3", i === 0 ? "w-32" : "w-24")} />
            <Skeleton className="h-3 w-12" />
          </li>
        ))}
      </ul>
    </Card>
  );
}
