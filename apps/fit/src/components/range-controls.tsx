import { GitCompareArrows } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Select } from "@joyorogo/ui/components/select";
import { cn } from "@joyorogo/ui/lib/utils";

import { RANGES, type RangeDays } from "@/lib/range";

import { Segmented } from "./kit";

/** The window of the dashboards: last 7 / 30 / 90 / 365 days, optionally set against the period before. */
export function RangeControls({
  range,
  onRange,
  compare,
  onCompare,
}: {
  range: RangeDays;
  onRange: (range: RangeDays) => void;
  compare?: boolean;
  onCompare?: (compare: boolean) => void;
}) {
  const { t } = useTranslation("fitWeb");
  return (
    <>
      <Segmented<RangeDays>
        label={t("range.label")}
        value={range}
        onChange={onRange}
        className="max-sm:hidden"
        options={RANGES.map((days) => ({
          value: days,
          label: t("range.days", { count: days }),
          name: t("range.daysFull", { count: days }),
        }))}
      />
      {/* Phones: one compact control that opens a bottom sheet. */}
      <Select<RangeDays>
        label={t("range.label")}
        value={range}
        onChange={onRange}
        className="sm:hidden"
        options={RANGES.map((days) => ({ value: days, label: t("range.daysFull", { count: days }) }))}
      />
      {onCompare && (
        <button
          type="button"
          aria-pressed={compare}
          onClick={() => onCompare(!compare)}
          className={cn(
            "inline-flex h-10 items-center gap-1.5 rounded-full px-3.5 text-[0.8125rem] font-semibold whitespace-nowrap ring-1 transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40",
            compare
              ? "bg-primary/10 text-primary ring-primary/30"
              : "bg-card text-muted-foreground ring-foreground/10 hover:text-foreground",
          )}
        >
          <GitCompareArrows className="size-4" aria-hidden />
          {t("compare.toggle")}
        </button>
      )}
    </>
  );
}
