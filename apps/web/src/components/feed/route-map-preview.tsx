import { feedMapPoints, projectRoute, svgPathData } from "@joyorogo/api/lib/feed-route";
import { cn } from "@joyorogo/ui/lib/utils";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

const ROUTE_COLOR = "#ff5a1f";
const START_COLOR = "#22a35a";

/** viewBox per size; the SVG scales to the width of its box, no resize listeners. */
const BOX = {
  card: { w: 320, h: 160, pad: 20 },
  detail: { w: 320, h: 240, pad: 32 },
} as const;

const GRID_BG =
  "[background-image:linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] [background-size:24px_24px]";

/**
 * Route of a workout post as a plain SVG polyline on a faint grid: no tiles, no network. `line` is the shared
 * (already trimmed and simplified) encoded polyline from the server.
 */
export function RouteMapPreview({
  line,
  title,
  size,
  className,
}: {
  line: string;
  title: string;
  size: "card" | "detail";
  className?: string;
}) {
  const { t } = useTranslation("feed");
  const { w, h, pad } = BOX[size];
  const projected = useMemo(() => {
    const points = feedMapPoints(line);
    return points ? projectRoute(points, w, h, pad)?.points ?? null : null;
  }, [line, w, h, pad]);
  if (!projected) return null;

  const path = svgPathData(projected);
  const start = projected[0]!;
  const finish = projected[projected.length - 1]!;
  const detail = size === "detail";
  const strokeWidth = detail ? 5 : 4;
  const dot = detail ? 7 : 6;

  return (
    <figure className={cn("m-0", className)}>
      <div
        role="img"
        aria-label={t("watch.map.alt", { title })}
        className={cn(
          "relative w-full overflow-hidden rounded-2xl bg-muted",
          GRID_BG,
          detail ? "aspect-[4/3] min-h-[260px]" : "aspect-[2/1] max-h-40",
        )}
      >
        <svg
          viewBox={`0 0 ${w} ${h}`}
          preserveAspectRatio="xMidYMid meet"
          className="absolute inset-0 size-full"
          aria-hidden
        >
          <path
            d={path}
            fill="none"
            strokeWidth={strokeWidth + 4}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="stroke-background"
            strokeOpacity={0.85}
          />
          <path
            d={path}
            fill="none"
            stroke={ROUTE_COLOR}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle
            cx={start[0]}
            cy={start[1]}
            r={dot}
            fill={START_COLOR}
            className="stroke-background"
            strokeWidth={2.5}
          />
          <circle
            cx={finish[0]}
            cy={finish[1]}
            r={dot}
            className="fill-foreground stroke-background"
            strokeWidth={2.5}
          />
        </svg>
        {detail && (
          <ul className="absolute bottom-3 left-3 flex gap-2 text-[0.6875rem] font-bold">
            <li className="flex items-center gap-1.5 rounded-full bg-background/85 px-2.5 py-1">
              <span className="size-2 rounded-full" style={{ backgroundColor: START_COLOR }} aria-hidden />
              {t("watch.map.start")}
            </li>
            <li className="flex items-center gap-1.5 rounded-full bg-background/85 px-2.5 py-1">
              <span className="size-2 rounded-full bg-foreground" aria-hidden />
              {t("watch.map.finish")}
            </li>
          </ul>
        )}
      </div>
      {detail && (
        <figcaption className="mt-2 px-1 text-xs text-muted-foreground">
          {t("watch.map.hint")}
        </figcaption>
      )}
    </figure>
  );
}
