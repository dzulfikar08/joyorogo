// Shadow test of a prompt variant on live scans. A sample of first scans is
// answered a second time with SHADOW_VARIANT (dish-identity rule, temperature
// 0.1) after the user's response is out. The answer is stored in the scan's
// ai_usage session (`shadow`, see scan-outcome.ts) and nowhere else, so the
// daily accuracy digest can ask: when the user saved or corrected the scan,
// was the shadow closer to what they saved than production was?
//
// Isolation: runs inside waitUntil after the response, writes no ledger row (the
// daily quota counts those), never throws, and never touches the scan's result.
// Cost: one extra vision call per sampled scan.
import { and, gte, sql } from "drizzle-orm";
import type { Database } from "@joyorogo/db";
import { aiUsage } from "@joyorogo/db/schema/fitness";
import type { Locale } from "@joyorogo/i18n";
import { jakartaToday } from "./engine";
import { compactItems, recordSessionShadow } from "./scan-outcome";
import type { ShadowRun } from "./scan-outcome";
import { wibDayBounds } from "./tiers";
import { analyzeFoodPhoto, SHADOW_VARIANT, VisionError } from "./vision";
import type { AiRunner } from "./vision";

/** Share of first scans that also run the shadow variant when SHADOW_SAMPLE_RATE is unset. */
export const DEFAULT_SHADOW_RATE = 0.2;
/** Most shadow runs per WIB day when SHADOW_DAILY_CAP is unset. */
export const DEFAULT_SHADOW_DAILY_CAP = 60;

export type ShadowEnv = {
  /** 0..1 share of first scans to shadow; "0" turns the test off. Unset or unreadable = DEFAULT_SHADOW_RATE. */
  SHADOW_SAMPLE_RATE?: string;
  /** Most shadow runs per WIB day. Unset or unreadable = DEFAULT_SHADOW_DAILY_CAP. */
  SHADOW_DAILY_CAP?: string;
};

function number(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export function shadowRate(env: ShadowEnv): number {
  const value = number(env.SHADOW_SAMPLE_RATE);
  return value === null ? DEFAULT_SHADOW_RATE : Math.min(1, Math.max(0, value));
}

export function shadowDailyCap(env: ShadowEnv): number {
  const value = number(env.SHADOW_DAILY_CAP);
  return value === null ? DEFAULT_SHADOW_DAILY_CAP : Math.max(0, Math.floor(value));
}

/** Whether this scan is in the sample. `random` is injectable for tests. */
export function sampledForShadow(env: ShadowEnv, random: () => number = Math.random): boolean {
  return random() < shadowRate(env);
}

/** Shadow answers stored today (WIB on purpose: one global budget for everyone, not a per-user day), counted from the ledger sessions. */
async function shadowsToday(db: Database): Promise<number> {
  const { startMs } = wibDayBounds(jakartaToday());
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(aiUsage)
    .where(
      and(
        gte(aiUsage.createdAt, new Date(startMs)),
        sql`json_extract(${aiUsage.usageJson}, '$.shadow') is not null`,
      ),
    );
  return row?.n ?? 0;
}

export type ShadowScanInput = {
  db: Database;
  ai: AiRunner;
  userId: string;
  photoId: string;
  imageBase64: string;
  mimeType: string;
  model?: string;
  locale: Locale;
  /** Settles (true = row written) when the scan's ledger row insert finished: the shadow answer is patched into that row. */
  ledgerReady: Promise<boolean>;
  dailyCap: number;
};

/**
 * Runs the shadow variant for one scan and stores its answer in the scan's
 * session. Resolves to what happened; never rejects.
 */
export async function runShadowScan(input: ShadowScanInput): Promise<"stored" | "skipped" | "failed"> {
  try {
    if (!(await input.ledgerReady)) return "skipped";
    if ((await shadowsToday(input.db)) >= input.dailyCap) return "skipped";
    const startedAt = Date.now();
    let run: ShadowRun;
    try {
      const analysis = await analyzeFoodPhoto(input.ai, {
        imageBase64: input.imageBase64,
        mimeType: input.mimeType,
        model: input.model,
        locale: input.locale,
        promptTransform: SHADOW_VARIANT.promptTransform,
        temperature: SHADOW_VARIANT.temperature,
      });
      run = {
        variant: SHADOW_VARIANT.id,
        at: Date.now(),
        ms: Date.now() - startedAt,
        model: analysis.model,
        items: compactItems(analysis.items),
      };
    } catch (error) {
      run = {
        variant: SHADOW_VARIANT.id,
        at: Date.now(),
        ms: Date.now() - startedAt,
        error: error instanceof VisionError ? error.reason : "error",
      };
    }
    await recordSessionShadow(input.db, input.userId, input.photoId, run);
    return run.error === undefined ? "stored" : "failed";
  } catch (error) {
    console.error("[shadow] failed", error);
    return "failed";
  }
}
