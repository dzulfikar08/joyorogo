import { join } from "node:path";

import { d1TestDb } from "@joyorogo/db/test-d1";
import { beforeAll, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import type { JoyoAuth } from "@joyorogo/auth";

import { RETRY_TAP_CUTOVER_MS } from "@joyorogo/api/lib/scan-outcome";

import { registerAdminRoutes } from "./admin";

const { client, db } = await d1TestDb();

const ADMIN = "admin@test.id";
let signedInAs: { email: string; emailVerified: boolean } | null = {
  email: ADMIN,
  emailVerified: true,
};

const app = new Hono();
registerAdminRoutes(app, {
  adminEmails: ADMIN,
  getDb: () => db,
  createAuth: async () =>
    ({ api: { getSession: async () => (signedInAs ? { user: signedInAs } : null) } }) as unknown as JoyoAuth,
  getBucket: () => undefined,
  reconcileById: async () => "noop",
  sendTestEmail: async () => "sent",
});

const call = async (path: string) => {
  const res = await app.request(path);
  return { status: res.status, body: (await res.json()) as Record<string, any> };
};
const ids = (rows: { id?: string; orderId?: string }[]) => rows.map((r) => r.id ?? r.orderId);

const T0 = Date.UTC(2026, 0, 1);

beforeAll(async () => {
  const stmts: string[] = [];
  // 60 users; all but the last two share one created_at so only the id tiebreak orders them.
  for (let i = 0; i < 60; i++) {
    const name = i === 5 ? "100% Real_Name" : `User ${i}`;
    const createdAt = i < 58 ? T0 : T0 + (i - 57) * 1000;
    stmts.push(
      `INSERT INTO "user" (id, name, email, created_at) VALUES ('u${String(i).padStart(2, "0")}', '${name}', 'user${i}@test.id', ${createdAt})`,
    );
  }
  // 70 orders on one timestamp for u00; 5 distinct on u01.
  for (let i = 0; i < 70; i++) {
    const status = i % 3 === 0 ? "paid" : i % 3 === 1 ? "pending" : "failed";
    stmts.push(
      `INSERT INTO payment (order_id, user_id, amount_idr, status, created_at) VALUES ('ord-${String(i).padStart(3, "0")}', 'u00', ${i % 2 === 0 ? 0 : 15000}, '${status}', ${T0})`,
    );
  }
  for (let i = 0; i < 5; i++) {
    stmts.push(
      `INSERT INTO payment (order_id, user_id, amount_idr, status, created_at) VALUES ('zz-${i}', 'u01', 15000, 'paid', ${T0 + i * 1000})`,
    );
  }
  // AI calls: 30 for u02 (same ms), plus scan counts to exercise count sorts.
  for (let i = 0; i < 30; i++) {
    stmts.push(
      `INSERT INTO ai_usage (id, user_id, model, scan_type, latency_ms, created_at) VALUES ('ai${String(i).padStart(2, "0")}', 'u02', 'm', 'user', 100, ${Date.now() - 1000})`,
    );
  }
  for (let i = 0; i < 12; i++) {
    stmts.push(
      `INSERT INTO ai_usage (id, user_id, model, scan_type, latency_ms, created_at) VALUES ('ab${i}', 'u03', 'm', 'user', 100, ${Date.now() - 1000})`,
      `INSERT INTO food_log (id, user_id, date, meal, name, kcal, source, created_at) VALUES ('fl${String(i).padStart(2, "0")}', 'u03', '2026-01-01', 'sarapan', 'Nasi', 200, 'manual', ${T0})`,
      `INSERT INTO session (id, token, expires_at, updated_at, created_at, user_id) VALUES ('s${String(i).padStart(2, "0")}', 'tok${i}', ${T0}, ${T0}, ${T0}, 'u03')`,
    );
  }
  // Feedback: 30 negatives on one timestamp, plus accurate/dismissed rows.
  for (let i = 0; i < 30; i++) {
    stmts.push(
      `INSERT INTO scan_feedback (id, user_id, photo_id, rating, source, after_retry, created_at) VALUES ('fb${String(i).padStart(2, "0")}', 'u04', 'p', '${i % 2 ? "salah" : "kurang_akurat"}', 'web', ${i % 5 === 0 ? 1 : 0}, ${T0})`,
    );
  }
  stmts.push(
    `INSERT INTO scan_feedback (id, user_id, photo_id, rating, source, created_at) VALUES ('ok1', 'u04', 'p', 'akurat', 'web', ${T0}), ('skip1', 'u04', 'p', 'dilewati', 'web', ${T0})`,
  );
  // Reports: 30 pending + 3 resolved on one timestamp.
  for (let i = 0; i < 33; i++) {
    stmts.push(
      `INSERT INTO social_report (id, reporter_id, reason, created_at, resolved_at) VALUES ('r${String(i).padStart(2, "0")}', 'u05', 'spam', ${T0}, ${i >= 30 ? T0 : "NULL"})`,
    );
  }
  await client.executeMultiple(stmts.join(";\n"));
});

describe("admin auth", () => {
  test("401 without a session, 403 for a non-admin", async () => {
    signedInAs = null;
    expect((await call("/api/admin/users")).status).toBe(401);
    signedInAs = { email: "someone@test.id", emailVerified: true };
    expect((await call("/api/admin/users")).status).toBe(403);
    signedInAs = { email: ADMIN, emailVerified: true };
    expect((await call("/api/admin/users")).status).toBe(200);
  });
});

describe("paging validation", () => {
  test.each([
    "/api/admin/users?page=0",
    "/api/admin/users?page=abc",
    "/api/admin/users?pageSize=7",
    "/api/admin/users?pageSize=1000",
    "/api/admin/users?sort=bogus",
    "/api/admin/users?plan=gold",
    "/api/admin/orders?status=bogus",
    "/api/admin/reports?status=bogus",
    "/api/admin/feedback/negatives?pageSize=0",
    "/api/admin/users/u03/calls?page=-1",
  ])("%s -> 400", async (path) => {
    const res = await call(path);
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
  });

  test("defaults to page 1 of 25, and a cleared filter counts as absent", async () => {
    const res = await call("/api/admin/users?plan=&idle=&dir=&abuse=&q=");
    expect(res.status).toBe(200);
    expect(res.body.page).toBe(1);
    expect(res.body.pageSize).toBe(25);
    expect(res.body.total).toBe(60);
    expect(res.body.users).toHaveLength(25);
  });
});

describe("users", () => {
  test("pages are stable, disjoint and complete under created_at ties", async () => {
    const seen: string[] = [];
    for (const page of [1, 2, 3]) {
      const res = await call(`/api/admin/users?pageSize=25&page=${page}`);
      seen.push(...ids(res.body.users));
    }
    expect(new Set(seen).size).toBe(60);
    // Newest first; the 58 tied rows fall back to id desc.
    expect(seen.slice(0, 2)).toEqual(["u59", "u58"]);
    expect(seen.slice(2)).toEqual(
      Array.from({ length: 58 }, (_, i) => `u${String(57 - i).padStart(2, "0")}`),
    );
    const again = await call("/api/admin/users?pageSize=25&page=2");
    expect(ids(again.body.users)).toEqual(seen.slice(25, 50));
  });

  test("a page past the end is empty but keeps the total", async () => {
    const res = await call("/api/admin/users?page=99");
    expect(res.status).toBe(200);
    expect(res.body.users).toEqual([]);
    expect(res.body.total).toBe(60);
  });

  test("search treats % and _ literally", async () => {
    const hit = await call("/api/admin/users?q=100%25");
    expect(hit.body.total).toBe(1);
    expect(hit.body.users[0].id).toBe("u05");
    const wildcard = await call("/api/admin/users?q=%25");
    expect(wildcard.body.total).toBe(1);
    const underscore = await call("/api/admin/users?q=real_name");
    expect(underscore.body.total).toBe(1);
    const noUnderscoreMatch = await call("/api/admin/users?q=user_1");
    expect(noUnderscoreMatch.body.total).toBe(0);
  });

  test("metric sorts break ties by created_at desc, id desc", async () => {
    const res = await call("/api/admin/users?sort=scans7d&pageSize=10");
    expect(ids(res.body.users).slice(0, 2)).toEqual(["u02", "u03"]);
    // Everyone else has 0 scans: newest first, then id desc.
    expect(ids(res.body.users).slice(2, 5)).toEqual(["u59", "u58", "u57"]);
  });
});

describe("orders", () => {
  test("paged newest first with order id tiebreak; totals follow the filter", async () => {
    const all = await call("/api/admin/orders?pageSize=100");
    expect(all.body.total).toBe(75);
    expect(ids(all.body.orders).slice(0, 5)).toEqual(["zz-4", "zz-3", "zz-2", "zz-1", "zz-0"]);
    expect(ids(all.body.orders).slice(5, 8)).toEqual(["ord-069", "ord-068", "ord-067"]);

    const seen: string[] = [];
    for (const page of [1, 2, 3]) {
      seen.push(...ids((await call(`/api/admin/orders?pageSize=25&page=${page}`)).body.orders));
    }
    expect(seen).toEqual(ids(all.body.orders));

    const pending = await call("/api/admin/orders?status=pending");
    expect(pending.body.total).toBe(23);
    expect(pending.body.orders.every((o: { status: string }) => o.status === "pending")).toBe(true);
  });

  test("search joins the user; count matches rows", async () => {
    const res = await call("/api/admin/orders?q=user1%40test&pageSize=100");
    expect(res.body.total).toBe(5);
    expect(res.body.orders).toHaveLength(5);
    const byId = await call("/api/admin/orders?q=ORD-00");
    expect(byId.body.total).toBe(10);
  });
});

describe("user detail lists", () => {
  test("detail no longer embeds the long lists", async () => {
    const res = await call("/api/admin/users/u03");
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(["perDay", "user"]);
    expect((await call("/api/admin/users/missing")).status).toBe(404);
  });

  test("calls page with total and stable order", async () => {
    const p1 = await call("/api/admin/users/u02/calls?pageSize=10&page=1");
    const p3 = await call("/api/admin/users/u02/calls?pageSize=10&page=3");
    expect(p1.body.total).toBe(30);
    expect(p1.body.calls).toHaveLength(10);
    expect(p3.body.calls).toHaveLength(10);
    expect(p1.body.calls[0]).toMatchObject({ scanType: "user", kind: "photo" });
  });

  test("foods, orders and sessions page too", async () => {
    const foods = await call("/api/admin/users/u03/foods?pageSize=10&page=2");
    expect(foods.body.total).toBe(12);
    expect(foods.body.foods).toHaveLength(2);
    const orders = await call("/api/admin/users/u00/orders?pageSize=25&page=3");
    expect(orders.body.total).toBe(70);
    expect(ids(orders.body.orders)).toEqual(
      Array.from({ length: 20 }, (_, i) => `ord-${String(19 - i).padStart(3, "0")}`),
    );
    const sessions = await call("/api/admin/users/u03/sessions?pageSize=10");
    expect(sessions.body.total).toBe(12);
    expect(sessions.body.sessions).toHaveLength(10);
  });
});

describe("reports", () => {
  test("status filter, default pending, stable pages", async () => {
    const pending = await call("/api/admin/reports?pageSize=25&page=2");
    expect(pending.body.total).toBe(30);
    expect(ids(pending.body.reports)).toEqual(
      Array.from({ length: 5 }, (_, i) => `r${String(4 - i).padStart(2, "0")}`),
    );
    expect((await call("/api/admin/reports?status=resolved")).body.total).toBe(3);
    expect((await call("/api/admin/reports?status=all")).body.total).toBe(33);
  });

  test("a JoyoFit profile report carries its source and the reported member", async () => {
    await client.execute(
      `INSERT INTO social_report (id, reporter_id, user_id, source, reason, created_at) VALUES ('fit-profile', 'u05', 'u06', 'joyofit', 'kasar', ${T0 + 1})`,
    );
    try {
      const { body } = await call("/api/admin/reports?pageSize=25");
      const first = body.reports[0];
      expect(first).toMatchObject({ id: "fit-profile", source: "joyofit", userId: "u06" });
      expect(first.reportedUserName).toBeTruthy();
      expect(body.reports.find((r: { id: string }) => r.id === "r29")?.source).toBe("joyorogo");
    } finally {
      await client.execute(`DELETE FROM social_report WHERE id = 'fit-profile'`);
    }
  });
});

describe("feedback", () => {
  const now = Date.now();
  const HOUR = 3_600_000;
  const DAY = 24 * HOUR;
  // One second before the production cutover: a legacy retry tap, whatever today's date is.
  const legacyAt = RETRY_TAP_CUTOVER_MS - 1000;
  const legacyInWindow = now - legacyAt <= 90 * DAY;
  const wib = (ms: number) => new Date(ms + 7 * HOUR).toISOString().slice(0, 10);
  const diff = (aiKcal: number, savedKcal: number) => ({
    renamed: [],
    removed: [],
    added: [],
    changed: [{ n: "Nasi", k: [aiKcal, savedKcal] }],
    aiKcal,
    savedKcal,
  });
  const aiItems = [{ n: "Nasi", g: 200, k: 300 }];

  beforeAll(async () => {
    const session = (
      id: string,
      model: string,
      photoId: string,
      ageMs: number,
      usage: Record<string, unknown>,
    ) =>
      client.execute({
        sql: "INSERT INTO ai_usage (id, user_id, model, scan_type, latency_ms, usage_json, created_at) VALUES (?, 'u05', ?, 'user', 100, ?, ?)",
        args: [id, model, JSON.stringify({ photoId, aiItems, ...usage }), now - ageMs],
      });
    await session("fs1", "mA", "photoS1", 2 * HOUR, { savedLabel: "accurate", savedAt: now });
    await session("fs2", "mA", "photoS2", 2 * HOUR, {
      savedLabel: "corrected",
      corrections: 1,
      savedItems: [{ n: "Nasi", g: 150, k: 200 }],
      diff: diff(600, 400),
    });
    await session("fs3", "mB", "photoS3", 2 * HOUR, {
      savedLabel: "corrected",
      diff: diff(300, 400),
    });
    // Retried, then saved: still "retried", and not part of the kcal bias.
    await session("fs4", "mB", "photoS4", 2 * HOUR, {
      retries: 1,
      retryLog: [{ i: 1, at: now, model: "mB", items: [{ n: "Nasi", g: 100, k: 150 }] }],
      retryItems: [{ n: "Nasi", g: 100, k: 150 }],
      savedLabel: "corrected",
      diff: diff(150, 100),
    });
    await session("fs5", "mB", "photoS5", 3 * HOUR, {});
    await session("fs6", "mB", "photoS6", 1000, {});
    await session("fs7", "mA", "photoS7", 5 * DAY, { savedLabel: "accurate" });

    const fb = (
      id: string,
      photoId: string,
      rating: string,
      reasons: string[] | null,
      note: string | null,
      at: number,
    ) =>
      client.execute({
        sql: "INSERT INTO scan_feedback (id, user_id, photo_id, rating, reasons_json, note, source, model, created_at) VALUES (?, 'u05', ?, ?, ?, ?, 'web', 'mA', ?)",
        args: [id, photoId, rating, reasons ? JSON.stringify(reasons) : null, note, at],
      });
    await fb("fx1", "photoX1", "akurat", null, null, now);
    await fb("fx2", "photoX2", "akurat", null, null, now);
    await fb("fx3", "photoS2", "salah", ["porsi", "keep_photo"], "porsinya lebih kecil", now);
    await fb("fx4", "photoS3", "kurang_akurat", ["kcal_rendah"], null, now - 1);
    await fb("fx5", "photoS4", "kurang_akurat", ["retry_tap"], null, now - 2);
    await fb("fx6", "photoX6", "kurang_akurat", null, null, legacyAt);
    await fb("fx7", "photoX7", "dilewati", null, null, now);
  });

  test("summary: implicit outcomes per day and model, bias, explicit without retry taps", async () => {
    const { body } = await call("/api/admin/feedback?days=90");
    expect(body.negatives.afterRetry).toBe(6);

    expect(body.outcomes.total).toEqual({
      accurate: 2,
      corrected: 2,
      retried: 1,
      abandoned: 1,
      pending: 1,
    });
    const model = (name: string) => body.outcomes.byModel.find((m: any) => m.model === name);
    expect(model("mA")).toMatchObject({ accurate: 2, corrected: 1, retried: 0, abandoned: 0 });
    expect(model("mB")).toMatchObject({
      accurate: 0,
      corrected: 1,
      retried: 1,
      abandoned: 1,
      pending: 1,
    });
    const sum = (key: string) =>
      body.outcomes.byDay.reduce((s: number, d: any) => s + d[key], 0);
    expect(sum("accurate")).toBe(2);
    expect(sum("corrected") + sum("retried") + sum("abandoned") + sum("pending")).toBe(5);
    const oldDay = body.outcomes.byDay.find((d: any) => d.day === wib(now - 5 * DAY));
    expect(oldDay).toMatchObject({ accurate: 1, corrected: 0, retried: 0 });

    // fs2: AI 600 vs saved 400 = +50%; fs3: AI 300 vs saved 400 = -25%.
    expect(body.bias.total).toEqual({
      n: 2,
      over: 1,
      under: 1,
      meanPct: 12.5,
      meanOverPct: 50,
      meanUnderPct: -25,
    });
    expect(body.bias.byModel.find((m: any) => m.model === "mB")).toMatchObject({
      n: 1,
      over: 0,
      under: 1,
      meanPct: -25,
    });

    // Explicit: 2 akurat + 1 salah + 1 kurang (kcal_rendah); retry taps and dismissals out.
    expect(body.explicit).toEqual({ total: 4, akurat: 2, kurang: 1, salah: 1 });
    expect(body.retryLegacy).toBe(1 + (legacyInWindow ? 1 : 0));
    const explicitDayTotal = body.byDay.reduce((s: number, d: any) => s + d.total, 0);
    expect(explicitDayTotal).toBe(4);
    expect(body.byModel.reduce((s: number, m: any) => s + m.total, 0)).toBe(4);
  });

  test("negative list pages and joins the scan session", async () => {
    const page4 = await call("/api/admin/feedback/negatives?pageSize=10&page=4");
    expect(page4.body.total).toBe(34);
    expect(ids(page4.body.negatives)).toEqual(
      Array.from({ length: 4 }, (_, i) => `fb${String(3 - i).padStart(2, "0")}`),
    );
    // Legacy rows have no session: nulls, and the T0 seed rows are legacy retry taps.
    expect(page4.body.negatives[1]).toMatchObject({
      retryDerived: true,
      keptPhoto: false,
      reasons: [],
      aiItems: null,
      retryItems: null,
      savedItems: null,
      diff: null,
    });

    const page1 = await call("/api/admin/feedback/negatives?pageSize=10&page=1");
    const byId = (id: string) => page1.body.negatives.find((r: any) => r.id === id);
    expect(byId("fx3")).toMatchObject({
      retryDerived: false,
      keptPhoto: true,
      reasons: ["porsi"],
      note: "porsinya lebih kecil",
      aiItems,
      retryItems: null,
      savedItems: [{ n: "Nasi", g: 150, k: 200 }],
      diff: diff(600, 400),
    });
    expect(byId("fx3").reasonsJson).toBeUndefined();
    expect(byId("fx4")).toMatchObject({ retryDerived: false, reasons: ["kcal_rendah"] });
    expect(byId("fx5")).toMatchObject({
      retryDerived: true,
      reasons: [],
      retryItems: [{ n: "Nasi", g: 100, k: 150 }],
    });
    expect(byId("fx6")).toMatchObject({ retryDerived: true, diff: null });
    expect(byId("fx5").retryLog).toEqual([
      { i: 1, at: now, model: "mB", items: [{ n: "Nasi", g: 100, k: 150 }] },
    ]);
  });

  test("corrected sessions page without photos", async () => {
    const { body } = await call("/api/admin/feedback/corrected?pageSize=10");
    expect(body.total).toBe(3);
    const byPhoto = (id: string) =>
      body.corrections.find((r: { photoId: string }) => r.photoId === id);
    expect(body.corrections.map((r: { photoId: string }) => r.photoId).sort()).toEqual([
      "photoS2",
      "photoS3",
      "photoS4",
    ]);
    expect(byPhoto("photoS2")).toMatchObject({
      model: "mA",
      corrections: 1,
      aiItems,
      savedItems: [{ n: "Nasi", g: 150, k: 200 }],
      diff: diff(600, 400),
    });
    expect(byPhoto("photoS4").retries).toBe(1);
    expect(byPhoto("photoS4").retryLog).toHaveLength(1);
    const page2 = await call("/api/admin/feedback/corrected?pageSize=10&page=2");
    expect(page2.body.corrections).toEqual([]);
  });
});
