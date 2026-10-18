// Daily cap of coach chat messages: counted from the ai_usage ledger (scan_type 'coach', WIB day), like the
// correction cap in correct-limit.ts. Every call that reached the model leaves a row, answer or not.

import { and, between, eq, sql } from "drizzle-orm";

import type { Database } from "@joyorogo/db";
import { aiUsage } from "@joyorogo/db/schema/fitness";

import { jakartaToday } from "./engine";
import { wibDayBounds } from "./tiers";

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

export async function coachUsedToday(db: Database, userId: string): Promise<number> {
  const { startMs, endMs } = wibDayBounds(jakartaToday());
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
