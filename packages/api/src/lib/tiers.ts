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
  /** Empty = 10x the monthly price. When set it applies to every ladder step. */
  FOUNDER_YEARLY_PRICE_IDR?: string;
  /**
   * Urgency ladder "buyers:monthlyIdr" steps, e.g. "10:15000,110:29000,:49000"
   * (first 10 buyers Rp15k, buyers 11-110 Rp29k, then Rp49k). The last step
   * may be open-ended (":49000"). Empty = flat FOUNDER_PRICE_IDR, no promo.
   */
  FOUNDER_PRICE_LADDER?: string;
};

/** One rung of the founder price ladder. */
export type LadderStep = {
  /** Cumulative buyers this price covers; null = open-ended (last step). */
  upToBuyers: number | null;
  monthlyIdr: number;
};

export type PromoState = {
  /** Cap of the current step (buyers still at this price: slots - taken). */
  slots: number;
  taken: number;
  /** Monthly price of the next step; null on the last (open) step. */
  nextPriceIdr: number | null;
};

export type PaywallConfig = {
  /** Daily AI scans for free users; null = no paywall (unlimited). */
  freeDailyScans: number | null;
  /** Cost-safety cap for founders; null = uncapped. */
  founderDailyCap: number | null;
  /** Anonymous landing-page scans per device; 0 turns the demo off. */
  anonScans: number;
  /** Flat fallback monthly price (used when the ladder is unset). */
  founderPriceIdr: number;
  /** Flat fallback yearly price (used when the ladder is unset). */
  founderYearlyPriceIdr: number;
  /** Urgency ladder; null = flat pricing. */
  founderLadder: LadderStep[] | null;
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
  const monthly = price ?? DEFAULT_FOUNDER_PRICE_IDR;
  const yearly = parseCount("FOUNDER_YEARLY_PRICE_IDR", env.FOUNDER_YEARLY_PRICE_IDR);
  if (yearly === 0) throw new Error("FOUNDER_YEARLY_PRICE_IDR must be > 0");
  return {
    freeDailyScans: parseCount("FREE_DAILY_SCANS", env.FREE_DAILY_SCANS),
    founderDailyCap: parseCount("FOUNDER_DAILY_CAP", env.FOUNDER_DAILY_CAP),
    anonScans: parseCount("ANON_SCANS", env.ANON_SCANS) ?? DEFAULT_ANON_SCANS,
    founderPriceIdr: monthly,
    founderYearlyPriceIdr: yearly ?? monthly * 10,
    founderLadder: parseLadder(env.FOUNDER_PRICE_LADDER, yearly),
  };
}

/**
 * Parses "10:15000,110:29000,:49000". Loud on purpose: a typo must not
 * silently sell Founder at the wrong rung. `yearlyOverride` (FOUNDER_YEARLY_PRICE_IDR)
 * is validated up front so it applies to every step.
 */
export function parseLadder(
  raw: string | undefined,
  yearlyOverride: number | null = null,
): LadderStep[] | null {
  const value = raw?.trim();
  if (!value) return null;
  const steps = value.split(",").map((part): LadderStep => {
    const chunk = part.trim();
    const [buyersRaw, priceRaw] = chunk.split(":");
    const monthly = Number(priceRaw);
    if (!priceRaw || !Number.isInteger(monthly) || monthly <= 0) {
      throw new Error(`FOUNDER_PRICE_LADDER step "${chunk}" must be "<buyers>:<monthlyIdr>"`);
    }
    if ((buyersRaw ?? "") === "") return { upToBuyers: null, monthlyIdr: monthly };
    if (!/^\d+$/.test(buyersRaw!.trim())) {
      throw new Error(`FOUNDER_PRICE_LADDER step "${chunk}" needs a whole buyer cap or "" for open-ended`);
    }
    return { upToBuyers: Number(buyersRaw), monthlyIdr: monthly };
  });
  if (steps.length === 0) throw new Error("FOUNDER_PRICE_LADDER needs at least one step");
  if (yearlyOverride !== null && yearlyOverride <= 0) {
    throw new Error("FOUNDER_YEARLY_PRICE_IDR must be > 0");
  }
  let previousCap: number | null | undefined = undefined;
  for (const step of steps) {
    if (previousCap === null) {
      throw new Error("FOUNDER_PRICE_LADDER: only the last step may be open-ended");
    }
    if (step.upToBuyers !== null && previousCap !== undefined && step.upToBuyers <= previousCap) {
      throw new Error(`FOUNDER_PRICE_LADDER buyer caps must strictly increase at ${step.monthlyIdr}`);
    }
    previousCap = step.upToBuyers;
  }
  return steps;
}

