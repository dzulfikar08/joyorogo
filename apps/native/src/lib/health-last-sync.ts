// When the last import from Health Connect / Apple Health finished on this phone, and what it brought in. The server
// only sees the rows, not the import, so "last sync" can only be remembered here (health-last-sync-store.ts).

export type HealthLastSync = {
  at: number;
  workoutsImported: number;
  workoutsSkipped: number;
  activityDays: number;
  sleepNights: number;
};

/** The stored record, or null when there is none or it is damaged. */
export function parseHealthLastSync(raw: string | null): HealthLastSync | null {
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return null;
    const row = value as Record<string, unknown>;
    const count = (key: string) =>
      typeof row[key] === "number" && Number.isFinite(row[key]) ? (row[key] as number) : null;
    const at = count("at");
    const workoutsImported = count("workoutsImported");
    const workoutsSkipped = count("workoutsSkipped");
    const activityDays = count("activityDays");
    const sleepNights = count("sleepNights");
    if (
      at === null ||
      workoutsImported === null ||
      workoutsSkipped === null ||
      activityDays === null ||
      sleepNights === null
    ) {
      return null;
    }
    return { at, workoutsImported, workoutsSkipped, activityDays, sleepNights };
  } catch {
    return null;
  }
}
