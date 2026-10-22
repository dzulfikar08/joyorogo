import type { SendEmail } from "@cloudflare/workers-types";
import { and, eq, gt, isNotNull, lte, or, sql } from "drizzle-orm";

import { emailLog, googlePurchase, payment } from "@joyorogo/db/schema/billing";
import { realPayment } from "./real-payment";
import { user } from "@joyorogo/db/schema/auth";
import type { Database } from "@joyorogo/db";
import { DEFAULT_DAY_ZONE, DEFAULT_LOCALE, fmtIdr, getT } from "@joyorogo/i18n";
import type { DayZone, Locale } from "@joyorogo/i18n";
import { formatMinor } from "@joyorogo/api/lib/fx";
import { userLocale } from "@joyorogo/api/lib/messages";
import { zoneOfUser } from "@joyorogo/api/lib/user-zone";
import { dayStartMs } from "@joyorogo/api/lib/accuracy-report";
import type { AccuracyReport, EmailState, ShadowReport } from "@joyorogo/api/lib/accuracy-report";

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

const INTL_TAG: Record<Locale, string> = { id: "id-ID", en: "en-US", ms: "ms-MY" };

/** "13 Oktober 2026" / "October 13, 2026": the calendar day of a period end in `zone` (the person's own; WIB for admin notices). */
export function formatWibDate(date: Date, locale: Locale = DEFAULT_LOCALE, zone: DayZone = DEFAULT_DAY_ZONE): string {
  return new Intl.DateTimeFormat(INTL_TAG[locale], {
    timeZone: zone,
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
export async function claimEmail(
  db: Database,
  userId: string,
  kind: (typeof emailLog.$inferInsert)["kind"],
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
function shell(title: string, bodyHtml: string, locale: Locale): string {
  return `<!doctype html><html lang="${locale}"><body style="margin:0;padding:24px 12px;background:#f3f4f6;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:${INK};">
<div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;padding:28px 24px;">
<p style="margin:0 0 16px;font-size:15px;font-weight:700;color:${GREEN};">JoyoRogo</p>
<h1 style="margin:0 0 16px;font-size:19px;line-height:1.4;">${title}</h1>
${bodyHtml}
</div>
<p style="max-width:520px;margin:12px auto 0;font-size:12px;color:${MUTED};text-align:center;">${getT(locale, "email")("shell.footer")}</p>
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

const HOME_URL = "https://app.joyorogo.com/beranda";
const RENEW_URL = "https://app.joyorogo.com/pro?from=profile&next=/profil";

/** `<b>` in the HTML part, plain in the text part: one string serves both. */
const bold = (html: boolean) => (value: string) => (html ? `<b>${value}</b>` : value);

function receiptDraft(info: ReceiptInfo, locale: Locale, zone: DayZone): Draft {
  const t = getT(locale, "email");
  const part = (html: boolean) => {
    const b = bold(html);
    return {
      intro: t("receipt.intro", {
        name: info.name,
        amount: b(fmtIdr(info.amountIdr, locale)),
        plan: b(t(`plan.${info.plan}`)),
      }),
      active: t("receipt.active", { until: b(formatWibDate(info.founderUntil, locale, zone)) }),
      cap:
        info.founderDailyCap === null
          ? t("receipt.capUnlimited")
          : t("receipt.capLimited", { count: info.founderDailyCap }),
    };
  };
  const h = part(true);
  const html = shell(
    t("receipt.title"),
    p(h.intro) + p(h.active) + p(h.cap) + button(HOME_URL, t("receipt.cta")),
    locale,
  );
  const x = part(false);
  const text = [x.intro, x.active, x.cap, t("receipt.textLink", { url: HOME_URL })].join("\n\n");
  return { to: "", subject: t("receipt.subject"), html, text };
}

type PaidOrderInfo = {
  orderId: string;
  gateway: string;
  name: string;
  email: string;
  months: number;
  amountIdr: number;
  /** What a Polar order charged, before tax, in its own currency (ISO code + minor units); null on IDR gateways and store orders. */
  charged: { currency: string; minor: number } | null;
  founderUntil: Date | null;
  /** Not really charged (Play license tester, Apple/Polar sandbox). */
  isTest?: boolean;
};

export const TEST_MARKER = "TEST (tidak ditagih)";

/** "Rp29.000", or "RM43.99 (setara Rp193.800 di ledger)" for a Polar order in another currency. */
export function amountLabel(info: Pick<PaidOrderInfo, "amountIdr" | "charged">): string {
  const idr = fmtIdr(info.amountIdr, "id");
  if (info.charged === null) return idr;
  return `${formatMinor(info.charged.minor, info.charged.currency)} (setara ${idr} di ledger)`;
}

/** The charged currency of a ledger row, or null when it was not paid through Polar. */
function chargedOf(row: { chargedCurrency: string | null; chargedAmountMinor: number | null }): PaidOrderInfo["charged"] {
  return row.chargedCurrency !== null && row.chargedAmountMinor !== null
    ? { currency: row.chargedCurrency, minor: row.chargedAmountMinor }
    : null;
}

export function adminDraft(info: PaidOrderInfo): Draft {
  const planLabel = info.months >= 12 ? "tahunan" : "bulanan";
  const rows: [string, string][] = [
    ...(info.isTest ? ([["Status", TEST_MARKER]] as [string, string][]) : []),
    ["Pembeli", `${info.name} (${info.email})`],
    ["Jumlah", amountLabel(info)],
    ["Paket", `Pro ${planLabel}`],
    ["Gateway", info.gateway],
    ["Order", info.orderId],
    // WIB on purpose: admin notice.
    ["Pro sampai", info.founderUntil ? formatWibDate(info.founderUntil) : "-"],
  ];
  const title = info.isTest ? `Pembayaran Pro masuk — ${TEST_MARKER}` : "Pembayaran Pro masuk";
  const html = shell(
    title,
    `<table style="width:100%;border-collapse:collapse;font-size:14px;">${rows
      .map(
        ([k, v]) =>
          `<tr><td style="padding:6px 0;color:${MUTED};white-space:nowrap;padding-right:12px;">${k}</td><td style="padding:6px 0;font-weight:600;">${v}</td></tr>`,
      )
      .join("")}</table>` +
      button("https://admin.joyorogo.com/#orders", "Lihat pesanan"),
    "id",
  );
  const text = [
    `${title}:`,
    ...rows.map(([k, v]) => `${k}: ${v}`),
    "https://admin.joyorogo.com/#orders",
  ].join("\n");
  return { to: "", subject: `${info.isTest ? `[${TEST_MARKER}] ` : ""}Pro baru: ${amountLabel(info)} — ${info.name}`, html, text };
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
      chargedCurrency: payment.chargedCurrency,
      chargedAmountMinor: payment.chargedAmountMinor,
      months: payment.months,
      founderUntil: payment.founderUntil,
      isTest: payment.isTest,
    })
    .from(payment)
    .innerJoin(user, eq(user.id, payment.userId))
    .where(and(eq(payment.orderId, order.orderId), eq(payment.status, "paid")))
    .limit(1);
  if (!row) return;

  // Polar is the merchant of record and mails its own receipt; ours would show the IDR ledger equivalent.
  if (order.gateway !== "polar" && (await claimEmail(db, order.userId, "receipt", order.orderId))) {
    const info: ReceiptInfo = {
      name: row.name,
      plan: row.months >= 12 ? "yearly" : "monthly",
      amountIdr: row.amountIdr,
      founderUntil: row.founderUntil ?? new Date(),
      founderDailyCap: config.founderDailyCap,
    };
    const locale = await userLocale(db, order.userId);
    await sendEmail(env, { ...receiptDraft(info, locale, await zoneOfUser(db, order.userId)), to: row.email });
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
      charged: chargedOf(row),
      founderUntil: row.founderUntil,
      isTest: row.isTest === 1,
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
    .where(and(eq(payment.userId, userId), eq(payment.status, "paid"), gt(payment.amountIdr, 0), realPayment));
  return row?.lowest ?? null;
}

function endingDraft(name: string, until: Date, locked: number | null, locale: Locale, zone: DayZone): Draft {
  const t = getT(locale, "email");
  const part = (html: boolean) => {
    const b = bold(html);
    const price =
      locked === null
        ? ""
        : ` ${t("ending.lockedPrice", { price: fmtIdr(Math.round(locked), locale) })}`;
    return {
      intro: t("ending.intro", { name, until: b(formatWibDate(until, locale, zone)) }),
      renew: `${t("ending.renew")}${price}`,
    };
  };
  const h = part(true);
  const html = shell(
    t("ending.subject", { until: formatWibDate(until, locale, zone) }),
    p(h.intro) + p(h.renew) + button(RENEW_URL, t("ending.cta")),
    locale,
  );
  const x = part(false);
  const text = [x.intro, x.renew, RENEW_URL].join("\n\n");
  return { to: "", subject: t("ending.subject", { until: formatWibDate(until, locale, zone) }), html, text };
}

function expiredDraft(name: string, locale: Locale): Draft {
  const t = getT(locale, "email");
  const intro = t("expired.intro", { name });
  const html = shell(
    t("expired.subject"),
    p(intro) + p(t("expired.reactivate")) + button(RENEW_URL, t("expired.cta")),
    locale,
  );
  const text = [intro, t("expired.reactivate"), RENEW_URL].join("\n\n");
  return { to: "", subject: t("expired.subject"), html, text };
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
    const locale = await userLocale(db, row.id);
    const draft = expired
      ? expiredDraft(row.name, locale)
      : endingDraft(row.name, new Date(untilMs), locked, locale, await zoneOfUser(db, row.id));
    await sendEmail(env, { ...draft, to: row.email });
    if (++sends >= 50) break;
  }
}

const ADMIN_URL = "https://admin.joyorogo.com";

const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const pct = (rate: number | null) => (rate === null ? "-" : `${Math.round(rate * 100)}%`);
const seconds = (ms: number | null) => (ms === null ? "-" : `${(ms / 1000).toFixed(1)} dtk`);

const decimal = (n: number) => String(n).replace(".", ",");

/**
 * The shadow test (prompt identitas + suhu 0,1 pada sebagian scan pertama,
 * tanpa efek ke pengguna) against what users saved. Empty when nothing was sampled.
 */
export function shadowDigestLines(shadow: ShadowReport | null): string[] {
  if (!shadow) return [];
  const head = `${shadow.sampled} scan disampel${shadow.failed > 0 ? ` (${shadow.failed} gagal)` : ""}, ${shadow.scored} disimpan pengguna (${shadow.corrected} dikoreksi).`;
  if (shadow.scored === 0) return [`${head} Belum ada yang bisa dibandingkan.`];
  const arm = (a: ShadowReport["prod"]) =>
    `nama cocok ${pct(a.f1)}, kalori kurang ${a.shortfallPct === null ? "-" : decimal(a.shortfallPct)}% (${a.over} lebih, ${a.under} kurang)`;
  return [
    head,
    `Produksi: ${arm(shadow.prod)}.`,
    `Bayangan: ${arm(shadow.shadow)}.`,
    `Lebih dekat ke simpanan: bayangan ${shadow.shadowCloser}, produksi ${shadow.prodCloser}, seri ${shadow.tie}` +
      (shadow.corrected > 0
        ? `; pada yang dikoreksi bayangan ${shadow.correctedShadowCloser}, produksi ${shadow.correctedProdCloser}.`
        : "."),
  ];
}

/**
 * Daily accuracy digest for the admins. Short, plain Indonesian: headline
 * numbers, the top problems with counts, regressions, a link. Dish names and
 * counts only; no user data. `report.scans.total` is never 0 here (the caller
 * skips quiet days).
 */
export function accuracyDigestDraft(report: AccuracyReport): Draft {
  const { scans, ratings, health, latency, corrections, regression } = report;
  const o = scans.outcomes;
  const day = formatWibDate(new Date(dayStartMs(report.date) + 12 * 60 * 60 * 1000), "id");
  const link = `${ADMIN_URL}/#laporan?date=${report.date}`;
  const flags = regression?.flags ?? [];

  const headline =
    scans.labelled > 0
      ? `${scans.total} scan (${scans.labelled} berlabel). ${o.accurate} tanpa koreksi (${pct(scans.accurateRate)}), ${o.corrected} dikoreksi, ` +
        `${o.retried} hitung ulang${o.abandoned > 0 ? `, ${o.abandoned} ditinggal` : ""}. ` +
        `Rata-rata 7 hari: ${pct(scans.weekRate)} tanpa koreksi.`
      : `${scans.total} scan, tapi belum ada yang berlabel (scan dari sebelum label koreksi dicatat), jadi angka tanpa koreksi belum bisa dihitung.`;
  const rated =
    ratings.total > 0
      ? `Penilaian: ${ratings.total} (${ratings.akurat} akurat, ${ratings.kurang} kurang akurat, ${ratings.salah} salah), ${ratings.notes.length} catatan baru.`
      : "Belum ada penilaian pengguna.";
  const problems = report.problems.map((problem) => problem.text);
  let regressionLines: string[];
  if (!regression || regression.error) {
    regressionLines = [`Uji regresi tidak jalan${regression?.error ? `: ${regression.error}` : ""}.`];
  } else if (flags.length > 0) {
    regressionLines = flags;
  } else if (regression.summary.cases + regression.summary.failed === 0) {
    regressionLines = [
      "Uji regresi belum punya bahan: belum ada foto berlabel (dataset pemilik atau foto feedback yang diizinkan).",
    ];
  } else {
    const s = regression.summary;
    regressionLines = [
      `Tidak ada regresi (${s.cases} foto uji, nama cocok ${pct(s.f1)}, kalori kurang rata-rata ${s.shortfallPct ?? "-"}%${
        regression.comparison ? "" : "; belum ada hari pembanding"
      }).`,
    ];
  }
  const shadowLines = shadowDigestLines(report.shadow ?? null);
  const failedText = health.failed.total > 0 ? `${health.failed.total} gagal` : "tidak ada gagal";
  const healthLine =
    `Kesehatan: ${failedText}, ${health.tooMany} terlalu banyak item, ${health.repaired} JSON diperbaiki. ` +
    `Waktu AI p50 ${seconds(latency.aiMs.p50)}, p95 ${seconds(latency.aiMs.p95)}. ` +
    `Koreksi ketik/suara dipakai ${corrections.used}x.`;
  const suggestions = report.suggestions.slice(0, 3).map((s) => `${s.text} (${s.evidence})`);

  const prefix = flags.length > 0 ? "[Regresi] " : "";
  const subject =
    scans.labelled > 0
      ? `${prefix}Akurasi scan ${day}: ${pct(scans.accurateRate)} tanpa koreksi, ${scans.total} scan`
      : `${prefix}Laporan scan ${day}: ${scans.total} scan, belum berlabel`;

  const textBlocks: string[] = [
    `Laporan akurasi scan, ${day}`,
    headline,
    rated,
    problems.length > 0
      ? ["Masalah teratas:", ...problems.map((t, i) => `${i + 1}. ${t}`)].join("\n")
      : "Tidak ada koreksi dish hari ini.",
    ["Regresi:", ...regressionLines.map((t) => `- ${t}`)].join("\n"),
    ...(shadowLines.length > 0 ? [["Uji bayangan:", ...shadowLines.map((t) => `- ${t}`)].join("\n")] : []),
    healthLine,
    ...(suggestions.length > 0
      ? [["Saran (tidak ada yang diubah otomatis):", ...suggestions.map((t) => `- ${t}`)].join("\n")]
      : []),
    `Detail: ${link}`,
  ];

  const list = (items: string[], ordered: boolean) => {
    const tag = ordered ? "ol" : "ul";
    return `<${tag} style="margin:0 0 14px;padding-left:20px;font-size:14px;line-height:1.6;">${items
      .map((item) => `<li>${escapeHtml(item)}</li>`)
      .join("")}</${tag}>`;
  };
  const heading = (text: string) =>
    `<p style="margin:0 0 6px;font-size:13px;font-weight:700;color:${INK};">${text}</p>`;
  const html = shell(
    escapeHtml(`Laporan akurasi scan, ${day}`),
    p(escapeHtml(headline)) +
      p(escapeHtml(rated)) +
      (problems.length > 0
        ? heading("Masalah teratas") + list(problems, true)
        : p("Tidak ada koreksi dish hari ini.")) +
      heading("Regresi") +
      list(regressionLines, false) +
      (shadowLines.length > 0 ? heading("Uji bayangan") + list(shadowLines, false) : "") +
      p(escapeHtml(healthLine)) +
      (suggestions.length > 0
        ? heading("Saran (tidak ada yang diubah otomatis)") + list(suggestions, false)
        : "") +
      button(link, "Buka laporan"),
    "id",
  );
  return { to: "", subject, html, text: textBlocks.join("\n\n") };
}

/**
 * Sends the digest to ADMIN_EMAILS once per report day (email_log kind
 * "accuracy_digest", ref = the report date). Quiet days (no scans) send nothing.
 * A failed send releases its claim so the next attempt can retry.
 */
export async function sendAccuracyDigest(
  env: EmailEnv,
  db: Database,
  report: AccuracyReport,
): Promise<Pick<EmailState, "status" | "detail">> {
  if (report.scans.total === 0) return { status: "skipped_no_scans" };
  const admins = (env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  if (admins.length === 0 || !env.EMAIL || !env.EMAIL_FROM) {
    return { status: "off", detail: "no ADMIN_EMAILS, EMAIL binding or EMAIL_FROM" };
  }
  // email_log rows belong to a user: the first admin who has an account.
  const [owner] = await db
    .select({ id: user.id })
    .from(user)
    .where(sql`lower(${user.email}) in (${sql.join(admins.map((email) => sql`${email}`), sql`, `)})`)
    .limit(1);
  if (!owner) return { status: "failed", detail: "no user account for ADMIN_EMAILS" };
  if (!(await claimEmail(db, owner.id, "accuracy_digest", report.date))) {
    return { status: "sent", detail: "already in email_log" };
  }
  const result = await sendEmail(env, { ...accuracyDigestDraft(report), to: admins });
  if (result !== "sent") {
    await db
      .delete(emailLog)
      .where(and(eq(emailLog.kind, "accuracy_digest"), eq(emailLog.ref, report.date)));
    return { status: "failed", detail: result };
  }
  return { status: "sent" };
}
