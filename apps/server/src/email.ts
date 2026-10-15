import type { SendEmail } from "@cloudflare/workers-types";
import { and, eq, gt, isNotNull, lte, or, sql } from "drizzle-orm";

import { emailLog, googlePurchase, payment } from "@joyorogo/db/schema/billing";
import { user } from "@joyorogo/db/schema/auth";
import type { Database } from "@joyorogo/db";

/** Worker vars email needs; all optional so self-hosts run without email. */
export type EmailEnv = {
  EMAIL?: SendEmail;
  /** Sender address. Empty/unset = email off. */
  EMAIL_FROM?: string;
  EMAIL_FROM_NAME?: string;
  EMAIL_REPLY_TO?: string;
  /** Comma-separated admin inboxes for payment notifications. */
  ADMIN_EMAILS?: string;
  FOUNDER_DAILY_CAP?: string;
  FOUNDER_PRICE_LADDER?: string;
  FOUNDER_PRICE_IDR?: string;
  FOUNDER_YEARLY_PRICE_IDR?: string;
};

type Draft = { to: string | string[]; subject: string; html: string; text: string };

const GREEN = "#16a34a";
const INK = "#1f2937";
const MUTED = "#6b7280";

const formatIdr = (idr: number) => `Rp${idr.toLocaleString("id-ID")}`;

