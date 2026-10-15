import { monthLongLabel, monthRange, shiftMonth, weekRange } from "@joyorogo/api/lib/diary-view";
import { jakartaToday, shiftDate } from "@joyorogo/api/lib/engine";
import type { FoodKindFilter } from "@joyorogo/api/lib/food-kind";
import { shortDayLabel } from "@joyorogo/api/lib/format";
import { cn } from "@joyorogo/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Utensils } from "lucide-react";
import { useState } from "react";

import { Mascot } from "@/components/mascot";
import { Segmented } from "@/components/kit/surface";
import { stickerUrl, STICKER_FILTER } from "@/components/sticker";
import type { FoodItem } from "@/lib/api-types";
import { fmtInt } from "@/lib/format";
import { orpc } from "@/utils/orpc";

type Span = "minggu" | "bulan";

const SPANS = [
  { value: "minggu", label: "Minggu" },
  { value: "bulan", label: "Bulan" },
] as const;

/** Small fixed tilts so the grid reads like a sticker sheet, not a table. */
const TILTS = ["-rotate-2", "rotate-1", "rotate-2", "-rotate-1"] as const;

const arrowClass =
  "flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground transition-colors hover:bg-border hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-30";

function dayMonth(key: string): string {
  return shortDayLabel(key).split(", ")[1] ?? key;
}

function StickerTile({
  item,
  index,
  onOpen,
}: {
  item: FoodItem;
  index: number;
  onOpen: (item: FoodItem) => void;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(item)}
        aria-label={`${item.name}, ${fmtInt(item.kcal)} kcal, ${shortDayLabel(item.date)}`}
        className="flex w-full flex-col items-center gap-1 rounded-3xl bg-card p-2 pb-3 text-center transition-colors hover:bg-muted/60 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
      >
        <span className="grid aspect-square w-full place-items-center p-1">
          {failed ? (
            <span
              className="grid size-3/5 place-items-center rounded-2xl bg-makan-soft"
              aria-hidden
            >
              <Utensils className="size-6 text-makan-ink" />
            </span>
          ) : (
            <img
              src={stickerUrl(item.scanId as string)}
              alt=""
              loading="lazy"
              onError={() => setFailed(true)}
              className={cn("size-full object-contain", TILTS[index % TILTS.length])}
              style={STICKER_FILTER}
            />
          )}
        </span>
        <span className="line-clamp-2 w-full px-1 text-xs leading-tight font-bold">
          {item.name}
        </span>
        <span className="text-[0.6875rem] text-muted-foreground tabular-nums">
          {fmtInt(item.kcal)} kcal · {dayMonth(item.date)}
        </span>
      </button>
    </li>
  );
}

/**
 * Stiker view: the food cutouts of the viewed week or month as a sticker
 * book. Tapping one opens the food sheet through `onOpen`.
 */
export function StikerView({
  date,
  kind,
  onOpen,
}: {
  date: string;
  kind: FoodKindFilter;
  onOpen: (item: FoodItem) => void;
}) {
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
  const title =
    span === "minggu" ? `${dayMonth(from)} – ${dayMonth(to)}` : monthLongLabel(anchor.slice(0, 7));
  const step = (direction: 1 | -1) =>
    setAnchor(
      span === "minggu"
        ? shiftDate(anchor, 7 * direction)
        : `${shiftMonth(anchor.slice(0, 7), direction)}-01`,
    );

  return (
    <div className="mt-4">
      <Segmented label="Rentang stiker" value={span} onChange={setSpan} options={SPANS} />
      <div className="mt-4 flex items-end justify-between gap-3 px-1">
        <div className="min-w-0">
          <h2 className="text-xl font-extrabold tracking-tight">{title}</h2>
          <p className="text-sm text-muted-foreground">{fmtInt(items.length)} stiker</p>
        </div>
        <div className="flex shrink-0 gap-1">
          <button
            type="button"
            aria-label={span === "minggu" ? "Minggu sebelumnya" : "Bulan sebelumnya"}
            onClick={() => step(-1)}
            className={arrowClass}
          >
            <ChevronLeft className="size-5" aria-hidden />
          </button>
          <button
            type="button"
            aria-label={span === "minggu" ? "Minggu berikutnya" : "Bulan berikutnya"}
            disabled={to >= today}
            onClick={() => step(1)}
            className={arrowClass}
          >
            <ChevronRight className="size-5" aria-hidden />
          </button>
        </div>
      </div>

      {items.length > 0 ? (
        <ul className="mt-3 grid grid-cols-3 gap-2.5">
          {items.map((item, index) => (
            <StickerTile key={item.id} item={item} index={index} onOpen={onOpen} />
          ))}
        </ul>
      ) : (
        <div className="mt-3 rounded-3xl bg-card p-6 text-center">
          <Mascot pose="ready" size="md" className="mb-3" />
          <p className="text-base font-bold">
            {query.isPending ? "Menyusun stikermu..." : "Belum ada stiker"}
          </p>
          {!query.isPending && (
            <p className="mx-auto mt-1 max-w-xs text-sm text-muted-foreground">
              Foto piringmu lewat Pindai foto, nanti potongan makanannya muncul di sini.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
