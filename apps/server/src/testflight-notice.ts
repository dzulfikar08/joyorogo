import { and, eq, sql } from "drizzle-orm";

import { user } from "@joyorogo/db/schema/auth";
import { emailLog, payment } from "@joyorogo/db/schema/billing";
import type { Database } from "@joyorogo/db";
import type { Locale } from "@joyorogo/i18n";
import { userLocale } from "@joyorogo/api/lib/messages";

import { deliver, renderFor } from "./broadcast";
import type { BroadcastDeps } from "./broadcast";
import type { Campaign } from "./broadcast-render";
import { claimEmail } from "./email";
import { INTERNAL_EMAILS } from "./internal-accounts";
import { listOptedOut, optOutKey } from "./unsubscribe";

/**
 * One mail per user who "bought" Pro in a TestFlight build. Apple's Sandbox
 * charges nothing there; the server grants a non-allowlisted Sandbox buyer 24h
 * of Pro at Rp0 (payment rows `apple:<txn>`, amount 0), so the buyer may think
 * they paid. The mail says what happened and where a real purchase is possible
 * (outside the app: the App Store rules forbid pointing to the web inside it).
 *
 * - Sent from the broadcast sender with its unsubscribe footer; opt-outs apply.
 * - Once per user: email_log `testflight_notice`, ref = user id, claimed before
 *   the send and released when the send fails.
 * - Triggered right after a grant (apple route and App Store notifications) and
 *   swept from the cron, which also covers buyers from before this existed and
 *   sends that failed.
 * - Off unless TESTFLIGHT_PURCHASE_EMAIL=on. Turn it off once the App Store
 *   version is live (docs/pricing.md).
 */

export const TESTFLIGHT_NOTICE_KIND = "testflight_notice" as const;

const PRICING_URL = "https://joyorogo.com/harga";

/** Buyers mailed per cron tick. */
const SWEEP_LIMIT = 20;

const COPY: Record<Locale, Campaign> = {
  id: {
    id: "testflight-purchase",
    subject: "Soal pembelian Pro kamu di TestFlight",
    body: `Halo {nama},

Makasih sudah coba Pro di TestFlight! Pembelian di TestFlight itu simulasi Apple, jadi tidak ditagih dan Pro aktif 24 jam.

Kalau mau langganan beneran sekarang, bisa lewat [joyorogo.com/harga](${PRICING_URL}) (QRIS/VA), Pro langsung aktif di iPhone juga. Atau tunggu JoyoRogo resmi di App Store.

Salam,
Dzulfikar, JoyoRogo`,
  },
  en: {
    id: "testflight-purchase",
    subject: "About your Pro purchase in TestFlight",
    body: `Hi {nama},

Thanks for trying Pro in TestFlight! Purchases in TestFlight are an Apple simulation, so you were not charged and Pro stays active for 24 hours.

If you want to subscribe for real right now, you can do it at [joyorogo.com/harga](${PRICING_URL}) (QRIS/virtual account), and Pro activates on your iPhone too. Or wait for JoyoRogo to launch on the App Store.

Best,
Dzulfikar, JoyoRogo`,
  },
};

export type TestflightNoticeConfig = {
  enabled: boolean;
  /** Lowercased: our own logins, the admins and the Sandbox allowlist never get this mail. */
  skipEmails: string[];
};

type NoticeEnv = {
  TESTFLIGHT_PURCHASE_EMAIL?: string;
  APPLE_SANDBOX_EMAILS?: string;
  ADMIN_EMAILS?: string;
};

const emailList = (value: string | undefined) =>
  (value ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);

export function testflightNoticeConfig(env: NoticeEnv): TestflightNoticeConfig {
  return {
    enabled: env.TESTFLIGHT_PURCHASE_EMAIL?.trim().toLowerCase() === "on",
    skipEmails: [
      ...INTERNAL_EMAILS,
      ...emailList(env.ADMIN_EMAILS),
      ...emailList(env.APPLE_SANDBOX_EMAILS),
    ],
  };
}

type Buyer = { id: string; name: string; email: string };

export type NoticeOutcome = "sent" | "already" | "opted-out" | "failed";

