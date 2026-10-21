// Daily cap of coach chat messages: counted from the ai_usage ledger (scan_type 'coach', local day), like the
// correction cap in correct-limit.ts. Every call that reached the model leaves a row, answer or not.

import { and, between, eq, sql } from "drizzle-orm";

import type { Database } from "@joyorogo/db";
import type { DayZone } from "@joyorogo/i18n";
import { aiUsage } from "@joyorogo/db/schema/fitness";

import { jakartaToday } from "./engine";
import { dayBounds } from "./tiers";

export const DEFAULT_COACH_DAILY_CAP = 20;
const MAX_COACH_DAILY_CAP = 1000;

/** `COACH_DAILY_CAP`: unset or garbage = 20, "0" = the feature is off. */
export function coachDailyCap(env: { COACH_DAILY_CAP?: string }): number {
  const raw = env.COACH_DAILY_CAP?.trim();
  if (!raw) return DEFAULT_COACH_DAILY_CAP;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) return DEFAULT_COACH_DAILY_CAP;
  return Math.min(n, MAX_COACH_DAILY_CAP);
}

export async function coachUsedToday(db: Database, userId: string, zone: DayZone): Promise<number> {
  const { startMs, endMs } = dayBounds(jakartaToday(undefined, zone), zone);
  const [row] = await db
    .select({ used: sql<number>`count(*)` })
    .from(aiUsage)
    .where(
      and(
        eq(aiUsage.userId, userId),
        eq(aiUsage.scanType, "coach"),
        between(aiUsage.createdAt, new Date(startMs), new Date(endMs)),
      ),
    );
  return row?.used ?? 0;
}

/**
 * Takes one of today's slots BEFORE the model is called. The check and the insert are one statement
 * (`INSERT ... SELECT ... WHERE count < cap`), so concurrent calls cannot all read "under the cap" and then all run: the
 * database serializes the statements and only the first `cap` of them insert a row. Returns the reserved row's id, or null
 * when the day is full. The row counts from this moment whatever the model does (the cap counts every call that reached the
 * model, answer or not); {@link settleCoachSlot} fills in what happened.
 */
export async function reserveCoachSlot(db: Database, userId: string, cap: number, model: string, zone: DayZone): Promise<string | null> {
  const { startMs, endMs } = dayBounds(jakartaToday(undefined, zone), zone);
  const id = crypto.randomUUID();
  const pending = JSON.stringify({ kind: "coach", outcome: "pending" });
  const rows = await db.all<{ id: string }>(sql`
    INSERT INTO ai_usage (id, user_id, model, scan_type, latency_ms, usage_json, created_at)
    SELECT ${id}, ${userId}, ${model}, 'coach', 0, ${pending}, ${Date.now()}
    WHERE (
      SELECT count(*) FROM ai_usage
      WHERE user_id = ${userId} AND scan_type = 'coach' AND created_at BETWEEN ${startMs} AND ${endMs}
    ) < ${cap}
    RETURNING id
  `);
  return rows.length === 1 ? id : null;
}

/** Records how a reserved call went (latency, outcome, token usage). The slot stays taken even if this never runs. */
export async function settleCoachSlot(
  db: Database,
  id: string,
  result: { latencyMs: number; outcome: string; turns: number; usage: Record<string, unknown> | null },
): Promise<void> {
  await db
    .update(aiUsage)
    .set({
      latencyMs: result.latencyMs,
      usageJson: JSON.stringify({ kind: "coach", outcome: result.outcome, turns: result.turns, ...(result.usage ? { usage: result.usage } : {}) }),
    })
    .where(eq(aiUsage.id, id));
}
