import { and, desc, eq, sql } from "drizzle-orm";
import type { JoyoAuth } from "@joyorogo/auth";
import type { Hono } from "hono";
import { z } from "zod";

import { jakartaToday } from "@joyorogo/api/lib/engine";
import { wibDayBounds } from "@joyorogo/api/lib/tiers";
import { session, user } from "@joyorogo/db/schema/auth";
import { payment } from "@joyorogo/db/schema/billing";
import { aiUsage, foodLog } from "@joyorogo/db/schema/fitness";
import type { Database } from "@joyorogo/db";

const DAY_MS = 24 * 60 * 60 * 1000;
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
  reconcileById: (orderId: string) => Promise<string>;
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

  app.get("/api/admin/users", async (c) => {
    const { startMs, endMs } = wibDayBounds(jakartaToday());
    const rows = await deps
      .getDb()
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        tier: user.tier,
        founderUntil: user.founderUntil,
        aiUnlimited: user.aiUnlimited,
        createdAt: user.createdAt,
        lastSeen: sql<number | null>`(select max(updated_at) from session where session.user_id = ${user.id})`,
        scansToday: sql<number>`(select count(*) from ai_usage where ai_usage.user_id = ${user.id} and ai_usage.scan_type = 'user' and ai_usage.created_at between ${startMs} and ${endMs})`,
        scans7d: sql<number>`(select count(*) from ai_usage where ai_usage.user_id = ${user.id} and ai_usage.scan_type = 'user' and ai_usage.created_at >= ${Date.now() - 7 * DAY_MS})`,
        scansTotal: sql<number>`(select count(*) from ai_usage where ai_usage.user_id = ${user.id} and ai_usage.scan_type = 'user')`,
        foodLogs: sql<number>`(select count(*) from food_log where food_log.user_id = ${user.id})`,
        onboarded: sql<number>`(select count(*) from profile where profile.user_id = ${user.id})`,
        pendingOrders: sql<number>`(select count(*) from payment where payment.user_id = ${user.id} and payment.status = 'pending')`,
        paidOrders: sql<number>`(select count(*) from payment where payment.user_id = ${user.id} and payment.status = 'paid')`,
      })
      .from(user)
      .orderBy(desc(user.createdAt));
    return c.json({ users: rows });
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
        .where(and(eq(aiUsage.userId, id), sql`${aiUsage.createdAt} >= ${Date.now() - 30 * DAY_MS}`))
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
    return c.json({ user: profile, calls, perDay, foods, orders, sessions });
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

  app.get("/api/admin/orders", async (c) => {
    const rows = await deps
      .getDb()
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
      .innerJoin(user, sql`${user.id} = ${payment.userId}`)
      .orderBy(desc(payment.createdAt))
      .limit(200);
    return c.json({ orders: rows });
  });

  app.post("/api/admin/orders/:orderId/check", async (c) =>
    c.json({ outcome: await deps.reconcileById(c.req.param("orderId")) }),
  );
}
