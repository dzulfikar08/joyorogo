import { and, asc, eq, isNotNull, isNull, lt, ne, or, sql } from "drizzle-orm";

import type { Database } from "@joyorogo/db";
import { payment, revklikOutbox } from "@joyorogo/db/schema/billing";

import { insertChunked } from "./d1";
import { minorDigits } from "./fx";

/**
 * Forwards the payment ledger to RevKlik (docs/revklik-forwarding.md). One event per paid order (purchase or renewal)
 * and one per refund/revocation, queued in `revklik_outbox` keyed by the RevKlik external_id, so queueing twice is a
 * no-op, and delivered to POST /api/v1/events/server with retry.
 */

export const REVKLIK_DEFAULT_API_URL = "https://app.revklik.com";
export const REVKLIK_PRODUCT = "joyorogo";
export const MAX_ATTEMPTS = 6;
const FLUSH_BATCH = 40;
const FLUSH_PARALLEL = 5;
/** Minutes to wait before attempt n+1 after n failures; the 5-minute cron is the floor. */
const BACKOFF_MS = [0, 5, 15, 45, 120, 360].map((minutes) => minutes * 60_000);

export type RevklikEnv = { REVKLIK_API_URL?: string; REVKLIK_TOKEN?: string; REVKLIK_SITE_ID?: string };
export type RevklikConfig = { apiUrl: string; token: string; siteId: string };

/** null = forwarding off (no token or no site id): nothing is sent, nothing fails. */
export function revklikConfig(env: RevklikEnv): RevklikConfig | null {
  const token = env.REVKLIK_TOKEN?.trim();
  const siteId = env.REVKLIK_SITE_ID?.trim();
  if (!token || !siteId) return null;
  return { apiUrl: (env.REVKLIK_API_URL?.trim() || REVKLIK_DEFAULT_API_URL).replace(/\/$/, ""), token, siteId };
}

export type LedgerKind = "paid" | "refund";
/** Billing libs call this after a ledger row flips to paid or is refunded. Never throws into the credit path. */
export type LedgerHook = (orderId: string, kind: LedgerKind) => Promise<void>;

export async function notifyLedger(hook: LedgerHook | undefined, orderId: string, kind: LedgerKind): Promise<void> {
  if (!hook) return;
  try {
    await hook(orderId, kind);
  } catch (error) {
    console.error(`[revklik] enqueue ${orderId} ${kind} failed:`, error);
  }
}

type LedgerRow = {
  orderId: string;
  amountIdr: number;
  months: number;
  chargedCurrency: string | null;
  chargedAmountMinor: number | null;
  chargedTaxMinor: number | null;
  isTest: number | null;
  paymentUrl: string | null;
  paidAt: Date | null;
};

export type RevklikEventBody = {
  name: "purchase" | "renewal" | "refund";
  revenue: number;
  currency: string;
  external_id: string;
  source: string;
  rail: string;
  product: string;
  props: Record<string, string | number>;
  occurred_at: string;
};

/** Canonical RevKlik rail of a ledger row. DOKU and Pakasir share JRG- ids; Pakasir rows carry a pakasir.com payment link. */
export function ledgerRail(row: Pick<LedgerRow, "orderId" | "paymentUrl">, hint?: string): string {
  if (row.orderId.startsWith("apple:")) return "apple";
  if (row.orderId.startsWith("google:")) return "google_play";
  if (row.orderId.startsWith("polar:")) return "polar";
  if (hint === "doku" || hint === "pakasir") return hint;
  return row.paymentUrl?.includes("pakasir") ? "pakasir" : "doku";
}

/**
 * What the customer paid, in the currency they paid it. Polar: the order's own currency and net amount (before tax, the
 * same figure amount_idr is converted from; tax goes to props.tax_minor since Polar remits it). Apple, Google Play, DOKU
 * and Pakasir: amount_idr in IDR (the ledger keeps no store price in another currency). null = nothing real was charged.
 */
export function ledgerMoney(row: LedgerRow, rail: string): { revenue: number; currency: string } | null {
  if (rail === "polar" && row.chargedCurrency && row.chargedAmountMinor !== null) {
    if (row.chargedAmountMinor <= 0) return null;
    const digits = minorDigits(row.chargedCurrency);
    return {
      revenue: Number((row.chargedAmountMinor / 10 ** digits).toFixed(digits)),
      currency: row.chargedCurrency.toUpperCase(),
    };
  }
  if (row.amountIdr <= 0) return null;
  return { revenue: row.amountIdr, currency: "IDR" };
}

/**
 * The RevKlik event of a ledger row, or null when it is not real money (test purchase, zero charge, never paid).
 * `renewal` marks a sale after the buyer's first real one. A refund is the sale with a negative sign and
 * external_id `<order_id>:refund`; `refundedAt` is when it was seen (default: the sale's paid_at).
 */
