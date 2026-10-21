// Sleep per night with its stages, as `GET /v1/sleep` of the JoyoFit cloud API returns it (watch-fit server/src/sleep.ts), and the
// small pure helpers the Tidur page draws from. Times are unix seconds; the API groups sessions by wake-up day in the user zone.

export const STAGES = ["awake", "rem", "light", "deep", "asleep"] as const;
export type Stage = (typeof STAGES)[number];

export interface StagePeriod {
  start: number;
  end: number;
  stage: Stage;
}

export interface SleepNight {
  start: number;
  end: number;
  asleepSec: number;
  awakeSec: number;
  /** Seconds per stage; `asleep` is time recorded without a stage. */
  stages: Record<Stage, number>;
  hasStages: boolean;
  awakenings: number;
  periods: StagePeriod[];
}

export interface SleepNap {
  start: number;
  end: number;
  asleepSec: number;
}

export interface SleepDay {
  /** Day (user zone) the sessions ended on. */
  day: string;
  /** Night and naps together, overlaps once. */
  asleepSec: number;
  napSec: number;
  night: SleepNight | null;
  naps: SleepNap[];
}

export interface SleepResponse {
  from: string;
  to: string;
  days: SleepDay[];
}

/** The stages a night actually has, in the order the chart stacks them from the top (awake) to the bottom (deep). */
export const CHART_ORDER = [
  "awake",
  "rem",
  "light",
  "deep",
  "asleep",
] as const satisfies readonly Stage[];

export function stagesPresent(night: SleepNight): Stage[] {
  return CHART_ORDER.filter((stage) => night.stages[stage] > 0);
}

/** Share of the night (asleep plus awake) a stage takes, 0 to 100. */
export function stageShare(night: SleepNight, stage: Stage): number {
  const total = night.asleepSec + night.awakeSec;
  return total > 0 ? (night.stages[stage] / total) * 100 : 0;
}

export interface StageAverages {
  nights: number;
  /** Average seconds per night, over the nights that have stages. */
  deep: number;
  rem: number;
  light: number;
  awake: number;
}

/** Averages over the nights the watch staged; null without any. A night with only `asleep` seconds says nothing about stages. */
export function averageStages(days: readonly SleepDay[]): StageAverages | null {
  const staged = days.flatMap((d) => (d.night?.hasStages ? [d.night] : []));
  if (staged.length === 0) return null;
  const mean = (stage: Stage) =>
    staged.reduce((sum, n) => sum + n.stages[stage], 0) / staged.length;
  return {
    nights: staged.length,
    deep: mean("deep"),
    rem: mean("rem"),
    light: mean("light"),
    awake: mean("awake"),
  };
}

export interface HypnogramBar {
  stage: Stage;
  /** 0 to 1 along the night. */
  x: number;
  width: number;
  /** Row index among the stages present, 0 at the top. */
  row: number;
}

/** The bars of a night's stage chart: one per period, positioned along the night and on the row of its stage. */
export function hypnogram(night: SleepNight): { bars: HypnogramBar[]; rows: Stage[] } {
  const rows = stagesPresent(night);
  const span = Math.max(1, night.end - night.start);
  const bars = night.periods
    .filter((p) => p.end > p.start)
    .map((p) => ({
      stage: p.stage,
      x: (p.start - night.start) / span,
      width: (p.end - p.start) / span,
      row: rows.indexOf(p.stage),
    }))
    .filter((bar) => bar.row >= 0);
  return { bars, rows };
}