/** Mails one buyer unless they already got it or opted out. */
async function mailBuyer(
  deps: BroadcastDeps,
  buyer: Buyer,
  optedOut: (userId: string) => Promise<boolean>,
): Promise<NoticeOutcome> {
  if (await optedOut(buyer.id)) return "opted-out";
  if (!(await claimEmail(deps.db, buyer.id, TESTFLIGHT_NOTICE_KIND, buyer.id))) return "already";
  const locale = await userLocale(deps.db, buyer.id);
  const { mail, unsubscribeUrl } = await renderFor(deps, COPY[locale], buyer, locale);
  const result = await deliver(deps, mail, buyer.email, unsubscribeUrl);
  if (result.ok) return "sent";
  await deps.db
    .delete(emailLog)
    .where(and(eq(emailLog.kind, TESTFLIGHT_NOTICE_KIND), eq(emailLog.ref, buyer.id)));
  return "failed";
}

const skipSql = (config: TestflightNoticeConfig) =>
  sql.join(
    config.skipEmails.map((email) => sql`${email}`),
    sql`, `,
  );

/**
 * Right after a sandbox grant: mails this user when the notice is on and they
 * are not one of ours. Never throws. Deduped by email_log, so renewals and
 * replays cost one read.
 */
export async function sendTestflightNotice(
  deps: BroadcastDeps,
  config: TestflightNoticeConfig,
  userId: string,
): Promise<NoticeOutcome | "off" | "skipped"> {
  if (!config.enabled) return "off";
  try {
    const [buyer] = await deps.db
      .select({ id: user.id, name: user.name, email: user.email })
      .from(user)
      .where(
        and(
          eq(user.id, userId),
          eq(user.emailVerified, true),
          sql`lower(${user.email}) not in (${skipSql(config)})`,
        ),
      )
      .limit(1);
    if (!buyer || !buyer.email.includes("@")) return "skipped";
    return await mailBuyer(deps, buyer, async (id) => (await deps.bucket.get(optOutKey(id))) !== null);
  } catch (error) {
    console.error(`testflight notice ${userId}:`, error);
    return "failed";
  }
}

/**
 * Sandbox buyers (a paid `apple:` ledger row at Rp0) who have not had the mail,
 * minus verified-email and skip-list exclusions.
 */
export async function pendingTestflightBuyers(
  db: Database,
  config: TestflightNoticeConfig,
): Promise<Buyer[]> {
  return db
    .selectDistinct({ id: user.id, name: user.name, email: user.email })
    .from(payment)
    .innerJoin(user, eq(user.id, payment.userId))
    .where(
      and(
        sql`${payment.orderId} like 'apple:%'`,
        eq(payment.amountIdr, 0),
        eq(payment.status, "paid"),
        eq(user.emailVerified, true),
        sql`lower(${user.email}) not in (${skipSql(config)})`,
        sql`instr(${user.email}, '@') > 0`,
        sql`not exists (select 1 from ${emailLog} where ${emailLog.kind} = ${TESTFLIGHT_NOTICE_KIND} and ${emailLog.ref} = ${user.id})`,
      ),
    )
    .orderBy(user.id);
}

export type SweepResult = { pending: number; sent: number; failed: number; optedOut: number };

/**
 * Cron: mails up to SWEEP_LIMIT sandbox buyers still without the notice (the
 * backfill of earlier buyers, and retries of failed sends). Stops at the first
 * failed send so a broken email setup costs one attempt per tick.
 */
export async function runTestflightNoticeSweep(
  deps: BroadcastDeps,
  config: TestflightNoticeConfig,
  limit = SWEEP_LIMIT,
): Promise<SweepResult> {
  const result: SweepResult = { pending: 0, sent: 0, failed: 0, optedOut: 0 };
  if (!config.enabled || !deps.email) return result;
  const buyers = await pendingTestflightBuyers(deps.db, config);
  result.pending = buyers.length;
  if (buyers.length === 0) return result;
  const optedOut = await listOptedOut(deps.bucket);
  let attempted = 0;
  for (const buyer of buyers) {
    if (attempted >= limit) break;
    const outcome = await mailBuyer(deps, buyer, async (id) => optedOut.has(id));
    if (outcome === "opted-out") {
      result.optedOut++;
      continue;
    }
    attempted++;
    if (outcome === "sent") result.sent++;
    if (outcome === "failed") {
      result.failed++;
      break;
    }
  }
  return result;
}
