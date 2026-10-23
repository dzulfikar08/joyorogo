import { and, desc, eq, gt, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import type { JoyoAuth } from "@joyorogo/auth";
import type { Context, Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { readChunked } from "@joyorogo/api/lib/d1";
import { commentPhotoKeysOf } from "@joyorogo/api/lib/comment-attachment";
import { shiftDate } from "@joyorogo/api/lib/engine";
import { feedbackPhotoKey } from "@joyorogo/api/lib/feedback-keep";
import { accuracyReportSummary } from "@joyorogo/api/lib/accuracy-report";
import {
  RETRY_TAP_CUTOVER_MS,
  isSessionSql,
  outcomeSql,
  parseFeedbackReasons,
  parseSession,
  retryDerivedSql,
  wibDaySql as wibDay,
} from "@joyorogo/api/lib/scan-outcome";
import type { ScanOutcome, ScanSession } from "@joyorogo/api/lib/scan-outcome";
import { wibDayBounds } from "@joyorogo/api/lib/tiers";
import { SCAN_ID_RE, scanSrcKey } from "@joyorogo/api/lib/sticker";
import type { StickersBucket } from "@joyorogo/api/lib/sticker";
import { session, user } from "@joyorogo/db/schema/auth";
import { payment } from "@joyorogo/db/schema/billing";
import { realPayment } from "./real-payment";
import { aiUsage, foodLog, profile, scanFeedback } from "@joyorogo/db/schema/fitness";
import { post as postTable, postComment, socialReport } from "@joyorogo/db/schema/social";
import type { Database } from "@joyorogo/db";

import { listReportDates, readReport } from "./accuracy-job";
import { DAY_MS, IDLE_DAYS, intSql, scanSql } from "./admin-scans";
import type { ScanSql } from "./admin-scans";
import { internalEmailsSql } from "./internal-accounts";

const THIRTY_DAYS = 30;

type OutcomeCounts = Record<ScanOutcome, number>;
// Abuse heuristics shared by the users filter and the console badges.
const ABUSE_TODAY = 50;
const ABUSE_7D = 300;

const PAGE_SIZES = [10, 25, 50, 100];
const DEFAULT_PAGE_SIZE = 25;

/** page + pageSize accepted by every paged admin list. */
const pagingShape = {
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce
    .number()
    .int()
    .refine((n) => PAGE_SIZES.includes(n), {
      message: `must be one of ${PAGE_SIZES.join(", ")}`,
    })
    .default(DEFAULT_PAGE_SIZE),
};
const pagingSchema = z.object(pagingShape);

/** Optional enum filter; an empty value (cleared filter) counts as absent. */
const filterEnum = <const T extends readonly [string, ...string[]]>(values: T) =>
  z.preprocess((v) => (v === "" ? undefined : v), z.enum(values).optional());
const searchTerm = z.string().trim().max(100).optional();

/** Parses the query string; a bad value is a 400 `{ error: "field: reason" }`, never a silent default. */
function parseQuery<S extends z.ZodType>(c: Context, schema: S): z.output<S> {
  const parsed = schema.safeParse(c.req.query());
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  const field = issue?.path.join(".");
  const message = `${field ? `${field}: ` : ""}${issue?.message ?? "invalid query"}`;
  throw new HTTPException(400, { res: c.json({ error: message }, 400) });
}

const offsetOf = ({ page, pageSize }: { page: number; pageSize: number }) => (page - 1) * pageSize;

/**
 * Case-insensitive substring match over any column. instr() takes the term as a plain value: a LIKE pattern is capped
 * at 50 bytes on D1 (and escaping `%`, `_`, `\\` would grow it), while the search box allows 100 characters.
 */
const containsAny = (columns: unknown[], term: string) => {
  const needle = term.toLowerCase();
  return sql`(${sql.join(
    columns.map((column) => sql`instr(lower(${column}), ${needle}) > 0`),
    sql` or `,
  )})`;
};

const userPatchSchema = z
  .object({
    tier: z.enum(["free", "founder"]).optional(),
    // ISO date-time or null to clear the paid Founder period.
    founderUntil: z.string().datetime().nullable().optional(),
    aiUnlimited: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "nothing to change" });

type Deps = {
  /** Comma-separated Google emails allowed in (ADMIN_EMAILS). Empty = admin off. */
  adminEmails: string | undefined;
  getDb: () => Database;
  createAuth: () => Promise<JoyoAuth>;
  /** Stickers R2 bucket, for feedback photo thumbnails. Missing = no thumbs. */
  getBucket: () => StickersBucket | undefined;
  reconcileById: (orderId: string) => Promise<string>;
  /** Sends a test email to `to`; returns the send outcome text. */
  sendTestEmail: (to: string) => Promise<string>;
  /** Clock in ms; tests pin it to hit Jakarta day boundaries. Default Date.now. */
  now?: () => number;
};

/** Removes the R2 objects of comment photos whose rows an admin delete just cascaded away. */
async function deleteCommentPhotos(
  bucket: StickersBucket | undefined,
  rows: { userId: string; attachmentJson: string | null }[],
): Promise<void> {
  const keys = commentPhotoKeysOf(rows);
  if (bucket && keys.length > 0) await bucket.delete(keys).catch(() => {});
}

/**
 * Operator console API for admin.joyorogo.com. Same better-auth session as
 * the app (cookie on api.joyorogo.com); access is a verified Google email on
 * the ADMIN_EMAILS allowlist. Read-only except the gateway re-check, which is
 * the same idempotent settle path the webhook uses.
 */
export function registerAdminRoutes(app: Hono, deps: Deps) {
  const allowed = new Set(
    (deps.adminEmails ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );

  // 401 = not signed in (console shows Google sign-in), 403 = signed in but not allowed.
  app.use("/api/admin/*", async (c, next) => {
    const session = await (await deps.createAuth()).api.getSession({ headers: c.req.raw.headers });
    const me = session?.user;
    if (!me) return c.json({ error: "unauthenticated" }, 401);
    if (!me.emailVerified || !allowed.has(me.email.toLowerCase())) {
      return c.json({ error: "forbidden" }, 403);
    }
    await next();
  });

  app.get("/api/admin/me", (c) => c.json({ ok: true }));

  // One row of the users list / detail: profile, plan, and per-user scan
  // activity (see admin-scans.ts for what a "scan" is). Correlated subqueries
  // must name the outer table: drizzle renders a bare column ref as "id",
  // which the inner FROM would resolve to its own id.
  const userColumns = (scans: ScanSql, now: number) => {
    const uid = sql.raw(`"user"."id"`);
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
      // Effective tier (paid period counts); manualTier is the raw comp column.
      tier: sql<"free" | "founder">`case when (${user.tier} = 'founder' or ${user.founderUntil} > ${intSql(now)}) then 'founder' else 'free' end`,
      plan: scans.plan,
      manualTier: user.tier,
      founderUntil: user.founderUntil,
      aiUnlimited: user.aiUnlimited,
      createdAt: user.createdAt,
      lastSeen: sql<number | null>`(select max(updated_at) from session where session.user_id = ${uid})`,
      scansToday: scans.scansToday,
      scansYesterday: scans.scansYesterday,
      scans7d: sql<number>`(select count(*) from ai_usage where ai_usage.user_id = ${uid} and ai_usage.scan_type = 'user' and ai_usage.created_at >= ${intSql(now - 7 * DAY_MS)})`,
      scansTotal: sql<number>`(select count(*) from ai_usage where ai_usage.user_id = ${uid} and ai_usage.scan_type = 'user')`,
      streak: scans.streak,
      lastScanAt: scans.lastScanAt,
      foodLogs: sql<number>`(select count(*) from food_log where food_log.user_id = ${uid})`,
      onboarded: sql<number>`(select count(*) from profile where profile.user_id = ${uid})`,
      pendingOrders: sql<number>`(select count(*) from payment where payment.user_id = ${uid} and payment.status = 'pending')`,
      paidOrders: sql<number>`(select count(*) from payment where payment.user_id = ${uid} and payment.status = 'paid' and payment.amount_idr > 0)`,
    };
  };

  // Paged, filtered user list. Query: q (name/email), plan=paid|founder|free
  // (founder = manual comp), idle=1|3|7 (no scan today nor in the N days
  // before; never-scanned users included), abuse=1,
  // sort=newest|lastSeen|scansToday|scansYesterday|scans7d|scansTotal|streak|lastScan,
  // dir=asc|desc (default desc), page, pageSize. Every sort ends in
  // created_at desc, id desc so pages are stable.
  const usersQuery = pagingSchema.extend({
    q: searchTerm,
    plan: filterEnum(["paid", "founder", "free"]),
    idle: filterEnum(IDLE_DAYS),
    abuse: filterEnum(["1"]),
    sort: z
      .enum([
        "newest",
        "lastSeen",
        "scansToday",
        "scansYesterday",
        "scans7d",
        "scansTotal",
        "streak",
        "lastScan",
      ])
      .default("newest"),
    dir: filterEnum(["asc", "desc"]),
  });
  app.get("/api/admin/users", async (c) => {
    const now = deps.now?.() ?? Date.now();
    const query = parseQuery(c, usersQuery);
    const { page, pageSize } = query;
    const scans = scanSql(now);
    const cols = userColumns(scans, now);

    const filters = and(
      query.q ? containsAny([user.name, user.email], query.q) : undefined,
      query.plan ? sql`${scans.plan} = ${query.plan}` : undefined,
      query.idle ? scans.idleFor(Number(query.idle)) : undefined,
      query.abuse
        ? sql`(${cols.scansToday} >= ${ABUSE_TODAY} or ${cols.scans7d} >= ${ABUSE_7D})`
        : undefined,
    );
    // Nulls (never seen, never scanned) sort as the smallest value.
    const dir = query.dir === "asc" ? sql`asc` : sql`desc`;
    const primaryOrder = {
      newest: query.dir === "asc" ? sql`${user.createdAt} asc` : undefined,
      lastSeen: sql`${cols.lastSeen} ${dir}`,
      scansToday: sql`${cols.scansToday} ${dir}`,
      scansYesterday: sql`${cols.scansYesterday} ${dir}`,
      scans7d: sql`${cols.scans7d} ${dir}`,
      scansTotal: sql`${cols.scansTotal} ${dir}`,
      streak: sql`${cols.streak} ${dir}`,
      lastScan: sql`${cols.lastScanAt} ${dir}`,
    }[query.sort];

    const db = deps.getDb();
    // Order + page on ids only: the per-row stats are correlated subqueries,
    // so computing all of them for every user before the sort would scale with
    // the whole table instead of the page.
    const [pageIds, [count]] = await Promise.all([
      db
        .select({ id: user.id })
        .from(user)
        .where(filters)
        .orderBy(...(primaryOrder ? [primaryOrder] : []), desc(user.createdAt), desc(user.id))
        .limit(pageSize)
        .offset(offsetOf(query)),
      db.select({ total: sql<number>`count(*)` }).from(user).where(filters),
    ]);
    const details =
      pageIds.length === 0
        ? []
        : await db
            .select(cols)
            .from(user)
            .where(
              inArray(
                user.id,
                pageIds.map((row) => row.id),
              ),
            );
    const byId = new Map(details.map((row) => [row.id, row]));
    const rows = pageIds.flatMap(({ id }) => byId.get(id) ?? []);
    return c.json({ users: rows, total: count?.total ?? 0, page, pageSize });
  });

  // Headline numbers for the dashboard cards.
  app.get("/api/admin/overview", async (c) => {
    const now = deps.now?.() ?? Date.now();
    const scans = scanSql(now);
    const { startMs, endMs } = wibDayBounds(scans.today);
    const db = deps.getDb();
    const [[row], planRows] = await Promise.all([
      db
        .select({
          users: sql<number>`(select count(*) from user where email not in (${internalEmailsSql}))`,
          signupsToday: sql<number>`(select count(*) from user where email not in (${internalEmailsSql}) and created_at between ${startMs} and ${endMs})`,
          signups7d: sql<number>`(select count(*) from user where email not in (${internalEmailsSql}) and created_at >= ${now - 7 * DAY_MS})`,
          onboarded: sql<number>`(select count(*) from profile where user_id not in (select id from user where email in (${internalEmailsSql})))`,
          activeToday: sql<number>`(select count(distinct user_id) from session where user_id not in (select id from user where email in (${internalEmailsSql})) and updated_at between ${startMs} and ${endMs})`,
          founders: sql<number>`(select count(*) from user where tier = 'founder' or founder_until > ${now})`,
          scansToday: sql<number>`(select count(*) from ai_usage where scan_type = 'user' and created_at between ${startMs} and ${endMs})`,
          scans7d: sql<number>`(select count(*) from ai_usage where scan_type = 'user' and created_at >= ${now - 7 * DAY_MS})`,
          anonScansToday: sql<number>`(select count(*) from ai_usage where scan_type != 'user' and created_at between ${startMs} and ${endMs})`,
          pendingOrders: sql<number>`(select count(*) from payment where status = 'pending')`,
          paidOrders: sql<number>`(select count(*) from payment where status = 'paid' and amount_idr > 0 and coalesce(is_test, 0) = 0)`,
          revenueIdr: sql<number>`(select coalesce(sum(amount_idr), 0) from payment where status = 'paid' and coalesce(is_test, 0) = 0)`,
        })
        // Every column is a scalar subquery; any one-row source works.
        .from(user)
        .limit(1),
      // Scan activity per plan: how many accounts scanned yesterday / today.
      db
        .select({
          plan: scans.plan,
          users: sql<number>`count(*)`,
          activeYesterday: sql<number>`coalesce(sum(${scans.activeYesterday}), 0)`,
          activeToday: sql<number>`coalesce(sum(${scans.activeToday}), 0)`,
        })
        .from(user)
        .where(sql`${user.email} not in (${internalEmailsSql})`)
        .groupBy(scans.plan),
    ]);
    const empty = { users: 0, activeYesterday: 0, activeToday: 0 };
    const planStats = { paid: { ...empty }, founder: { ...empty }, free: { ...empty } };
    for (const { plan, ...counts } of planRows) planStats[plan] = counts;
    return c.json({ ...row, plans: planStats });
  });

  // Per-WIB-day series: scans, distinct scanning users, signups, paid orders.
  app.get("/api/admin/usage", async (c) => {
    const days = Math.min(90, Math.max(1, Number(c.req.query("days")) || 30));
    const since = Date.now() - days * DAY_MS;
    const db = deps.getDb();
    const [scans, signups, paid] = await Promise.all([
      db
        .select({
          day: wibDay(aiUsage.createdAt),
          scans: sql<number>`count(*)`,
          users: sql<number>`count(distinct ${aiUsage.userId})`,
        })
        .from(aiUsage)
        .where(and(eq(aiUsage.scanType, "user"), sql`${aiUsage.createdAt} >= ${since}`))
        .groupBy(wibDay(aiUsage.createdAt)),
      db
        .select({ day: wibDay(user.createdAt), signups: sql<number>`count(*)` })
        .from(user)
        .where(sql`${user.createdAt} >= ${since} and ${user.email} not in (${internalEmailsSql})`)
        .groupBy(wibDay(user.createdAt)),
      db
        .select({
          day: wibDay(payment.paidAt),
          paid: sql<number>`count(*)`,
          revenueIdr: sql<number>`sum(${payment.amountIdr})`,
        })
        .from(payment)
        .where(and(eq(payment.status, "paid"), gt(payment.amountIdr, 0), realPayment, sql`${payment.paidAt} >= ${since}`))
        .groupBy(wibDay(payment.paidAt)),
    ]);
    const byDay: Record<string, { day: string; scans: number; scanUsers: number; signups: number; paid: number; revenueIdr: number }> = {};
    const row = (day: string) =>
      (byDay[day] ??= { day, scans: 0, scanUsers: 0, signups: 0, paid: 0, revenueIdr: 0 });
    for (const s of scans) Object.assign(row(s.day), { scans: s.scans, scanUsers: s.users });
    for (const s of signups) row(s.day).signups = s.signups;
    for (const p of paid) Object.assign(row(p.day), { paid: p.paid, revenueIdr: p.revenueIdr });
    return c.json({ days: Object.values(byDay).sort((a, b) => a.day.localeCompare(b.day)) });
  });

  // One user: the list row (plan, scan activity) + a 30-day scan chart (Jakarta
  // days, oldest first, zero-filled). The long lists (AI calls, food logs,
  // orders, sessions) page through their own endpoints below.
  app.get("/api/admin/users/:id", async (c) => {
    const id = c.req.param("id");
    const now = deps.now?.() ?? Date.now();
    const scans = scanSql(now);
    const db = deps.getDb();
    const firstDay = shiftDate(scans.today, 1 - THIRTY_DAYS);
    const [[row], counts] = await Promise.all([
      db.select(userColumns(scans, now)).from(user).where(eq(user.id, id)).limit(1),
      db
        .select({ day: wibDay(aiUsage.createdAt), scans: sql<number>`count(*)` })
        .from(aiUsage)
        .where(
          and(
            eq(aiUsage.userId, id),
            eq(aiUsage.scanType, "user"),
            sql`${aiUsage.createdAt} >= ${wibDayBounds(firstDay).startMs}`,
          ),
        )
        .groupBy(wibDay(aiUsage.createdAt)),
    ]);
    if (!row) return c.json({ error: "user not found" }, 404);
    const byDay = new Map(counts.map((r) => [r.day, r.scans]));
    const perDay = Array.from({ length: THIRTY_DAYS }, (_, i) => {
      const day = shiftDate(firstDay, i);
      return { day, scans: byDay.get(day) ?? 0 };
    });
    return c.json({ user: row, perDay });
  });

  // Paged per-user lists, newest first (id as the tiebreak): page, pageSize.
  app.get("/api/admin/users/:id/calls", async (c) => {
    const id = c.req.param("id");
    const query = parseQuery(c, pagingSchema);
    const db = deps.getDb();
    const [calls, [count]] = await Promise.all([
      db
        .select({
          createdAt: aiUsage.createdAt,
          scanType: aiUsage.scanType,
          model: aiUsage.model,
          latencyMs: aiUsage.latencyMs,
          kind: sql<string>`coalesce(json_extract(${aiUsage.usageJson}, '$.kind'), 'photo')`,
        })
        .from(aiUsage)
        .where(eq(aiUsage.userId, id))
        .orderBy(desc(aiUsage.createdAt), desc(aiUsage.id))
        .limit(query.pageSize)
        .offset(offsetOf(query)),
      db.select({ total: sql<number>`count(*)` }).from(aiUsage).where(eq(aiUsage.userId, id)),
    ]);
    return c.json({ calls, total: count?.total ?? 0, page: query.page, pageSize: query.pageSize });
  });

  app.get("/api/admin/users/:id/foods", async (c) => {
    const id = c.req.param("id");
    const query = parseQuery(c, pagingSchema);
    const db = deps.getDb();
    const [foods, [count]] = await Promise.all([
      db
        .select({
          date: foodLog.date,
          meal: foodLog.meal,
          name: foodLog.name,
          kcal: foodLog.kcal,
          source: foodLog.source,
          createdAt: foodLog.createdAt,
        })
        .from(foodLog)
        .where(eq(foodLog.userId, id))
        .orderBy(desc(foodLog.createdAt), desc(foodLog.id))
        .limit(query.pageSize)
        .offset(offsetOf(query)),
      db.select({ total: sql<number>`count(*)` }).from(foodLog).where(eq(foodLog.userId, id)),
    ]);
    return c.json({ foods, total: count?.total ?? 0, page: query.page, pageSize: query.pageSize });
  });

  app.get("/api/admin/users/:id/orders", async (c) => {
    const id = c.req.param("id");
    const query = parseQuery(c, pagingSchema);
    const db = deps.getDb();
    const [orders, [count]] = await Promise.all([
      db
        .select()
        .from(payment)
        .where(eq(payment.userId, id))
        .orderBy(desc(payment.createdAt), desc(payment.orderId))
        .limit(query.pageSize)
        .offset(offsetOf(query)),
      db.select({ total: sql<number>`count(*)` }).from(payment).where(eq(payment.userId, id)),
    ]);
    return c.json({ orders, total: count?.total ?? 0, page: query.page, pageSize: query.pageSize });
  });

  app.get("/api/admin/users/:id/sessions", async (c) => {
    const id = c.req.param("id");
    const query = parseQuery(c, pagingSchema);
    const db = deps.getDb();
    const [sessions, [count]] = await Promise.all([
      db
        .select({
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
          userAgent: session.userAgent,
          ipAddress: session.ipAddress,
        })
        .from(session)
        .where(eq(session.userId, id))
        .orderBy(desc(session.updatedAt), desc(session.id))
        .limit(query.pageSize)
        .offset(offsetOf(query)),
      db.select({ total: sql<number>`count(*)` }).from(session).where(eq(session.userId, id)),
    ]);
    return c.json({
      sessions,
      total: count?.total ?? 0,
      page: query.page,
      pageSize: query.pageSize,
    });
  });

  // Manual tier switch: comp Founder, end a paid period, lift/restore the quota.
  app.patch("/api/admin/users/:id", async (c) => {
    const parsed = userPatchSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? "invalid" }, 400);
    const { tier, founderUntil, aiUnlimited } = parsed.data;
    const updated = await deps
      .getDb()
      .update(user)
      .set({
        ...(tier !== undefined ? { tier } : {}),
        ...(founderUntil !== undefined
          ? { founderUntil: founderUntil === null ? null : new Date(founderUntil) }
          : {}),
        ...(aiUnlimited !== undefined ? { aiUnlimited } : {}),
      })
      .where(eq(user.id, c.req.param("id")))
      .returning({
        id: user.id,
        tier: user.tier,
        founderUntil: user.founderUntil,
        aiUnlimited: user.aiUnlimited,
      });
    if (updated.length === 0) return c.json({ error: "user not found" }, 404);
    return c.json(updated[0]);
  });

  // Paged orders. Query: status=pending|paid|failed, q (name/email/order id),
  // page, pageSize. Newest first, order id as the tiebreak.
  const ordersQuery = pagingSchema.extend({
    status: filterEnum(["pending", "paid", "failed"]),
    q: searchTerm,
  });
  app.get("/api/admin/orders", async (c) => {
    const query = parseQuery(c, ordersQuery);
    const { page, pageSize } = query;
    const filters = and(
      query.status ? eq(payment.status, query.status) : undefined,
      query.q ? containsAny([user.name, user.email, payment.orderId], query.q) : undefined,
    );
    const db = deps.getDb();
    const counted = db.select({ total: sql<number>`count(*)` }).from(payment);
    const [rows, [count]] = await Promise.all([
      db
        .select({
          orderId: payment.orderId,
          userId: payment.userId,
          name: user.name,
          email: user.email,
          amountIdr: payment.amountIdr,
          chargedCurrency: payment.chargedCurrency,
          chargedAmountMinor: payment.chargedAmountMinor,
          status: payment.status,
          paymentUrl: payment.paymentUrl,
          createdAt: payment.createdAt,
          paidAt: payment.paidAt,
          founderUntil: payment.founderUntil,
          isTest: payment.isTest,
        })
        .from(payment)
        .innerJoin(user, eq(user.id, payment.userId))
        .where(filters)
        .orderBy(desc(payment.createdAt), desc(payment.orderId))
        .limit(pageSize)
        .offset(offsetOf(query)),
      // Only a search touches user columns; payment.user_id is a NOT NULL FK, so the join never drops rows.
      query.q
        ? counted.innerJoin(user, eq(user.id, payment.userId)).where(filters)
        : counted.where(filters),
    ]);
    return c.json({ orders: rows, total: count?.total ?? 0, page, pageSize });
  });

  app.post("/api/admin/orders/:orderId/check", async (c) =>
    c.json({ outcome: await deps.reconcileById(c.req.param("orderId")) }),
  );

  // Deliverability check: send a test email to the signed-in admin.
  app.post("/api/admin/test-email", async (c) => {
    const session = await (await deps.createAuth()).api.getSession({ headers: c.req.raw.headers });
    return c.json({ outcome: await deps.sendTestEmail(session!.user.email) });
  });

  // --- Feed komunitas: laporan konten -----------------------------------------

  const reporter = alias(user, "reporter");
  const postAuthor = alias(user, "post_author");
  const commentAuthor = alias(user, "comment_author");
  const commentAuthorProfile = alias(profile, "comment_author_profile");
  const postAuthorProfile = alias(profile, "post_author_profile");

  app.get("/api/admin/reports", async (c) => {
    const query = parseQuery(
      c,
      pagingSchema.extend({ status: z.enum(["pending", "resolved", "all"]).default("pending") }),
    );
    const { page, pageSize, status } = query;
    const filters =
      status === "all"
        ? undefined
        : status === "resolved"
          ? isNotNull(socialReport.resolvedAt)
          : isNull(socialReport.resolvedAt);
    const db = deps.getDb();
    const [rows, [count]] = await Promise.all([
      db
        .select({
          id: socialReport.id,
          reason: socialReport.reason,
          note: socialReport.note,
          createdAt: socialReport.createdAt,
          resolvedAt: socialReport.resolvedAt,
          postId: socialReport.postId,
          commentId: socialReport.commentId,
          postKind: postTable.kind,
          postTitle: postTable.title,
          postCaption: postTable.caption,
          postVisibility: postTable.visibility,
          postPhotoId: postTable.photoId,
          postPhotosJson: postTable.photosJson,
          postAuthorName: postAuthor.name,
          postAuthorHandle: postAuthorProfile.handle,
          commentBody: postComment.body,
          commentAuthorName: commentAuthor.name,
          commentAuthorHandle: commentAuthorProfile.handle,
          reporterName: reporter.name,
          reporterEmail: reporter.email,
        })
        .from(socialReport)
        .innerJoin(reporter, eq(reporter.id, socialReport.reporterId))
        .leftJoin(postTable, eq(postTable.id, socialReport.postId))
        .leftJoin(postAuthor, eq(postAuthor.id, postTable.userId))
        .leftJoin(postAuthorProfile, eq(postAuthorProfile.userId, postTable.userId))
        .leftJoin(postComment, eq(postComment.id, socialReport.commentId))
        .leftJoin(commentAuthor, eq(commentAuthor.id, postComment.userId))
        .leftJoin(commentAuthorProfile, eq(commentAuthorProfile.userId, postComment.userId))
        .where(filters)
        .orderBy(desc(socialReport.createdAt), desc(socialReport.id))
        .limit(pageSize)
        .offset(offsetOf(query)),
      db.select({ total: sql<number>`count(*)` }).from(socialReport).where(filters),
    ]);
    return c.json({ reports: rows, total: count?.total ?? 0, page, pageSize });
  });

  // Menutup laporan tanpa menghapus konten (salah laporan / sudah beres).
  app.post("/api/admin/reports/:id/resolve", async (c) => {
    await deps
      .getDb()
      .update(socialReport)
      .set({ resolvedAt: new Date() })
      .where(eq(socialReport.id, c.req.param("id")));
    return c.json({ ok: true });
  });

  // Hapus konten yang dilaporkan; kudos/komentar/notifikasi/laporan ikut
  // terhapus lewat ON DELETE CASCADE.
  app.delete("/api/admin/posts/:id", async (c) => {
    const db = deps.getDb();
    const postId = c.req.param("id");
    // Comment photos go with the post's comments (cascade), so their keys are read first.
    const photos = await db
      .select({ userId: postComment.userId, attachmentJson: postComment.attachmentJson })
      .from(postComment)
      .where(and(eq(postComment.postId, postId), isNotNull(postComment.attachmentJson)));
    await db.delete(postTable).where(eq(postTable.id, postId));
    await deleteCommentPhotos(deps.getBucket(), photos);
    return c.json({ ok: true });
  });

  app.delete("/api/admin/comments/:id", async (c) => {
    const db = deps.getDb();
    const id = c.req.param("id");
    // The comment and its replies (cascade) take their photos with them.
    const photos = await db
      .select({ userId: postComment.userId, attachmentJson: postComment.attachmentJson })
      .from(postComment)
      .where(and(or(eq(postComment.id, id), eq(postComment.parentId, id)), isNotNull(postComment.attachmentJson)));
    await db.delete(postComment).where(eq(postComment.id, id));
    await deleteCommentPhotos(deps.getBucket(), photos);
    return c.json({ ok: true });
  });

  // Feedback scan. Two views, kept apart:
  //  - implicit outcomes per scan session (ai_usage usage_json, see
  //    scan-outcome.ts): accurate / corrected / retried / abandoned / pending,
  //    per WIB day and model, plus plate-level kcal bias of corrected sessions;
  //  - explicit "Hasilnya akurat?" ratings (scan_feedback), without the rows
  //    that only record a "Hitung ulang" tap (counted in `retryLegacy`).
  // Dismissals (`dilewati`) are excluded from every metric. The negative
  // results themselves page through /api/admin/feedback/negatives.
  const negativeRating = inArray(scanFeedback.rating, ["kurang_akurat", "salah"]);
  const retryDerived = retryDerivedSql();
  app.get("/api/admin/feedback", async (c) => {
    const days = Math.min(90, Math.max(1, Number(c.req.query("days")) || 30));
    const now = Date.now();
    const since = now - days * DAY_MS;
    const db = deps.getDb();
    const rated = and(
      ne(scanFeedback.rating, "dilewati"),
      sql`${scanFeedback.createdAt} >= ${since}`,
    );
    const explicitOnly = and(rated, sql`not ${retryDerived}`);
    const accuracy = {
      total: sql<number>`count(*)`,
      akurat: sql<number>`coalesce(sum(case when ${scanFeedback.rating} = 'akurat' then 1 else 0 end), 0)`,
      kurang: sql<number>`coalesce(sum(case when ${scanFeedback.rating} = 'kurang_akurat' then 1 else 0 end), 0)`,
      salah: sql<number>`coalesce(sum(case when ${scanFeedback.rating} = 'salah' then 1 else 0 end), 0)`,
    };
    const outcome = outcomeSql(now);
    const sessionWindow = and(isSessionSql(), sql`${aiUsage.createdAt} >= ${since}`);
    const aiKcal = sql`json_extract(${aiUsage.usageJson}, '$.diff.aiKcal')`;
    const savedKcal = sql`json_extract(${aiUsage.usageJson}, '$.diff.savedKcal')`;
    const pct = sql`((${aiKcal} - ${savedKcal}) * 100.0 / ${savedKcal})`;
    const correctedWithKcal = and(
      sessionWindow,
      sql`${outcome} = 'corrected'`,
      sql`${aiKcal} is not null and ${savedKcal} > 0`,
    );
    const [byDay, byModel, [negatives], [explicit], [retryLegacy], outcomeRows, biasRows] =
      await Promise.all([
        db
          .select({ day: wibDay(scanFeedback.createdAt), ...accuracy })
          .from(scanFeedback)
          .where(explicitOnly)
          .groupBy(wibDay(scanFeedback.createdAt)),
        db
          .select({ model: scanFeedback.model, ...accuracy })
          .from(scanFeedback)
          .where(explicitOnly)
          .groupBy(scanFeedback.model),
        db
          .select({
            total: sql<number>`count(*)`,
            afterRetry: sql<number>`coalesce(sum(case when ${scanFeedback.afterRetry} = 1 then 1 else 0 end), 0)`,
          })
          .from(scanFeedback)
          .where(negativeRating),
        db.select(accuracy).from(scanFeedback).where(explicitOnly),
        db
          .select({ total: sql<number>`count(*)` })
          .from(scanFeedback)
          .where(and(rated, retryDerived)),
        db
          .select({
            day: wibDay(aiUsage.createdAt),
            model: aiUsage.model,
            outcome,
            n: sql<number>`count(*)`,
          })
          .from(aiUsage)
          .where(sessionWindow)
          .groupBy(wibDay(aiUsage.createdAt), aiUsage.model, outcome),
        db
          .select({
            model: aiUsage.model,
            n: sql<number>`count(*)`,
            over: sql<number>`sum(case when ${aiKcal} > ${savedKcal} then 1 else 0 end)`,
            under: sql<number>`sum(case when ${aiKcal} < ${savedKcal} then 1 else 0 end)`,
            sumPct: sql<number>`sum(${pct})`,
            sumOverPct: sql<number>`coalesce(sum(case when ${aiKcal} > ${savedKcal} then ${pct} end), 0)`,
            sumUnderPct: sql<number>`coalesce(sum(case when ${aiKcal} < ${savedKcal} then ${pct} end), 0)`,
          })
          .from(aiUsage)
          .where(correctedWithKcal)
          .groupBy(aiUsage.model),
      ]);

    const emptyCounts = (): OutcomeCounts => ({
      accurate: 0,
      corrected: 0,
      retried: 0,
      abandoned: 0,
      pending: 0,
    });
    const total = emptyCounts();
    const perDay = new Map<string, OutcomeCounts>();
    const perModel = new Map<string | null, OutcomeCounts>();
    for (const row of outcomeRows) {
      const n = Number(row.n);
      total[row.outcome] += n;
      const d = perDay.get(row.day) ?? emptyCounts();
      d[row.outcome] += n;
      perDay.set(row.day, d);
      const m = perModel.get(row.model) ?? emptyCounts();
      m[row.outcome] += n;
      perModel.set(row.model, m);
    }

    const biasOf = (rows: typeof biasRows) => {
      const n = rows.reduce((s, r) => s + Number(r.n), 0);
      const over = rows.reduce((s, r) => s + Number(r.over), 0);
      const under = rows.reduce((s, r) => s + Number(r.under), 0);
      const mean = (sum: number, count: number) =>
        count > 0 ? Math.round((sum / count) * 10) / 10 : null;
      return {
        n,
        over,
        under,
        // Signed: positive = the AI ran above what the user saved.
        meanPct: mean(rows.reduce((s, r) => s + Number(r.sumPct), 0), n),
        meanOverPct: mean(rows.reduce((s, r) => s + Number(r.sumOverPct), 0), over),
        meanUnderPct: mean(rows.reduce((s, r) => s + Number(r.sumUnderPct), 0), under),
      };
    };

    return c.json({
      days,
      byDay,
      byModel,
      explicit: explicit ?? { total: 0, akurat: 0, kurang: 0, salah: 0 },
      retryLegacy: retryLegacy?.total ?? 0,
      negatives: negatives ?? { total: 0, afterRetry: 0 },
      outcomes: {
        total,
        byDay: [...perDay].map(([day, counts]) => ({ day, ...counts })),
        byModel: [...perModel].map(([model, counts]) => ({ model, ...counts })),
      },
      bias: {
        total: biasOf(biasRows),
        byModel: biasRows.map((row) => ({ model: row.model, ...biasOf([row]) })),
      },
    });
  });

  // Paged negative results, newest first (id as the tiebreak): page, pageSize.
  app.get("/api/admin/feedback/negatives", async (c) => {
    const query = parseQuery(c, pagingSchema);
    const db = deps.getDb();
    const [rows, [count]] = await Promise.all([
      db
        .select({
          id: scanFeedback.id,
          createdAt: scanFeedback.createdAt,
          rating: scanFeedback.rating,
          reasonsJson: scanFeedback.reasonsJson,
          note: scanFeedback.note,
          afterRetry: scanFeedback.afterRetry,
          model: scanFeedback.model,
          source: scanFeedback.source,
          photoId: scanFeedback.photoId,
          userId: scanFeedback.userId,
          userName: user.name,
        })
        .from(scanFeedback)
        .leftJoin(user, eq(user.id, scanFeedback.userId))
        .where(negativeRating)
        .orderBy(desc(scanFeedback.createdAt), desc(scanFeedback.id))
        .limit(query.pageSize)
        .offset(offsetOf(query)),
      db
        .select({ total: sql<number>`count(*)`, retryDerived: sql<number>`coalesce(sum(case when ${retryDerived} then 1 else 0 end), 0)` })
        .from(scanFeedback)
        .where(negativeRating),
    ]);

    // One batched session lookup for this page (user + photoId).
    const sessions = new Map<string, ScanSession>();
    if (rows.length > 0) {
      // Each row binds its user id and its photo id: D1 takes 100 values per statement, a page holds up to 100 rows.
      const found = await readChunked(
        rows,
        (slice) =>
          db
            .select({ userId: aiUsage.userId, usageJson: aiUsage.usageJson })
            .from(aiUsage)
            .where(
              and(
                isSessionSql(),
                inArray(aiUsage.userId, [...new Set(slice.map((r) => r.userId))]),
                sql`json_extract(${aiUsage.usageJson}, '$.photoId') in (${sql.join(
                  slice.map((r) => sql`${r.photoId}`),
                  sql`, `,
                )})`,
              ),
            ),
        { perKey: 2 },
      );
      for (const row of found) {
        const session = parseSession(row.usageJson);
        if (session?.photoId && !sessions.has(`${row.userId}/${session.photoId}`)) {
          sessions.set(`${row.userId}/${session.photoId}`, session);
        }
      }
    }

    const negatives = rows.map(({ reasonsJson, ...row }) => {
      const parsed = parseFeedbackReasons(reasonsJson);
      const session = sessions.get(`${row.userId}/${row.photoId}`);
      return {
        ...row,
        reasons: parsed.reasons,
        retryDerived:
          parsed.retryTap ||
          (row.rating === "kurang_akurat" &&
            parsed.reasons.length === 0 &&
            !row.note &&
            row.createdAt.getTime() < RETRY_TAP_CUTOVER_MS),
        keptPhoto: parsed.keepPhoto,
        aiItems: session?.aiItems ?? null,
        retryItems: session?.retryItems ?? null,
        retryLog: session?.retryLog ?? null,
        savedItems: session?.savedItems ?? null,
        diff: session?.diff ?? null,
      };
    });
    return c.json({
      negatives,
      total: count?.total ?? 0,
      retryDerived: count?.retryDerived ?? 0,
      page: query.page,
      pageSize: query.pageSize,
    });
  });

  // Paged corrected sessions (saved with edits or after a typed/spoken fix),
  // newest first: what the AI returned (first pass + every retry) vs what the
  // user saved. Needs no photo, so it stays readable after scan-src expires.
  app.get("/api/admin/feedback/corrected", async (c) => {
    const query = parseQuery(c, pagingSchema);
    const db = deps.getDb();
    const corrected = and(
      isSessionSql(),
      sql`json_extract(${aiUsage.usageJson}, '$.savedLabel') = 'corrected'`,
    );
    const [rows, [count]] = await Promise.all([
      db
        .select({
          id: aiUsage.id,
          createdAt: aiUsage.createdAt,
          model: aiUsage.model,
          userId: aiUsage.userId,
          userName: user.name,
          usageJson: aiUsage.usageJson,
        })
        .from(aiUsage)
        .leftJoin(user, eq(user.id, aiUsage.userId))
        .where(corrected)
        .orderBy(desc(aiUsage.createdAt), desc(aiUsage.id))
        .limit(query.pageSize)
        .offset(offsetOf(query)),
      db.select({ total: sql<number>`count(*)` }).from(aiUsage).where(corrected),
    ]);
    const corrections = rows.map(({ usageJson, ...row }) => {
      const session = parseSession(usageJson);
      return {
        ...row,
        photoId: session?.photoId ?? null,
        retries: session?.retries ?? 0,
        corrections: session?.corrections ?? 0,
        savedAt: session?.savedAt ?? null,
        aiItems: session?.aiItems ?? null,
        retryLog: session?.retryLog ?? null,
        savedItems: session?.savedItems ?? null,
        diff: session?.diff ?? null,
      };
    });
    return c.json({
      corrections,
      total: count?.total ?? 0,
      page: query.page,
      pageSize: query.pageSize,
    });
  });

  // Thumbnail of a rated photo (scan-src/<userId>/<photoId>, ext-less — the
  // mime rides in the object metadata). Objects expire via the bucket
  // lifecycle rule, so older feedback often has no photo left; the console
  // falls back to a placeholder on 404.
  app.get("/api/admin/feedback-photo/:photoId", async (c) => {
    const photoId = c.req.param("photoId");
    if (!SCAN_ID_RE.test(photoId)) {
      return c.json({ error: "ID tidak valid." }, 400);
    }
    const userId = c.req.query("userId");
    if (!userId) {
      return c.json({ error: "User tidak diketahui." }, 400);
    }
    const bucket = deps.getBucket();
    if (!bucket) {
      return c.json({ error: "Foto belum tersedia." }, 404);
    }
    const obj =
      (await bucket.get(scanSrcKey(userId, photoId)).catch(() => null)) ??
      // scan-src expires after ~2 days; consented feedback keeps its own copy.
      (await bucket.get(feedbackPhotoKey(userId, photoId)).catch(() => null));
    if (!obj) {
      return c.json({ error: "Foto tidak ditemukan." }, 404);
    }
    return new Response(obj.body, {
      headers: {
        "Content-Type": obj.httpMetadata?.contentType ?? "image/jpeg",
        "Content-Length": String(obj.size),
        "Cache-Control": "private, no-store",
      },
    });
  });

  // Laporan: the daily accuracy reports (R2 reports/accuracy/<date>.json, built by
  // accuracy-job.ts), newest first. The list carries the headline numbers; the
  // detail is the whole stored report.
  app.get("/api/admin/accuracy", async (c) => {
    const query = parseQuery(c, pagingSchema);
    const bucket = deps.getBucket();
    const dates = bucket ? await listReportDates(bucket) : [];
    const page = dates.slice(offsetOf(query), offsetOf(query) + query.pageSize);
    const reports = bucket
      ? (await Promise.all(page.map((date) => readReport(bucket, date)))).flatMap((report) =>
          report ? [accuracyReportSummary(report)] : [],
        )
      : [];
    return c.json({ reports, total: dates.length, page: query.page, pageSize: query.pageSize });
  });

  app.get("/api/admin/accuracy/:date", async (c) => {
    const date = c.req.param("date");
    const bucket = deps.getBucket();
    const report = bucket && /^\d{4}-\d{2}-\d{2}$/.test(date) ? await readReport(bucket, date) : null;
    return report ? c.json(report) : c.json({ error: "Laporan tidak ditemukan." }, 404);
  });
}
