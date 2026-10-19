import { useId } from "react";

// Inline SVG diagrams of the energy model for the public /panduan/kalori page. Colours come from the theme variables
// (Tailwind fill-/stroke- tokens), so light and dark both work. Every label is HTML next to the SVG: SVG text would
// shrink with the width and become unreadable at 360px. Each SVG scales with its container (viewBox, no fixed size).

/** One stacked bar: BMR + daily movement + TEF = TDEE. The legend (HTML) carries the numbers. */
export function TdeeStackedBar({
  bmr,
  move,
  tef,
  label,
}: {
  bmr: number;
  move: number;
  tef: number;
  label: string;
}) {
  const clip = useId();
  const W = 300;
  const total = bmr + move + tef;
  const w = (kcal: number) => (kcal / total) * W;
  return (
    <svg viewBox={`0 0 ${W} 44`} role="img" aria-label={label} className="h-auto w-full max-w-lg">
      <defs>
        <clipPath id={clip}>
          <rect width={W} height="44" rx="12" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clip})`}>
        <rect x="0" width={w(bmr)} height="44" className="fill-chart-1" />
        <rect x={w(bmr)} width={w(move)} height="44" className="fill-chart-2" />
        <rect x={w(bmr) + w(move)} width={w(tef)} height="44" className="fill-chart-3" />
      </g>
    </svg>
  );
}

export type BarRow = {
  key: string;
  /** shown left, above the bar */
  label: string;
  /** shown right, above the bar */
  value: string;
  kcal: number;
  /** the part of the bar drawn solid (e.g. the BMR inside a TDEE bar) */
  solidKcal?: number;
};

/** A horizontal bar per row, all on one scale. */
export function BarRows({ rows, label }: { rows: readonly BarRow[]; label: string }) {
  const max = Math.max(...rows.map((row) => row.kcal));
  const W = 300;
  return (
    <div role="img" aria-label={label} className="space-y-3">
      {rows.map((row) => (
        <div key={row.key}>
          <div className="flex items-baseline justify-between gap-3 text-xs">
            <span className="min-w-0 font-semibold">{row.label}</span>
            <span className="shrink-0 font-bold tabular-nums">{row.value}</span>
          </div>
          <svg viewBox={`0 0 ${W} 14`} aria-hidden className="mt-1 h-auto w-full">
            <rect width={W} height="14" rx="7" className="fill-muted" />
            <rect width={Math.max(14, (row.kcal / max) * W)} height="14" rx="7" className="fill-chart-2" />
            {row.solidKcal !== undefined && (
              <rect width={Math.max(14, (row.solidKcal / max) * W)} height="14" rx="7" className="fill-chart-1" />
            )}
          </svg>
        </div>
      ))}
    </div>
  );
}

export type CreditDay = {
  key: string;
  label: string;
  measuredKcal: number;
  /** "Terukur 700 kkal" */
  measuredText: string;
  /** "Tambah 164 kkal" or "Tidak menambah" */
  addedText: string;
};

/**
 * Three days of measured activity against the included-movement line: the part below the dashed line is already in the
 * person's factor and adds nothing, only the part above it counts. The bars sit at 1/6, 3/6 and 5/6 of the width, so a
 * 3-column grid of HTML captions underneath lines up with them.
 */
export function CreditDiagram({
  days,
  includedKcal,
  label,
}: {
  days: readonly [CreditDay, CreditDay, CreditDay];
  includedKcal: number;
  label: string;
}) {
  const W = 300;
  const H = 150;
  const top = 8;
  const base = H - 4;
  const max = Math.max(includedKcal * 1.05, ...days.map((day) => day.measuredKcal));
  const y = (kcal: number) => base - (kcal / max) * (base - top);
  const lineY = y(includedKcal);
  return (
    <div role="img" aria-label={label}>
      <svg viewBox={`0 0 ${W} ${H}`} aria-hidden className="h-auto w-full">
        <line x1="0" x2={W} y1={base} y2={base} className="stroke-border" strokeWidth="1" />
        {days.map((day, i) => {
          const x = W / 6 + (i * W) / 3 - 28;
          const below = Math.min(day.measuredKcal, includedKcal);
          const above = Math.max(0, day.measuredKcal - includedKcal);
          return (
            <g key={day.key}>
              <rect x={x} y={y(below)} width="56" height={base - y(below)} rx="4" className="fill-muted-foreground/35" />
              {above > 0 && (
                <rect x={x} y={y(day.measuredKcal)} width="56" height={y(includedKcal) - y(day.measuredKcal)} rx="4" className="fill-chart-1" />
              )}
            </g>
          );
        })}
        <line
          x1="0"
          x2={W}
          y1={lineY}
          y2={lineY}
          strokeDasharray="5 4"
          strokeWidth="1.5"
          className="stroke-foreground"
        />
      </svg>
      <div className="mt-2 grid grid-cols-3 gap-2 text-center">
        {days.map((day) => (
          <div key={day.key} className="min-w-0">
            <p className="text-xs font-bold">{day.label}</p>
            <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">{day.measuredText}</p>
            <p className="text-xs font-semibold tabular-nums">{day.addedText}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/** A coloured swatch for a legend entry, matching the diagram's fill. */
export function Swatch({ className }: { className: string }) {
  return <span aria-hidden className={`mt-1 inline-block size-3 shrink-0 rounded-sm ${className}`} />;
}