/**
 * The rung `buyers` distinct paying users are currently on: the first step
 * whose cap the count has not reached (0 buyers of 10 -> step 1, 10 -> step 2).
 */
export function ladderStep(ladder: LadderStep[], buyers: number): LadderStep {
  const step = ladder.find((s) => s.upToBuyers === null || buyers < s.upToBuyers);
  // parseLadder guarantees at least one step.
  return step ?? ladder[ladder.length - 1]!;
}

/**
 * Promo banner state for a buyer count; null on flat pricing or once the
 * open-ended rung is reached (no next price to advertise).
 */
export function promoFor(ladder: LadderStep[] | null, buyers: number): PromoState | null {
  if (!ladder) return null;
  const step = ladderStep(ladder, buyers);
  if (step.upToBuyers === null) return null;
  const next = ladder[ladder.indexOf(step) + 1];
  return { slots: step.upToBuyers, taken: buyers, nextPriceIdr: next?.monthlyIdr ?? null };
}

/**
 * Lowest monthly-equivalent the user has ever paid (yearly orders count as
 * amount/10): the grandfathered "harga terkunci" renewal price. null = never
 * paid, so the current rung applies.
 */
export function grandfatheredMonthlyIdr(
  paid: { amountIdr: number; months: number }[],
): number | null {
  let lowest: number | null = null;
  for (const row of paid) {
    const monthly = row.months >= 12 ? row.amountIdr / 10 : row.amountIdr;
    if (lowest === null || monthly < lowest) lowest = monthly;
  }
  return lowest;
}

export type FounderPlan = "monthly" | "yearly";

/** Months of Founder an order of this plan buys. */
export function planMonths(plan: FounderPlan): number {
  return plan === "yearly" ? 12 : 1;
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

/** Same day N months later, clamped to month end (31 Jan + 1 -> 28/29 Feb). */
export function addMonths(date: Date, months: number): Date {
  const target = date.getUTCMonth() + months;
  const y = date.getUTCFullYear() + Math.floor(target / 12);
  const m = ((target % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const out = new Date(date);
  out.setUTCDate(1);
  out.setUTCFullYear(y, m, Math.min(date.getUTCDate(), lastDay));
  return out;
}

/** Paid months stack on an active period, or start now if lapsed. */
export function nextFounderUntil(current: Date | null, now = new Date(), months = 1): Date {
  const base = current && current.getTime() > now.getTime() ? current : now;
  return addMonths(base, months);
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Founder time an App Store transaction grants. Production and allowlisted
 * sandbox buyers (owner, review demo) get the paid month. Any other Sandbox
 * transaction (App Review and TestFlight, often a private-relay email) gets a
 * 24h trial at zero revenue, so review passes without minting free months.
 */
export function appleFounderGrant(
  environment: "Sandbox" | "Production",
  buyerEmail: string,
  sandboxAllowlist: string | undefined,
  priceIdr: number,
  current: Date | null,
  now = new Date(),
  months = 1,
): { until: Date; amountIdr: number } {
  if (environment === "Sandbox") {
    const allowed = (sandboxAllowlist ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean);
    if (!allowed.includes(buyerEmail.toLowerCase())) {
      const base = current && current.getTime() > now.getTime() ? current : now;
      return { until: new Date(base.getTime() + DAY_MS), amountIdr: 0 };
    }
  }
  return { until: nextFounderUntil(current, now, months), amountIdr: priceIdr };
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
