import { and, between, eq, sql } from "drizzle-orm";

import { aiUsage } from "@joyorogo/db/schema/fitness";
import type { Database } from "@joyorogo/db";

export type Tier = "free" | "founder";

/** Paywall knobs, read from worker vars so every self-hoster picks their own. */
export type PaywallEnv = {
  FREE_DAILY_SCANS?: string;
  FOUNDER_DAILY_CAP?: string;
  ANON_SCANS?: string;
  FOUNDER_PRICE_IDR?: string;
};

export type PaywallConfig = {
  /** Daily AI scans for free users; null = no paywall (unlimited). */
  freeDailyScans: number | null;
  /** Cost-safety cap for founders; null = uncapped. */
  founderDailyCap: number | null;
  /** Anonymous landing-page scans per device; 0 turns the demo off. */
  anonScans: number;
  founderPriceIdr: number;
};

export const DEFAULT_ANON_SCANS = 2;
export const DEFAULT_FOUNDER_PRICE_IDR = 15_000;

function parseCount(name: string, raw: string | undefined): number | null {
  const value = raw?.trim();
  if (!value) return null;
  if (!/^\d+$/.test(value)) {
    // Loud on purpose: a typo must not silently mean "unlimited".
    throw new Error(`${name} must be a whole number >= 0, got "${raw}"`);
  }
  return Number(value);
}

export function paywallConfig(env: PaywallEnv): PaywallConfig {
  const price = parseCount("FOUNDER_PRICE_IDR", env.FOUNDER_PRICE_IDR);
  if (price === 0) throw new Error("FOUNDER_PRICE_IDR must be > 0");
  return {
    freeDailyScans: parseCount("FREE_DAILY_SCANS", env.FREE_DAILY_SCANS),
    founderDailyCap: parseCount("FOUNDER_DAILY_CAP", env.FOUNDER_DAILY_CAP),
    anonScans: parseCount("ANON_SCANS", env.ANON_SCANS) ?? DEFAULT_ANON_SCANS,
    founderPriceIdr: price ?? DEFAULT_FOUNDER_PRICE_IDR,
  };
}

/** Free users are limited only when FREE_DAILY_SCANS is set. */
export function paywallEnabled(config: PaywallConfig): boolean {
  return config.freeDailyScans !== null;
}

/** Today's scan allowance; null = unlimited. */
export function dailyScanQuota(tier: Tier, config: PaywallConfig): number | null {
  return tier === "founder" ? config.founderDailyCap : config.freeDailyScans;
}

/**
 * Founder while a paid period runs. `tier = 'founder'` stays a manual comp
 * (owner, early supporters) that never expires.
 */
export function effectiveTier(
  row: { tier: Tier; founderUntil: Date | null } | undefined,
  now = new Date(),
): Tier {
  if (!row) return "free";
  if (row.tier === "founder") return "founder";
  return row.founderUntil && row.founderUntil.getTime() > now.getTime() ? "founder" : "free";
}

/** Same day next month, clamped to month end (31 Jan -> 28/29 Feb). */
export function addOneMonth(date: Date): Date {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const out = new Date(date);
  out.setUTCDate(1);
  out.setUTCMonth(m);
  out.setUTCDate(Math.min(date.getUTCDate(), lastDay));
  return out;
}

/** A paid month stacks on an active period, or starts now if lapsed. */
export function nextFounderUntil(current: Date | null, now = new Date()): Date {
  const base = current && current.getTime() > now.getTime() ? current : now;
  return addOneMonth(base);
}

/** Epoch-ms window of one WIB calendar day ('YYYY-MM-DD', UTC+7, no DST). */
export function wibDayBounds(wibDay: string): { startMs: number; endMs: number } {
  const startMs = Date.parse(`${wibDay}T00:00:00+07:00`);
  return { startMs, endMs: startMs + 24 * 60 * 60 * 1000 };
}

/** Successful user scans billed against today's quota, from the ai_usage ledger. */
export async function scansUsedToday(
  db: Database,
  userId: string,
  wibDay: string,
): Promise<number> {
  const { startMs, endMs } = wibDayBounds(wibDay);
  const [row] = await db
    .select({ used: sql<number>`count(*)` })
    .from(aiUsage)
    .where(
      and(
        eq(aiUsage.userId, userId),
        eq(aiUsage.scanType, "user"),
        between(aiUsage.createdAt, new Date(startMs), new Date(endMs)),
      ),
    );
  return row?.used ?? 0;
}