export function buildLedgerEvent(
  row: LedgerRow,
  kind: LedgerKind,
  options: { renewal: boolean; rail?: string; refundedAt?: Date },
): RevklikEventBody | null {
  if (row.isTest === 1 || !row.paidAt) return null;
  const rail = ledgerRail(row, options.rail);
  const money = ledgerMoney(row, rail);
  if (!money) return null;
  const refund = kind === "refund";
  const props: Record<string, string | number> = {
    plan: row.months >= 12 ? "yearly" : row.months > 0 ? "monthly" : "proration",
    months: row.months,
    environment: "production",
  };
  if (rail === "polar" && row.chargedTaxMinor) props.tax_minor = row.chargedTaxMinor;
  return {
    name: refund ? "refund" : options.renewal ? "renewal" : "purchase",
    revenue: refund ? -money.revenue : money.revenue,
    currency: money.currency,
    external_id: refund ? `${row.orderId}:refund` : row.orderId,
    source: rail,
    rail,
    product: REVKLIK_PRODUCT,
    props,
    occurred_at: (refund ? (options.refundedAt ?? row.paidAt) : row.paidAt).toISOString(),
  };
}

const ledgerColumns = {
  orderId: payment.orderId,
  userId: payment.userId,
  status: payment.status,
  amountIdr: payment.amountIdr,
  months: payment.months,
  chargedCurrency: payment.chargedCurrency,
  chargedAmountMinor: payment.chargedAmountMinor,
  chargedTaxMinor: payment.chargedTaxMinor,
  isTest: payment.isTest,
  paymentUrl: payment.paymentUrl,
  paidAt: payment.paidAt,
};

const realMoneyRow = or(isNull(payment.isTest), ne(payment.isTest, 1));

/** Queues the event of one ledger row. Idempotent per external_id. Returns false when nothing was queued. */
export async function enqueueLedger(
  db: Database,
  orderId: string,
  kind: LedgerKind,
  options: { rail?: string; now?: Date } = {},
): Promise<boolean> {
  const [row] = await db.select(ledgerColumns).from(payment).where(eq(payment.orderId, orderId)).limit(1);
  if (!row || !row.paidAt) return false;
  // A sale happened whenever paid_at is set (a later refund leaves it); a refund needs the row flipped to failed.
  if (kind === "refund" && row.status !== "failed") return false;

  const [earlier] = await db
    .select({ orderId: payment.orderId })
    .from(payment)
    .where(
      and(
        eq(payment.userId, row.userId),
        ne(payment.orderId, row.orderId),
        isNotNull(payment.paidAt),
        realMoneyRow,
        or(
          sql`${payment.paidAt} < ${row.paidAt.getTime()}`,
          and(sql`${payment.paidAt} = ${row.paidAt.getTime()}`, lt(payment.orderId, row.orderId)),
        ),
        or(sql`${payment.amountIdr} > 0`, sql`coalesce(${payment.chargedAmountMinor}, 0) > 0`),
      ),
    )
    .limit(1);

  const event = buildLedgerEvent(row, kind, { renewal: Boolean(earlier), rail: options.rail, refundedAt: options.now ?? new Date() });
  if (!event) return false;
  const inserted = await db
    .insert(revklikOutbox)
    .values({ externalId: event.external_id, body: JSON.stringify(event) })
    .onConflictDoNothing()
    .returning({ externalId: revklikOutbox.externalId });
  return inserted.length === 1;
}

export type BackfillResult = { scanned: number; queued: number; skipped: number };

/**
 * Queues every historical real paid order and every refunded one, in paid order so the first order per buyer is the
 * purchase and the rest renewals. Idempotent: rows already queued or delivered keep their state. Refunds are dated at
 * the sale's paid_at, since the ledger keeps no refund time.
 */
export async function backfillLedger(db: Database): Promise<BackfillResult> {
  const rows = await db
    .select(ledgerColumns)
    .from(payment)
    .where(and(isNotNull(payment.paidAt), realMoneyRow, or(eq(payment.status, "paid"), eq(payment.status, "failed"))))
    .orderBy(asc(payment.paidAt), asc(payment.orderId));

  const seenBuyer = new Set<string>();
  const events: RevklikEventBody[] = [];
  for (const row of rows) {
    const renewal = seenBuyer.has(row.userId);
    const sale = buildLedgerEvent(row, "paid", { renewal });
    if (!sale) continue;
    seenBuyer.add(row.userId);
    events.push(sale);
    if (row.status === "failed") {
      const refund = buildLedgerEvent(row, "refund", { renewal });
      if (refund) events.push(refund);
    }
  }

  const results = await insertChunked(
    db,
    revklikOutbox,
    events.map((event) => ({ externalId: event.external_id, body: JSON.stringify(event) })),
    (insert) => insert.onConflictDoNothing().returning({ externalId: revklikOutbox.externalId }),
  );
  const queued = results.reduce((sum, inserted) => sum + inserted.length, 0);
  return { scanned: rows.length, queued, skipped: events.length - queued };
}

