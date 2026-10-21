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
  /**
   * Flat yearly price and the store fallback (Apple/Play orders not billed in IDR).
   * Empty = 10x the monthly price. Ladder steps without an explicit "/yearly" use it
   * (capped at 10x their monthly); explicit step yearly prices always win.
   */
  FOUNDER_YEARLY_PRICE_IDR?: string;
  /**
   * Urgency ladder "buyers:monthlyIdr[/yearlyIdr]" steps, e.g.
   * "10:15000/149000,110:29000/199000,:49000/349000" (first 10 buyers Rp15k or
   * Rp149k a year, buyers 11-110 Rp29k / Rp199k, then Rp49k / Rp349k). The last
   * step may be open-ended. Empty = flat FOUNDER_PRICE_IDR, no promo.
   */
  FOUNDER_PRICE_LADDER?: string;
};

/** One rung of the founder price ladder. */
export type LadderStep = {
  /** Cumulative buyers this price covers; null = open-ended (last step). */
  upToBuyers: number | null;
  monthlyIdr: number;
  /** Price of the yearly plan while this step is current. */
  yearlyIdr: number;
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
 * Parses "10:15000/149000,110:29000/199000,:49000/349000" (buyers:monthly/yearly).
 * The "/yearly" part is optional per step; without it yearly falls back to
 * `yearlyOverride` (FOUNDER_YEARLY_PRICE_IDR, capped at 10x that step's monthly)
 * or 10x monthly. Loud on purpose: a typo must not silently sell Founder at
 * the wrong rung. `yearlyOverride` is validated up front.
 */
export function parseLadder(
  raw: string | undefined,
  yearlyOverride: number | null = null,
): LadderStep[] | null {
  const value = raw?.trim();
  if (!value) return null;
  if (yearlyOverride !== null && yearlyOverride <= 0) {
    throw new Error("FOUNDER_YEARLY_PRICE_IDR must be > 0");
  }
  const steps = value.split(",").map((part): LadderStep => {
    const chunk = part.trim();
    const colon = chunk.indexOf(":");
    const buyersRaw = colon === -1 ? chunk : chunk.slice(0, colon);
    const pricesRaw = colon === -1 ? "" : chunk.slice(colon + 1);
    const [monthlyRaw, yearlyRaw, ...extra] = pricesRaw.split("/");
    const bad = () =>
      new Error(`FOUNDER_PRICE_LADDER step "${chunk}" must be "<buyers>:<monthlyIdr>[/<yearlyIdr>]"`);
    if (extra.length > 0 || !/^\d+$/.test(monthlyRaw!.trim())) throw bad();
    const monthly = Number(monthlyRaw);
    if (monthly <= 0) throw bad();
    let yearly: number;
    if (yearlyRaw !== undefined) {
      if (!/^\d+$/.test(yearlyRaw.trim()) || Number(yearlyRaw) <= 0) throw bad();
      yearly = Number(yearlyRaw);
    } else {
      yearly = yearlyOverride === null ? monthly * 10 : Math.min(yearlyOverride, monthly * 10);
    }
    if (buyersRaw.trim() === "") return { upToBuyers: null, monthlyIdr: monthly, yearlyIdr: yearly };
    if (!/^\d+$/.test(buyersRaw.trim())) {
      throw new Error(`FOUNDER_PRICE_LADDER step "${chunk}" needs a whole buyer cap or "" for open-ended`);
    }
    return { upToBuyers: Number(buyersRaw), monthlyIdr: monthly, yearlyIdr: yearly };
  });
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
 * What a checkout charges on this rung. A returning buyer's lowest paid
 * monthly-equivalent (`lockedMonthlyIdr`, see grandfatheredMonthlyIdr) wins
 * when it beats the rung: monthly = that price, yearly = at most 10x of it.
 */
export function checkoutAmountIdr(
  step: LadderStep,
  plan: FounderPlan,
  lockedMonthlyIdr: number | null,
): number {
  const locked =
    lockedMonthlyIdr !== null && lockedMonthlyIdr < step.monthlyIdr
      ? Math.round(lockedMonthlyIdr)
      : null;
  if (plan === "monthly") return locked ?? step.monthlyIdr;
  return locked === null ? step.yearlyIdr : Math.min(step.yearlyIdr, locked * 10);
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

export type ScanAllowance = {
  tier: Tier;
  /** Scans a day this account may use; null = unlimited. */
  quota: number | null;
  used: number;
  /** Scans still available today; null = unlimited. */
  left: number | null;
};

/** What the scan screen shows: today's allowance, from the same rule `requireAiQuota` enforces. */
export function scanAllowance(
  tier: Tier,
  aiUnlimited: boolean,
  used: number,
  config: PaywallConfig,
): ScanAllowance {
  const quota = aiUnlimited ? null : dailyScanQuota(tier, config);
  return { tier, quota, used, left: quota === null ? null : Math.max(0, quota - used) };
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
 * Founder time one auto-renewable App Store transaction grants: the store's
 * own period end (`expiresDate`), never less than what the user already has.
 * Sandbox buyers off the allowlist (App Review and TestFlight, often a
 * private-relay email) get a 24h trial at zero revenue instead, so review and
 * TestFlight renewals never mint months.
 * Returns null when the period already ended (a replayed old transaction).
 */
export function appleSubscriptionGrant(
  environment: "Sandbox" | "Production",
  buyerEmail: string,
  sandboxAllowlist: string | undefined,
  priceIdr: number,
  expiresDate: Date,
  current: Date | null,
  now = new Date(),
): { until: Date; amountIdr: number } | null {
  if (expiresDate.getTime() <= now.getTime()) return null;
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
  const until =
    current && current.getTime() > expiresDate.getTime() ? current : expiresDate;
  return { until, amountIdr: priceIdr };
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
