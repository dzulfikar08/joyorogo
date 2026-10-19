import {
  BEST_EFFORT_DISTANCES,
  type AnalysisComparison,
  type AnalysisComparisonItem,
  type AnalysisSeries,
  type BestEffortKey,
  type SportKind,
  axisValue,
  formatPace,
} from "@joyorogo/api/lib/workout-analysis";

/** Pure helpers behind the analysis cards: units, chart scales, wording thresholds. */

/** Runs and walks read as pace per km; rides as km/h; everything else as neither. */
export function paceMode(kind: SportKind): "pace" | "speed" | null {
  if (kind === "run" || kind === "walk") return "pace";
  if (kind === "ride") return "speed";
  return null;
}

export function speedKmh(paceSecKm: number): number {
  return 3600 / paceSecKm;
}

/** `5:32` for pace sports, `24.5` for rides; `--` when unknown. */
export function formatPaceOrSpeed(kind: SportKind, paceSecKm: number | null | undefined): string {
  if (paceSecKm === null || paceSecKm === undefined || !(paceSecKm > 0)) return "--";
  return paceMode(kind) === "speed" ? speedKmh(paceSecKm).toFixed(1) : formatPace(paceSecKm);
}

export type ChartMetric = "pace" | "hr" | "alt" | "cad" | "power";

/** The metrics the series actually carries, in toggle order. Pace only for pace/speed sports. */
export function availableMetrics(series: AnalysisSeries, kind: SportKind): ChartMetric[] {
  const has = (values: (number | null)[] | null) => !!values && values.some((v) => v !== null);
  const out: ChartMetric[] = [];
  if (paceMode(kind) && has(series.pace)) out.push("pace");
  if (has(series.hr)) out.push("hr");
  if (has(series.alt)) out.push("alt");
  if (has(series.cad)) out.push("cad");
  if (has(series.power)) out.push("power");
  return out;
}

/** Raw values of one chart metric on the grid; pace becomes km/h for rides. */
export function metricValues(
  series: AnalysisSeries,
  metric: ChartMetric,
  kind: SportKind,
): (number | null)[] {
  const source = series[metric];
  if (!source) return Array.from({ length: series.n }, () => null);
  if (metric === "pace" && paceMode(kind) === "speed") {
    return source.map((v) => (v !== null && v > 0 ? speedKmh(v) : null));
  }
  return source;
}

function percentile(sorted: number[], p: number): number {
  const at = (sorted.length - 1) * p;
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (at - lo);
}

/**
 * The y range of a metric. Pace and speed ignore the outer 3 percent of samples so a stop or a GPS
 * spike cannot flatten the line; everything else spans min to max. Always non-degenerate.
 */
export function valueDomain(values: (number | null)[], metric: ChartMetric): [number, number] {
  const present = values.filter((v): v is number => v !== null && Number.isFinite(v));
  if (present.length === 0) return [0, 1];
  const sorted = [...present].sort((a, b) => a - b);
  const clipped = metric === "pace";
  let lo = clipped ? percentile(sorted, 0.03) : sorted[0]!;
  let hi = clipped ? percentile(sorted, 0.97) : sorted[sorted.length - 1]!;
  const minSpan = metric === "hr" ? 10 : metric === "alt" ? 6 : 1;
  if (hi - lo < minSpan) {
    const mid = (hi + lo) / 2;
    lo = mid - minSpan / 2;
    hi = mid + minSpan / 2;
  }
  const pad = (hi - lo) * 0.08;
  return [lo - pad, hi + pad];
}

/** Round tick values inside [lo, hi], about `count` of them. */
export function niceTicks(lo: number, hi: number, count: number): number[] {
  const span = hi - lo;
  if (!(span > 0) || count < 1) return [];
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const ticks: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) {
    ticks.push(Math.round(v / step) * step);
  }
  return ticks;
}

const TIME_STEPS_SEC = [30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 14400];
const DIST_STEPS_M = [100, 200, 500, 1000, 2000, 2500, 5000, 10000, 20000];

