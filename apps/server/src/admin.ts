import { and, desc, eq, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import type { JoyoAuth } from "@joyorogo/auth";
import type { Hono } from "hono";
import { z } from "zod";

import { jakartaToday } from "@joyorogo/api/lib/engine";
import { effectiveTier, wibDayBounds } from "@joyorogo/api/lib/tiers";
import { SCAN_ID_RE, scanSrcKey } from "@joyorogo/api/lib/sticker";
import type { StickersBucket } from "@joyorogo/api/lib/sticker";
import { session, user } from "@joyorogo/db/schema/auth";
import { payment } from "@joyorogo/db/schema/billing";
import { aiUsage, foodLog, profile, scanFeedback } from "@joyorogo/db/schema/fitness";
import { post as postTable, postComment, socialReport } from "@joyorogo/db/schema/social";
import type { Database } from "@joyorogo/db";

const DAY_MS = 24 * 60 * 60 * 1000;
// Abuse heuristics shared by the users filter and the console badges.
const ABUSE_TODAY = 50;
const ABUSE_7D = 300;

function paging(rawPage: string | undefined, rawSize: string | undefined) {
  const page = Math.max(1, Math.floor(Number(rawPage)) || 1);
  const pageSize = Math.min(200, Math.max(1, Math.floor(Number(rawSize)) || 50));
  return { page, pageSize, offset: (page - 1) * pageSize };
}
// Calendar day in WIB (UTC+7) for a ms timestamp column.
const wibDay = (column: unknown) => sql<string>`date((${column} / 1000) + 25200, 'unixepoch')`;

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
};

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

  // Paged, filtered user list. Query: q (name/email), tier=free|founder,
  // abuse=1, sort=newest|lastSeen|scansToday|scans7d|scansTotal, page, pageSize.
  app.get("/api/admin/users", async (c) => {
    const { startMs, endMs } = wibDayBounds(jakartaToday());
    const now = Date.now();
    const { page, pageSize, offset } = paging(c.req.query("page"), c.req.query("pageSize"));
    // Correlated subqueries must name the outer table: drizzle renders a bare
    // column ref as "id", which the inner FROM would resolve to its own id.
    const uid = sql.raw(`"user"."id"`);
    const scans7dExpr = sql<number>`(select count(*) from ai_usage where ai_usage.user_id = ${uid} and ai_usage.scan_type = 'user' and ai_usage.created_at >= ${now - 7 * DAY_MS})`;
    const scansTodayExpr = sql<number>`(select count(*) from ai_usage where ai_usage.user_id = ${uid} and ai_usage.scan_type = 'user' and ai_usage.created_at between ${startMs} and ${endMs})`;
    const scansTotalExpr = sql<number>`(select count(*) from ai_usage where ai_usage.user_id = ${uid} and ai_usage.scan_type = 'user')`;
    const lastSeenExpr = sql<number | null>`(select max(updated_at) from session where session.user_id = ${uid})`;
    const founderExpr = sql`(${user.tier} = 'founder' or ${user.founderUntil} > ${now})`;

    const q = c.req.query("q")?.trim().toLowerCase();
    const tier = c.req.query("tier");
    const filters = and(
      q ? sql`(lower(${user.name}) like ${`%${q}%`} or lower(${user.email}) like ${`%${q}%`})` : undefined,
      tier === "founder" ? founderExpr : tier === "free" ? sql`not ${founderExpr}` : undefined,
      c.req.query("abuse") === "1"
        ? sql`(${scansTodayExpr} >= ${ABUSE_TODAY} or ${scans7dExpr} >= ${ABUSE_7D})`
        : undefined,
    );
    const order = {
      lastSeen: sql`${lastSeenExpr} desc nulls last`,
      scansToday: sql`${scansTodayExpr} desc`,
      scans7d: sql`${scans7dExpr} desc`,
      scansTotal: sql`${scansTotalExpr} desc`,
    }[c.req.query("sort") ?? ""] ?? desc(user.createdAt);

    const db = deps.getDb();
    const [rows, [count]] = await Promise.all([
      db
        .select({
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.image,
          // Effective tier (paid period counts); manualTier is the raw comp column.
          tier: sql<"free" | "founder">`case when ${founderExpr} then 'founder' else 'free' end`,
          manualTier: user.tier,
          founderUntil: user.founderUntil,
          aiUnlimited: user.aiUnlimited,
          createdAt: user.createdAt,
          lastSeen: lastSeenExpr,
          scansToday: scansTodayExpr,
          scans7d: scans7dExpr,
          scansTotal: scansTotalExpr,
          foodLogs: sql<number>`(select count(*) from food_log where food_log.user_id = ${uid})`,
          onboarded: sql<number>`(select count(*) from profile where profile.user_id = ${uid})`,
          pendingOrders: sql<number>`(select count(*) from payment where payment.user_id = ${uid} and payment.status = 'pending')`,
          paidOrders: sql<number>`(select count(*) from payment where payment.user_id = ${uid} and payment.status = 'paid')`,
        })
        .from(user)
        .where(filters)
        .orderBy(order)
        .limit(pageSize)
        .offset(offset),
      db.select({ total: sql<number>`count(*)` }).from(user).where(filters),
    ]);
    return c.json({ users: rows, total: count?.total ?? 0, page, pageSize });
  });

  // Headline numbers for the dashboard cards.
  app.get("/api/admin/overview", async (c) => {
    const { startMs, endMs } = wibDayBounds(jakartaToday());
    const now = Date.now();
    const [row] = await deps
      .getDb()
      .select({
        users: sql<number>`(select count(*) from user)`,
        signupsToday: sql<number>`(select count(*) from user where created_at between ${startMs} and ${endMs})`,
        signups7d: sql<number>`(select count(*) from user where created_at >= ${now - 7 * DAY_MS})`,
        onboarded: sql<number>`(select count(*) from profile)`,
        activeToday: sql<number>`(select count(distinct user_id) from session where updated_at between ${startMs} and ${endMs})`,
        founders: sql<number>`(select count(*) from user where tier = 'founder' or founder_until > ${now})`,
        scansToday: sql<number>`(select count(*) from ai_usage where scan_type = 'user' and created_at between ${startMs} and ${endMs})`,
        scans7d: sql<number>`(select count(*) from ai_usage where scan_type = 'user' and created_at >= ${now - 7 * DAY_MS})`,
        anonScansToday: sql<number>`(select count(*) from ai_usage where scan_type != 'user' and created_at between ${startMs} and ${endMs})`,
        pendingOrders: sql<number>`(select count(*) from payment where status = 'pending')`,
        paidOrders: sql<number>`(select count(*) from payment where status = 'paid')`,
        revenueIdr: sql<number>`(select coalesce(sum(amount_idr), 0) from payment where status = 'paid')`,
      })
      // Every column is a scalar subquery; any one-row source works.
      .from(user)
      .limit(1);
    return c.json(row);
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
        .where(sql`${user.createdAt} >= ${since}`)
        .groupBy(wibDay(user.createdAt)),
      db
        .select({
          day: wibDay(payment.paidAt),
          paid: sql<number>`count(*)`,
          revenueIdr: sql<number>`sum(${payment.amountIdr})`,
        })
        .from(payment)
        .where(and(eq(payment.status, "paid"), sql`${payment.paidAt} >= ${since}`))
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

  // One user: recent AI calls (abuse check), food logs, orders, sessions.
  app.get("/api/admin/users/:id", async (c) => {
    const id = c.req.param("id");
    const db = deps.getDb();
    const [[profile], calls, perDay, foods, orders, sessions] = await Promise.all([
      db.select().from(user).where(eq(user.id, id)).limit(1),
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
        .orderBy(desc(aiUsage.createdAt))
        .limit(100),
      db
        .select({ day: wibDay(aiUsage.createdAt), scans: sql<number>`count(*)` })
        .from(aiUsage)
        .where(
          and(
            eq(aiUsage.userId, id),
            ne(aiUsage.scanType, "failed"),
            sql`${aiUsage.createdAt} >= ${Date.now() - 30 * DAY_MS}`,
          ),
        )
        .groupBy(wibDay(aiUsage.createdAt))
        .orderBy(wibDay(aiUsage.createdAt)),
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
        .orderBy(desc(foodLog.createdAt))
        .limit(50),
      db.select().from(payment).where(eq(payment.userId, id)).orderBy(desc(payment.createdAt)),
      db
        .select({
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
          userAgent: session.userAgent,
          ipAddress: session.ipAddress,
        })
        .from(session)
        .where(eq(session.userId, id))
        .orderBy(desc(session.updatedAt))
        .limit(20),
    ]);
    if (!profile) return c.json({ error: "user not found" }, 404);
    return c.json({
      user: { ...profile, effectiveTier: effectiveTier(profile) },
      calls,
      perDay,
      foods,
      orders,
      sessions,
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

  // Paged orders. Query: status=pending|paid|failed, q (name/email/order id), page, pageSize.
  app.get("/api/admin/orders", async (c) => {
    const { page, pageSize, offset } = paging(c.req.query("page"), c.req.query("pageSize"));
    const q = c.req.query("q")?.trim().toLowerCase();
    const status = c.req.query("status");
    const filters = and(
      status === "pending" || status === "paid" || status === "failed"
        ? eq(payment.status, status)
        : undefined,
      q
        ? sql`(lower(${user.name}) like ${`%${q}%`} or lower(${user.email}) like ${`%${q}%`} or lower(${payment.orderId}) like ${`%${q}%`})`
        : undefined,
    );
    const db = deps.getDb();
    const [rows, [count]] = await Promise.all([
      db
        .select({
          orderId: payment.orderId,
          userId: payment.userId,
          name: user.name,
          email: user.email,
          amountIdr: payment.amountIdr,
          status: payment.status,
          paymentUrl: payment.paymentUrl,
          createdAt: payment.createdAt,
          paidAt: payment.paidAt,
          founderUntil: payment.founderUntil,
        })
        .from(payment)
        .innerJoin(user, eq(user.id, payment.userId))
        .where(filters)
        .orderBy(desc(payment.createdAt))
        .limit(pageSize)
        .offset(offset),
      db
        .select({ total: sql<number>`count(*)` })
        .from(payment)
        .innerJoin(user, eq(user.id, payment.userId))
        .where(filters),
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
    const { page, pageSize, offset } = paging(c.req.query("page"), c.req.query("pageSize"));
    const status = c.req.query("status") ?? "pending";
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
        .orderBy(desc(socialReport.createdAt))
        .limit(pageSize)
        .offset(offset),
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
    await deps.getDb().delete(postTable).where(eq(postTable.id, c.req.param("id")));
    return c.json({ ok: true });
  });

  app.delete("/api/admin/comments/:id", async (c) => {
    await deps.getDb().delete(postComment).where(eq(postComment.id, c.req.param("id")));
    return c.json({ ok: true });
  });

  // Feedback scan ("Hasilnya akurat?"): accuracy per WIB day and per model,
  // plus the recent negative results. Dismissals (`dilewati`) are excluded
  // from every metric.
  app.get("/api/admin/feedback", async (c) => {
    const days = Math.min(90, Math.max(1, Number(c.req.query("days")) || 30));
    const since = Date.now() - days * DAY_MS;
    const db = deps.getDb();
    const rated = and(
      ne(scanFeedback.rating, "dilewati"),
      sql`${scanFeedback.createdAt} >= ${since}`,
    );
    const accuracy = {
      total: sql<number>`count(*)`,
      akurat: sql<number>`sum(case when ${scanFeedback.rating} = 'akurat' then 1 else 0 end)`,
      kurang: sql<number>`sum(case when ${scanFeedback.rating} = 'kurang_akurat' then 1 else 0 end)`,
      salah: sql<number>`sum(case when ${scanFeedback.rating} = 'salah' then 1 else 0 end)`,
    };
    const [byDay, byModel, recent] = await Promise.all([
      db
        .select({ day: wibDay(scanFeedback.createdAt), ...accuracy })
        .from(scanFeedback)
        .where(rated)
        .groupBy(wibDay(scanFeedback.createdAt)),
      db
        .select({ model: scanFeedback.model, ...accuracy })
        .from(scanFeedback)
        .where(rated)
        .groupBy(scanFeedback.model),
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
        .where(and(ne(scanFeedback.rating, "akurat"), ne(scanFeedback.rating, "dilewati")))
        .orderBy(desc(scanFeedback.createdAt))
        .limit(50),
    ]);
    return c.json({ byDay, byModel, recent });
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
    const obj = await bucket.get(scanSrcKey(userId, photoId)).catch(() => null);
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
}
