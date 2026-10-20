import { sql, type SQL } from "drizzle-orm";

import { jakartaToday } from "@joyorogo/api/lib/engine";
import { wibDayBounds } from "@joyorogo/api/lib/tiers";

/**
 * What the console calls a "scan": one `ai_usage` row with `scan_type = 'user'`,
 * the same ledger that bills the free daily quota (tiers.scansUsedToday). A user
 * scan is written for every successful food analysis of a signed-in user (photo,
 * typed or spoken story), for free and paid accounts alike; "retry",
 * "correction", "label", "coach", "recap", "failed" and anon rows are not scans.
 * Days are Jakarta days (UTC+7), like every other day in the app.
 */
export const DAY_MS = 24 * 60 * 60 * 1000;
/** The streak looks back this many Jakarta days (today included); longer runs show as the cap. */
export const STREAK_WINDOW_DAYS = 60;
/** Selectable "not scanning for N days" windows of the users filter. */
export const IDLE_DAYS = ["1", "3", "7"] as const;

/**
 * An integer inlined into the SQL text. D1 allows 100 bound parameters per
 * statement and the users list already spends up to 100 on its id list, so the
 * server-computed constants of these fragments (never user input) stay out of
 * the parameter list.
 */
export const intSql = (n: number) => sql.raw(String(Math.trunc(n)));

/** Correlated subqueries must name the outer table: a bare column ref would resolve to the inner FROM. */
const uid = sql.raw(`"user"."id"`);
const tierCol = sql.raw(`"user"."tier"`);
const founderUntilCol = sql.raw(`"user"."founder_until"`);

/** Per-user scan activity as SQL fragments, all anchored to one instant. */
export interface ScanSql {
  /** The Jakarta day the fragments treat as today (YYYY-MM-DD). */
  today: string;
  scansToday: SQL<number>;
  scansYesterday: SQL<number>;
  /** Newest user scan (ms), null if the user never scanned. */
  lastScanAt: SQL<number | null>;
  /**
   * Consecutive Jakarta days with >=1 scan, ending today, or yesterday while
   * today has none yet; 0 when neither has a scan. One index probe per day of
   * the run (ai_usage_user_created_idx), capped at STREAK_WINDOW_DAYS.
   */
  streak: SQL<number>;
  /** 1 when the user scanned yesterday / today. */
  activeYesterday: SQL;
  activeToday: SQL;
  /** An active paid period wins over a manual comp, which wins over free. */
  plan: SQL<"paid" | "founder" | "free">;
  /** No scan today and none in the `days` Jakarta days before today (days=1: nothing yesterday or today). Never-scanned users qualify. */
  idleFor: (days: number) => SQL;
}

export function scanSql(now: number): ScanSql {
  const today = jakartaToday(new Date(now));
  const { startMs: todayStart } = wibDayBounds(today);
  const dayStart = intSql(todayStart);
  const dayMs = intSql(DAY_MS);

  /** True when the user has a scan inside the Jakarta day `daysAgo` days back (a number or an SQL expression). */
  const scannedOn = (daysAgo: number | SQL) => {
    const n = typeof daysAgo === "number" ? intSql(daysAgo) : daysAgo;
    return sql`exists (select 1 from ai_usage where ai_usage.user_id = ${uid} and ai_usage.scan_type = 'user' and ai_usage.created_at >= ${dayStart} - (${n}) * ${dayMs} and ai_usage.created_at < ${dayStart} - (${n}) * ${dayMs} + ${dayMs})`;
  };

  const scansOn = (daysAgo: number) =>
    sql<number>`(select count(*) from ai_usage where ai_usage.user_id = ${uid} and ai_usage.scan_type = 'user' and ai_usage.created_at >= ${intSql(todayStart - daysAgo * DAY_MS)} and ai_usage.created_at < ${intSql(todayStart - (daysAgo - 1) * DAY_MS)})`;

  const runK = sql.raw("run.k");
  return {
    today,
    scansToday: scansOn(0),
    scansYesterday: scansOn(1),
    lastScanAt: sql<number | null>`(select max(ai_usage.created_at) from ai_usage where ai_usage.user_id = ${uid} and ai_usage.scan_type = 'user')`,
    streak: sql<number>`(with recursive run(k, n) as (
      select 0, 1 where ${scannedOn(0)}
      union all select 1, 1 where not ${scannedOn(0)} and ${scannedOn(1)}
      union all select run.k + 1, run.n + 1 from run where run.n < ${intSql(STREAK_WINDOW_DAYS)} and ${scannedOn(sql`${runK} + 1`)}
    ) select coalesce(max(n), 0) from run)`,
    activeYesterday: scannedOn(1),
    activeToday: scannedOn(0),
    plan: sql<"paid" | "founder" | "free">`case when ${founderUntilCol} > ${intSql(now)} then 'paid' when ${tierCol} = 'founder' then 'founder' else 'free' end`,
    idleFor: (days) =>
      sql`not exists (select 1 from ai_usage where ai_usage.user_id = ${uid} and ai_usage.scan_type = 'user' and ai_usage.created_at >= ${intSql(todayStart - days * DAY_MS)})`,
  };
}