/** X ticks on the shared axis (metres with distance, seconds without) with a short label. */
export function axisTicks(series: AnalysisSeries, maxCount = 5): { x: number; label: string }[] {
  const end = axisValue(series, series.n - 1);
  if (!(end > 0)) return [];
  const steps = series.dist ? DIST_STEPS_M : TIME_STEPS_SEC;
  const step = steps.find((s) => end / s <= maxCount) ?? steps[steps.length - 1]!;
  const out: { x: number; label: string }[] = [];
  for (let x = step; x <= end + 1e-6; x += step) {
    out.push({
      x,
      label: series.dist ? `${Number((x / 1000).toFixed(1))}` : `${Math.round(x / 60)}`,
    });
  }
  return out;
}

/** SVG path data for a series with gaps: `M` restarts after every null. */
export function linePath(points: ({ x: number; y: number } | null)[]): string {
  let d = "";
  let pen = false;
  for (const p of points) {
    if (!p) {
      pen = false;
      continue;
    }
    d += `${pen ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
    pen = true;
  }
  return d;
}

/** Filled-area path under a gappy line, closed down to `baseY` per uninterrupted stretch. */
export function areaPath(points: ({ x: number; y: number } | null)[], baseY: number): string {
  let d = "";
  let run: { x: number; y: number }[] = [];
  const flush = () => {
    if (run.length > 1) {
      d += `M${run[0]!.x.toFixed(1)} ${baseY.toFixed(1)}`;
      for (const p of run) d += `L${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
      d += `L${run[run.length - 1]!.x.toFixed(1)} ${baseY.toFixed(1)}Z`;
    }
    run = [];
  };
  for (const p of points) {
    if (p) run.push(p);
    else flush();
  }
  flush();
  return d;
}

/** Bar width in percent for a split: fastest fills the row, slowest keeps 40 percent. */
export function paceBarPercent(paceSecKm: number, fastest: number, slowest: number): number {
  if (!(slowest > fastest)) return 100;
  const t = Math.min(1, Math.max(0, (paceSecKm - fastest) / (slowest - fastest)));
  return 100 - 60 * t;
}

export type LoadWording = "under" | "steady" | "high" | "spike";

/** Acute to chronic ratio bands: under 0.8, 0.8-1.3, 1.3-1.5, above 1.5. */
export function loadWording(ratio: number): LoadWording {
  if (ratio < 0.8) return "under";
  if (ratio <= 1.3) return "steady";
  if (ratio <= 1.5) return "high";
  return "spike";
}

/** Percent of a total, rounded; 0 for an empty total. */
export function percentOf(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

/** Pace of a best effort in seconds per km. */
export function effortPace(key: BestEffortKey, sec: number): number {
  return sec / (BEST_EFFORT_DISTANCES[key] / 1000);
}

export interface ComparisonDelta {
  /** Negative = this workout was faster (seconds per km) or lower. */
  paceSecKm: number | null;
  hrBpm: number | null;
}

function mean(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
}

/** This workout against the previous similar one and against the average of all of them. */
export function comparisonDeltas(
  current: { paceSecKm: number | null; avgHr: number | null },
  comparison: AnalysisComparison,
): { previous: ComparisonDelta | null; average: ComparisonDelta | null } {
  const diff = (against: { paceSecKm: number | null; avgHr: number | null }): ComparisonDelta => ({
    paceSecKm:
      current.paceSecKm !== null && against.paceSecKm !== null
        ? current.paceSecKm - against.paceSecKm
        : null,
    hrBpm: current.avgHr !== null && against.avgHr !== null ? current.avgHr - against.avgHr : null,
  });
  const items: AnalysisComparisonItem[] = comparison.items;
  if (items.length === 0) return { previous: null, average: null };
  const average = {
    paceSecKm: mean(items.flatMap((i) => (i.paceSecKm !== null ? [i.paceSecKm] : []))),
    avgHr: mean(items.flatMap((i) => (i.avgHr !== null ? [i.avgHr] : []))),
  };
  return { previous: diff(items[0]!), average: items.length > 1 ? diff(average) : null };
}

/** Nearest sample on a track to a position, by squared equirectangular distance; -1 for no track. */
export function nearestTrackIndex(
  track: ({ 0: number; 1: number } | null)[],
  lat: number,
  lon: number,
): number {
  const k = Math.cos((lat * Math.PI) / 180);
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < track.length; i++) {
    const p = track[i];
    if (!p) continue;
    const dy = p[0] - lat;
    const dx = (p[1] - lon) * k;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}
