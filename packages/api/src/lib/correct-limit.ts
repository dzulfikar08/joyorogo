// Rate limit for ai.correctScan. Corrections never touch the daily scan quota
// (requireAiQuota), so they get their own ledger rows (ai_usage scan_type
// "correction", the photo id in usage_json) and two caps: per scan session and
// per user per WIB day. Every call that reached the AI leaves a row, whatever
// it answered, so a stream of unclear corrections cannot run free.
import { and, between, eq, sql } from "drizzle-orm";
import { ORPCError } from "@orpc/server";

import type { Database } from "@joyorogo/db";
import type { Locale } from "@joyorogo/i18n";
import { aiUsage } from "@joyorogo/db/schema/fitness";

import { jakartaToday } from "./engine";
import { serverT } from "./messages";
import { MAX_CORRECTIONS_PER_DAY, MAX_CORRECTIONS_PER_SCAN } from "./scan-correct";
import { wibDayBounds } from "./tiers";

export type CorrectionsUsed = { today: number; scan: number };

export async function correctionsUsed(
  db: Database,
  userId: string,
  photoId: string | undefined,
): Promise<CorrectionsUsed> {
  const { startMs, endMs } = wibDayBounds(jakartaToday());
  const [row] = await db
    .select({
      today: sql<number>`count(*)`,
      scan: sql<number>`coalesce(sum(case when json_extract(${aiUsage.usageJson}, '$.photoId') = ${photoId ?? null} then 1 else 0 end), 0)`,
    })
    .from(aiUsage)
    .where(
      and(
        eq(aiUsage.userId, userId),
        eq(aiUsage.scanType, "correction"),
        between(aiUsage.createdAt, new Date(startMs), new Date(endMs)),
      ),
    );
  return { today: row?.today ?? 0, scan: row?.scan ?? 0 };
}

/**
 * Throws TOO_MANY_REQUESTS when this call would pass a cap. The per-scan count
 * only covers corrections made today; the scan photo itself expires after two
 * days, so a scan cannot outlive it by much.
 */
export function assertCorrectionAllowed(used: CorrectionsUsed, locale: Locale): void {
  const t = serverT(locale, "scan");
  if (used.scan >= MAX_CORRECTIONS_PER_SCAN) {
    throw new ORPCError("TOO_MANY_REQUESTS", {
      message: t("correct.error.scanLimit", { count: MAX_CORRECTIONS_PER_SCAN }),
      data: { correctionsExhausted: "scan" },
    });
  }
  if (used.today >= MAX_CORRECTIONS_PER_DAY) {
    throw new ORPCError("TOO_MANY_REQUESTS", {
      message: t("correct.error.dayLimit"),
      data: { correctionsExhausted: "day" },
    });
  }
}

/** Corrections this scan session may still make after the call that was just allowed. */
export function correctionsLeft(used: CorrectionsUsed): number {
  return Math.max(0, MAX_CORRECTIONS_PER_SCAN - used.scan - 1);
}