/** '2026-10-13' style WIB date for a period end. */
export function formatWibDate(date: Date): string {
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

/**
 * Sends through the Cloudflare Email Service binding. Never throws: a failed
 * email must not fail the webhook/cron that triggered it. No EMAIL binding,
 * EMAIL_FROM, or a send error just logs.
 */
export async function sendEmail(env: EmailEnv, draft: Draft): Promise<string> {
  if (!env.EMAIL || !env.EMAIL_FROM) return "email off (no EMAIL binding or EMAIL_FROM)";
  try {
    await env.EMAIL.send({
      to: draft.to,
      from: { email: env.EMAIL_FROM, name: env.EMAIL_FROM_NAME || "JoyoRogo" },
      ...(env.EMAIL_REPLY_TO ? { replyTo: env.EMAIL_REPLY_TO } : {}),
      subject: draft.subject,
      html: draft.html,
      text: draft.text,
    });
    return "sent";
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error ? String(error.code) : "unknown";
    const message = error instanceof Error ? error.message : String(error);
    console.error(`email failed (${code}):`, message);
    return `failed (${code}): ${message}`;
  }
}

/**
 * Claims the right to send one email: insert-or-ignore BEFORE the send, so
 * concurrent webhooks/crons dedupe on UNIQUE(kind, ref). True = we send.
 */
async function claimEmail(
  db: Database,
  userId: string,
  kind: "receipt" | "admin" | "founder_ending" | "founder_expired",
  ref: string,
): Promise<boolean> {
  const claimed = await db
    .insert(emailLog)
    .values({ userId, kind, ref })
    .onConflictDoNothing()
    .returning({ id: emailLog.id });
  return claimed.length === 1;
}

/** Mobile-friendly shell: one column, inline styles, brand green, no images. */
function shell(title: string, bodyHtml: string): string {
  return `<!doctype html><html lang="id"><body style="margin:0;padding:24px 12px;background:#f3f4f6;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:${INK};">
<div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;padding:28px 24px;">
<p style="margin:0 0 16px;font-size:15px;font-weight:700;color:${GREEN};">JoyoRogo</p>
<h1 style="margin:0 0 16px;font-size:19px;line-height:1.4;">${title}</h1>
${bodyHtml}
</div>
<p style="max-width:520px;margin:12px auto 0;font-size:12px;color:${MUTED};text-align:center;">JoyoRogo — asisten gizi keluarga</p>
</body></html>`;
}

const p = (html: string) => `<p style="margin:0 0 14px;font-size:14px;line-height:1.6;">${html}</p>`;
const button = (href: string, label: string) =>
  `<p style="margin:20px 0;"><a href="${href}" style="display:inline-block;background:${GREEN};color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:11px 22px;border-radius:8px;">${label}</a></p>`;

type ReceiptInfo = {
  name: string;
  plan: "monthly" | "yearly";
  amountIdr: number;
  founderUntil: Date;
  founderDailyCap: number | null;
};

function receiptDraft(info: ReceiptInfo): Draft {
  const planLabel = info.plan === "yearly" ? "tahunan" : "bulanan";
  const cap =
    info.founderDailyCap === null
      ? "scan AI tanpa batas harian"
      : `hingga ${info.founderDailyCap} scan AI per hari`;
  const html = shell(
    "Terima kasih sudah jadi Founder!",
    p(`Halo ${info.name}, pembayaran <b>${formatIdr(info.amountIdr)}</b> untuk langganan Founder <b>${planLabel}</b> sudah kami terima.`) +
      p(`Status Founder kamu aktif sampai <b>${formatWibDate(info.founderUntil)}</b> (WIB).`) +
      p(`Selama jadi Founder kamu bisa scan makanan ${cap}.`) +
      button("https://joyorogo.com/beranda", "Mulai scan"),
  );
  const text = [
    `Halo ${info.name}, terima kasih! Pembayaran ${formatIdr(info.amountIdr)} untuk langganan Founder ${planLabel} sudah kami terima.`,
    `Status Founder kamu aktif sampai ${formatWibDate(info.founderUntil)} (WIB).`,
    info.founderDailyCap === null
      ? "Selama jadi Founder kamu bisa scan makanan tanpa batas harian."
      : `Selama jadi Founder kamu bisa scan makanan hingga ${info.founderDailyCap} scan AI per hari.`,
    "Buka https://joyorogo.com/beranda untuk mulai scan.",
  ].join("\n\n");
  return { to: "", subject: "Pembayaran Founder JoyoRogo diterima", html, text };
}

type PaidOrderInfo = {
  orderId: string;
  gateway: string;
  name: string;
  email: string;
  months: number;
  amountIdr: number;
  founderUntil: Date | null;
};

function adminDraft(info: PaidOrderInfo): Draft {
  const planLabel = info.months >= 12 ? "tahunan" : "bulanan";
  const rows: [string, string][] = [
    ["Pembeli", `${info.name} (${info.email})`],
    ["Jumlah", formatIdr(info.amountIdr)],
    ["Paket", `Founder ${planLabel}`],
    ["Gateway", info.gateway],
    ["Order", info.orderId],
    ["Founder sampai", info.founderUntil ? formatWibDate(info.founderUntil) : "-"],
  ];
  const html = shell(
    "Pembayaran Founder masuk",
    `<table style="width:100%;border-collapse:collapse;font-size:14px;">${rows
      .map(
        ([k, v]) =>
          `<tr><td style="padding:6px 0;color:${MUTED};white-space:nowrap;padding-right:12px;">${k}</td><td style="padding:6px 0;font-weight:600;">${v}</td></tr>`,
      )
      .join("")}</table>` +
      button("https://admin.joyorogo.com/#orders", "Lihat pesanan"),
  );
  const text = [
    "Pembayaran Founder masuk:",
    ...rows.map(([k, v]) => `${k}: ${v}`),
    "https://admin.joyorogo.com/#orders",
  ].join("\n");
  return { to: "", subject: `Founder baru: ${formatIdr(info.amountIdr)} — ${info.name}`, html, text };
}

/**
 * Receipt to the buyer + notification to every admin, for one confirmed
 * payment. Each is claimed in email_log first (ref = order id), so the
 * webhook, "cek pembayaran", and the reconcile cron can all race safely.
 */
export async function sendOrderEmails(
  env: EmailEnv,
  db: Database,
  order: { orderId: string; userId: string; gateway: string },
  config: { founderDailyCap: number | null },
): Promise<void> {
  const [row] = await db
    .select({
      name: user.name,
      email: user.email,
      amountIdr: payment.amountIdr,
      months: payment.months,
      founderUntil: payment.founderUntil,
    })
    .from(payment)
    .innerJoin(user, eq(user.id, payment.userId))
    .where(and(eq(payment.orderId, order.orderId), eq(payment.status, "paid")))
    .limit(1);
  if (!row) return;

  if (await claimEmail(db, order.userId, "receipt", order.orderId)) {
    const info: ReceiptInfo = {
      name: row.name,
      plan: row.months >= 12 ? "yearly" : "monthly",
      amountIdr: row.amountIdr,
      founderUntil: row.founderUntil ?? new Date(),
      founderDailyCap: config.founderDailyCap,
    };
    await sendEmail(env, { ...receiptDraft(info), to: row.email });
  }

  const admins = (env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim())
    .filter(Boolean);
  if (admins.length === 0) return;
  if (await claimEmail(db, order.userId, "admin", order.orderId)) {
    const draft = adminDraft({
      orderId: order.orderId,
      gateway: order.gateway,
      name: row.name,
      email: row.email,
      months: row.months,
      amountIdr: row.amountIdr,
      founderUntil: row.founderUntil,
    });
    await sendEmail(env, { ...draft, to: admins });
  }
}

/** Lowest monthly-equivalent the user ever paid — the "harga terkunci" price. */
async function lockedMonthlyIdr(db: Database, userId: string): Promise<number | null> {
  const [row] = await db
    .select({
      lowest: sql<number | null>`min(case when ${payment.months} >= 12 then ${payment.amountIdr} / 10.0 else ${payment.amountIdr} end)`,
    })
    .from(payment)
    .where(and(eq(payment.userId, userId), eq(payment.status, "paid"), gt(payment.amountIdr, 0)));
  return row?.lowest ?? null;
}

function endingDraft(name: string, until: Date, locked: number | null): Draft {
  const price = locked === null ? "" : ` Harga terkunci kamu masih ${formatIdr(Math.round(locked))}/bulan.`;
  const html = shell(
    `Founder kamu berakhir ${formatWibDate(until)}`,
    p(`Halo ${name}, masa Founder kamu akan berakhir pada <b>${formatWibDate(until)}</b> (WIB).`) +
      p(`Perpanjang sekarang biar scan gizi harianmu tidak berhenti.${price}`) +
      button(
        "https://joyorogo.com/founder?from=profile&next=/profil",
        "Perpanjang Founder",
      ),
  );
  const text = [
    `Halo ${name}, masa Founder kamu berakhir ${formatWibDate(until)} (WIB).`,
    `Perpanjang sekarang biar scan gizi harianmu tidak berhenti.${price}`,
    "https://joyorogo.com/founder?from=profile&next=/profil",
  ].join("\n\n");
  return { to: "", subject: `Founder kamu berakhir ${formatWibDate(until)}`, html, text };
}

function expiredDraft(name: string): Draft {
  const html = shell(
    "Founder kamu sudah berakhir",
    p(`Halo ${name}, masa Founder kamu sudah berakhir, jadi scan gizi harian kembali ke batas pengguna gratis.`) +
      p("Aktifkan lagi Founder kapan saja untuk lanjut scan tanpa khawatir.") +
      button(
        "https://joyorogo.com/founder?from=profile&next=/profil",
        "Aktifkan Founder",
      ),
  );
  const text = [
    `Halo ${name}, masa Founder kamu sudah berakhir, jadi scan gizi harian kembali ke batas pengguna gratis.`,
    "Aktifkan lagi Founder kapan saja untuk lanjut scan tanpa khawatir.",
    "https://joyorogo.com/founder?from=profile&next=/profil",
  ].join("\n\n");
  return { to: "", subject: "Founder kamu sudah berakhir", html, text };
}

/**
 * Rows due a founder mail: tier='free' with a paid period that ends within 3
 * days, or ended within the last day, and no auto-renewing Google Play
 * subscription (its renewal extends the period; Play tells us when it stops).
 * Operators (not raw sql`` fragments) so
 * drizzle encodes the Date through the column's integer-ms mapper — a Date
 * interpolated in sql`` reaches D1 unencoded and D1 rejects the bind.
 */
export function founderEmailsDue(now: number) {
  const day = 24 * 60 * 60 * 1000;
  return and(
    eq(user.tier, "free"),
    isNotNull(user.founderUntil),
    or(
      and(gt(user.founderUntil, new Date(now)), lte(user.founderUntil, new Date(now + 3 * day))),
      and(lte(user.founderUntil, new Date(now)), gt(user.founderUntil, new Date(now - day))),
    ),
    sql`not exists (select 1 from ${googlePurchase} where ${googlePurchase.userId} = ${user.id} and ${googlePurchase.state} in ('active', 'grace'))`,
  );
}

/**
 * Cron: founder expiry reminders. Paid founders (tier='free' — 'founder' rows
 * are manual comps) whose period ends within 3 days get one reminder, and a
 * single "sudah berakhir" mail on the day after expiry. UNIQUE(kind, ref)
 * with ref = "<userId>:<untilMs>" keeps it once per period. Bounded at 50
 * sends per tick; one query when nothing is due.
 */
export async function runFounderEmails(env: EmailEnv, db: Database): Promise<void> {
  if (!env.EMAIL || !env.EMAIL_FROM) return;
  const now = Date.now();
  const rows = await db
    .select({ id: user.id, name: user.name, email: user.email, founderUntil: user.founderUntil })
    .from(user)
    .where(founderEmailsDue(now))
    .limit(50);

  let sends = 0;
  for (const row of rows) {
    const untilMs = row.founderUntil?.getTime();
    if (untilMs === undefined) continue;
    const expired = untilMs <= now;
    const kind = expired ? ("founder_expired" as const) : ("founder_ending" as const);
    if (!(await claimEmail(db, row.id, kind, `${row.id}:${untilMs}`))) continue;
    const locked = expired ? null : await lockedMonthlyIdr(db, row.id);
    const draft = expired
      ? expiredDraft(row.name)
      : endingDraft(row.name, new Date(untilMs), locked);
    await sendEmail(env, { ...draft, to: row.email });
    if (++sends >= 50) break;
  }
}
