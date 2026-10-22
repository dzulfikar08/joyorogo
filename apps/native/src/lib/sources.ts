/** The places JoyoRogo's numbers come from, in the order the sources screen lists them. */
export const SOURCE_IDS = ["joyofit", "health", "strava", "scale", "manual"] as const;
export type SourceId = (typeof SOURCE_IDS)[number];

export type SourceRow = {
  id: SourceId;
  /** data has come from it (or, for the health store and Strava, it is linked); manual entries are always possible */
  connected: boolean;
  /** epoch ms of the newest thing it delivered; for the health store, of the last import on this phone */
  lastAt: number | null;
  /** rows it delivered in the last 7 days (not for the health store: its import counts are in `HealthLastSync`) */
  recent: number;
  /** today's all-day activity figure comes from this source */
  usedToday: boolean;
};

export type SourcesInput = {
  health: { connected: boolean; lastAt: number | null } | null;
  strava: { connected: boolean } | null;
  /** workouts of the last 30 days; `at` is when the row reached JoyoRogo */
  exercise: ReadonlyArray<{ source: string; date: string; at: number }>;
  /** weigh-ins; `at` is when the row reached JoyoRogo */
  weights: ReadonlyArray<{ source: string; date: string; at: number }>;
  /** the source of today's all-day activity figure (`day.summary.exerciseCredit.allDaySource`) */
  allDaySource: "joyofit" | "health_connect" | "apple_health" | null;
  /** first day of the "recent" window: 7 days including today */
  recentFrom: string;
};

function newest(rows: ReadonlyArray<{ at: number }>): number | null {
  return rows.length === 0 ? null : Math.max(...rows.map((row) => row.at));
}

/** One row per source, from the raw rows the screen already has: nothing is guessed, a source without data stays unconnected. */
export function buildSources(input: SourcesInput): SourceRow[] {
  const bySource = (source: string) => input.exercise.filter((row) => row.source === source);
  const recent = (rows: ReadonlyArray<{ date: string }>) =>
    rows.filter((row) => row.date >= input.recentFrom).length;
  const joyofit = bySource("joyofit");
  const strava = bySource("strava");
  const scale = input.weights.filter((row) => row.source === "scale");
  const manual = [...bySource("manual"), ...input.weights.filter((row) => row.source === "manual")];
  return [
    {
      id: "joyofit",
      connected: joyofit.length > 0 || input.allDaySource === "joyofit",
      lastAt: newest(joyofit),
      recent: recent(joyofit),
      usedToday: input.allDaySource === "joyofit",
    },
    {
      id: "health",
      connected: input.health?.connected ?? false,
      lastAt: input.health?.lastAt ?? null,
      recent: 0,
      usedToday: input.allDaySource === "health_connect" || input.allDaySource === "apple_health",
    },
    {
      id: "strava",
      connected: input.strava?.connected ?? false,
      lastAt: newest(strava),
      recent: recent(strava),
      usedToday: false,
    },
    {
      id: "scale",
      connected: scale.length > 0,
      lastAt: newest(scale),
      recent: recent(scale),
      usedToday: false,
    },
    {
      id: "manual",
      connected: true,
      lastAt: newest(manual),
      recent: recent(manual),
      usedToday: false,
    },
  ];
}

/** Whether an activity source is linked: what the setup checklist asks (the scale and manual entries are not one). */
export function hasActivitySource(rows: readonly SourceRow[]): boolean {
  return rows.some(
    (row) => (row.id === "joyofit" || row.id === "health" || row.id === "strava") && row.connected,
  );
}
