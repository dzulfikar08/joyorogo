import { monthRange, shiftMonth, weekRange } from "@joyorogo/api/lib/diary-view";
import { jakartaToday, shiftDate } from "@joyorogo/api/lib/engine";
import type { FoodKindFilter } from "@joyorogo/api/lib/food-kind";
import { fmtDate } from "@joyorogo/i18n";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Mascot } from "@/components/mascot";
import { Segmented } from "@/components/kit/surface";
import { MacroLine } from "@/components/macro-line";
import { CutoutTile } from "@/components/sticker";
import type { FoodItem } from "@/lib/api-types";
import { fmtInt, fmtKcalLabel } from "@/lib/format";
import { orpc } from "@/utils/orpc";

type Span = "minggu" | "bulan";

const SPANS: ReadonlyArray<Span> = ["minggu", "bulan"];

const arrowClass =
  "flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground transition-colors hover:bg-border hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-30";

function dayMonth(key: string): string {
  return fmtDate(key, "short");
}

function FotoTile({ item, onOpen }: { item: FoodItem; onOpen: (item: FoodItem) => void }) {
  const { t } = useTranslation("makan");
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(item)}
        aria-label={t("photos.tile.label", {
          name: item.name,
          kcal: fmtKcalLabel(item.kcal),
          date: fmtDate(item.date, "weekday"),
        })}
        className="flex h-full w-full flex-col gap-2.5 rounded-3xl bg-card p-3.5 text-left transition-colors hover:bg-muted/60 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
      >
        <span className="flex items-start gap-3">
          <CutoutTile scanId={item.scanId as string} className="size-14" iconClassName="size-6" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs text-muted-foreground tabular-nums">
              {fmtDate(item.date, "weekday")}
            </span>
            <span className="mt-1 block text-2xl leading-none font-extrabold text-kcal tabular-nums">
              {fmtInt(item.kcal)}
            </span>
            <span className="mt-0.5 block text-[0.6875rem] font-semibold text-muted-foreground">
              {t("diary.summary.unit")}
            </span>
          </span>
        </span>
        <span className="line-clamp-2 text-sm leading-snug font-semibold">{item.name}</span>
        <MacroLine
          compact
          className="mt-auto text-xs text-muted-foreground"
          protein={item.protein}
          carbs={item.carbs}
          fat={item.fat}
        />
      </button>
    </li>
  );
}

/**
 * Foto view: the foods with a photo in the viewed week or month as a plain
 * nutrition grid (thumbnail, kcal, macros). Tapping one opens the food sheet
 * through `onOpen`.
 */
export function FotoView({
  date,
  kind,
  onOpen,
}: {
  date: string;
  kind: FoodKindFilter;
  onOpen: (item: FoodItem) => void;
}) {
  const { t } = useTranslation("makan");
  const today = jakartaToday();
  const [span, setSpan] = useState<Span>("minggu");
  const [anchor, setAnchor] = useState(date);
  const [from, to] = span === "minggu" ? weekRange(anchor) : monthRange(anchor.slice(0, 7));
  const query = useQuery({
    ...orpc.diary.stickers.queryOptions({ input: { from, to, kind } }),
    staleTime: 0,
    placeholderData: (previous) => previous,
  });
  const items = query.data?.items ?? [];
  const averageKcal =
    items.length > 0 ? Math.round(items.reduce((sum, item) => sum + item.kcal, 0) / items.length) : null;
  const title =
    span === "minggu"
      ? t("photos.range", { from: dayMonth(from), to: dayMonth(to) })
      : fmtDate(`${anchor.slice(0, 7)}-01`, "month");
  const step = (direction: 1 | -1) =>
    setAnchor(
      span === "minggu"
        ? shiftDate(anchor, 7 * direction)
        : `${shiftMonth(anchor.slice(0, 7), direction)}-01`,
    );

  return (
    <div className="mt-4">
      <Segmented
        label={t("photos.span.label")}
        value={span}
        onChange={setSpan}
        options={SPANS.map((value) => ({ value, label: t(`photos.span.${value}`) }))}
      />
      <div className="mt-4 flex items-end justify-between gap-3 px-1">
        <div className="min-w-0">
          <h2 className="text-xl font-extrabold tracking-tight">{title}</h2>
          <p className="text-sm text-muted-foreground tabular-nums">
            {t("photos.count", { count: items.length, n: fmtInt(items.length) })}
            {averageKcal !== null && (
              <>
                {" · "}
                {t("photos.average", { kcal: fmtKcalLabel(averageKcal) })}
              </>
            )}
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          <button
            type="button"
            aria-label={t(span === "minggu" ? "photos.prevWeek" : "photos.prevMonth")}
            onClick={() => step(-1)}
            className={arrowClass}
          >
            <ChevronLeft className="size-5" aria-hidden />
          </button>
          <button
            type="button"
            aria-label={t(span === "minggu" ? "photos.nextWeek" : "photos.nextMonth")}
            disabled={to >= today}
            onClick={() => step(1)}
            className={arrowClass}
          >
            <ChevronRight className="size-5" aria-hidden />
          </button>
        </div>
      </div>

      {items.length > 0 ? (
        <ul className="mt-3 grid grid-cols-2 gap-2.5">
          {items.map((item) => (
            <FotoTile key={item.id} item={item} onOpen={onOpen} />
          ))}
        </ul>
      ) : (
        <div className="mt-3 rounded-3xl bg-card p-6 text-center">
          <Mascot pose="ready" size="md" className="mb-3" />
          <p className="text-base font-bold">
            {query.isPending ? t("photos.loading") : t("photos.empty.title")}
          </p>
          {!query.isPending && (
            <p className="mx-auto mt-1 max-w-xs text-sm text-muted-foreground">
              {t("photos.empty.body")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