export type FlushResult = { sent: number; failed: number; parked: number };

function dueNow(row: { attempts: number; lastAttemptAt: Date | null }, now: number): boolean {
  if (row.attempts === 0 || !row.lastAttemptAt) return true;
  return now - row.lastAttemptAt.getTime() >= (BACKOFF_MS[Math.min(row.attempts, BACKOFF_MS.length - 1)] ?? 0);
}

/**
 * Sends queued events. 2xx = delivered; 4xx other than 408/429 = parked (attempts jump to the cap, last_error kept);
 * 5xx, 408, 429 and network errors retry with backoff until MAX_ATTEMPTS, then park. Returns zeros when forwarding is off.
 */
export async function flushOutbox(
  db: Database,
  config: RevklikConfig | null,
  options: { fetcher?: typeof fetch; now?: () => number } = {},
): Promise<FlushResult> {
  const result: FlushResult = { sent: 0, failed: 0, parked: 0 };
  if (!config) return result;
  const fetcher = options.fetcher ?? fetch;
  const nowMs = (options.now ?? Date.now)();

  const pending = await db
    .select()
    .from(revklikOutbox)
    .where(and(isNull(revklikOutbox.forwardedAt), lt(revklikOutbox.attempts, MAX_ATTEMPTS)))
    .orderBy(asc(revklikOutbox.createdAt), asc(revklikOutbox.externalId))
    .limit(FLUSH_BATCH * 3);
  const due = pending.filter((row) => dueNow(row, nowMs)).slice(0, FLUSH_BATCH);

  const send = async (row: (typeof due)[number]) => {
    let status = 0;
    let error = "";
    try {
      const response = await fetcher(`${config.apiUrl}/api/v1/events/server`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${config.token}` },
        body: JSON.stringify({ ...(JSON.parse(row.body) as object), site_id: config.siteId }),
      });
      status = response.status;
      if (!response.ok) error = `http ${status}: ${(await response.text().catch(() => "")).slice(0, 200)}`;
    } catch (cause) {
      error = `network: ${cause instanceof Error ? cause.message : String(cause)}`.slice(0, 200);
    }

    const at = new Date(nowMs);
    if (!error) {
      await db
        .update(revklikOutbox)
        .set({ forwardedAt: at, lastAttemptAt: at, attempts: row.attempts + 1, lastError: null })
        .where(eq(revklikOutbox.externalId, row.externalId));
      result.sent++;
      return;
    }
    const permanent = status >= 400 && status < 500 && status !== 408 && status !== 429;
    const attempts = permanent ? MAX_ATTEMPTS : row.attempts + 1;
    await db
      .update(revklikOutbox)
      .set({ attempts, lastAttemptAt: at, lastError: error })
      .where(eq(revklikOutbox.externalId, row.externalId));
    if (attempts >= MAX_ATTEMPTS) result.parked++;
    else result.failed++;
  };

  for (let i = 0; i < due.length; i += FLUSH_PARALLEL) {
    await Promise.all(due.slice(i, i + FLUSH_PARALLEL).map(send));
  }
  return result;
}

/**
 * Safety net for the enqueue-after-flip gap (a Worker dying between the ledger flip and the outbox insert): queues the
 * sales and refunds of the last `days` days that the outbox does not have yet. Cheap: one bounded read.
 */
export async function sweepRecentLedger(db: Database, now: Date, days = 3): Promise<number> {
  const since = now.getTime() - days * 86_400_000;
  const rows = await db
    .select({ orderId: payment.orderId, status: payment.status })
    .from(payment)
    .where(
      and(
        isNotNull(payment.paidAt),
        sql`${payment.paidAt} >= ${since}`,
        realMoneyRow,
        or(
          and(
            eq(payment.status, "paid"),
            sql`not exists (select 1 from ${revklikOutbox} where ${revklikOutbox.externalId} = ${payment.orderId})`,
          ),
          and(
            eq(payment.status, "failed"),
            sql`not exists (select 1 from ${revklikOutbox} where ${revklikOutbox.externalId} = ${payment.orderId} || ':refund')`,
          ),
        ),
      ),
    )
    .limit(100);
  let queued = 0;
  for (const row of rows) {
    if (await enqueueLedger(db, row.orderId, "paid", { now }).catch(() => false)) queued++;
    if (row.status === "failed" && (await enqueueLedger(db, row.orderId, "refund", { now }).catch(() => false))) queued++;
  }
  return queued;
}
