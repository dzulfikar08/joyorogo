import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// @libsql/client is a transitive dep of @joyorogo/db; resolved directly because the server doesn't declare it.
import { createClient } from "../../../packages/db/node_modules/@libsql/client";
import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";
import { Hono } from "hono";
import type { JoyoAuth } from "@joyorogo/auth";
import { reportKey } from "@joyorogo/api/lib/accuracy-report";
import type { AccuracyReport } from "@joyorogo/api/lib/accuracy-report";
import { scanDiff } from "@joyorogo/api/lib/scan-outcome";
import type { CompactItem } from "@joyorogo/api/lib/scan-outcome";
import type { StickersBucket } from "@joyorogo/api/lib/sticker";
import type { analyzeFoodPhoto } from "@joyorogo/api/lib/vision";
import type { Database } from "@joyorogo/db";

import { REGRESSION_CAP, dailyAccuracyDue, runDailyAccuracy } from "./accuracy-job";
import { registerAccuracyRoutes } from "./accuracy-routes";
import { registerAdminRoutes } from "./admin";
import type { JobDeps } from "./accuracy-job";
import { accuracyDigestDraft, sendAccuracyDigest } from "./email";

const client = createClient({ url: ":memory:" });
const migrationsDir = join(import.meta.dir, "../../../packages/db/src/migrations");
for (const file of readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort()) {
  await client.executeMultiple(readFileSync(join(migrationsDir, file), "utf8"));
}
const db = drizzle(client) as unknown as Database;

type FakeBucket = {
  bucket: StickersBucket;
  objects: Map<string, { body: string; contentType?: string }>;
  /** Every key asked of `get`, in order. */
  reads: string[];
};

/** The Worker's R2 bucket, in memory; counts reads so the caps can be asserted. */
function fakeBucket(): FakeBucket {
  const objects = new Map<string, { body: string; contentType?: string }>();
  const reads: string[] = [];
  const bucket: StickersBucket = {
    async put(key, value, options) {
      objects.set(key, { body: typeof value === "string" ? value : "<binary>", contentType: options?.httpMetadata?.contentType });
    },
    async get(key) {
      reads.push(key);
      const found = objects.get(key);
      if (!found) return null;
      const bytes = new TextEncoder().encode(found.body);
      return {
        body: new Blob([bytes]).stream(),
        size: bytes.length,
        arrayBuffer: async () => bytes.buffer.slice(0) as ArrayBuffer,
        httpMetadata: { contentType: found.contentType },
      };
    },
    async delete(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) objects.delete(key);
    },
    async list({ prefix, cursor }) {
      const all = [...objects.keys()].filter((key) => key.startsWith(prefix)).sort();
      const start = cursor ? Number(cursor) : 0;
      const page = all.slice(start, start + 1000);
      return {
        objects: page.map((key) => ({ key })),
        truncated: start + 1000 < all.length,
        cursor: String(start + 1000),
      };
    },
  };
  return { bucket, objects, reads };
}

const DATE = "2026-10-16";
const START = Date.parse(`${DATE}T00:00:00+07:00`);
/** 07:30 WIB on the day after the report day. */
const NOW = START + 31.5 * 60 * 60 * 1000;
const ADMIN = "admin@test.id";

const item = (n: string, g: number, k: number): CompactItem => ({ n, g, k });

beforeAll(async () => {
  const stmts: string[] = [
    `INSERT INTO "user" (id, name, email, created_at) VALUES ('admin1', 'Admin', '${ADMIN}', 1), ('u1', 'U One', 'u1@test.id', 1)`,
  ];
  const saved = (ai: CompactItem[], final: CompactItem[]) => {
    const diff = scanDiff(ai, final);
    const edited = diff.renamed.length + diff.removed.length + diff.added.length + diff.changed.length > 0;
    return { savedLabel: edited ? "corrected" : "accurate", savedItems: final, diff };
  };
  const sessions = [
    { ai: [item("Perkedel", 80, 150)], ...saved([item("Perkedel", 80, 150)], [item("Rolade", 82, 160)]) },
    { ai: [item("Perkedel", 80, 150)], ...saved([item("Perkedel", 80, 150)], [item("Rolade", 82, 160)]) },
    { ai: [item("Nasi", 200, 260)], ...saved([item("Nasi", 200, 260)], [item("Nasi", 200, 260)]) },
  ];
  sessions.forEach((s, i) => {
    const usage = {
      photoId: `photo${i}`,
      aiItems: s.ai,
      savedLabel: s.savedLabel,
      savedItems: s.savedItems,
      diff: s.diff,
      serverTiming: { aiMs: 4000 + i * 1000, totalMs: 5000 + i * 1000 },
    };
    stmts.push(
      `INSERT INTO ai_usage (id, user_id, model, scan_type, latency_ms, usage_json, created_at) VALUES ('s${i}', 'u1', 'm', 'user', 100, '${JSON.stringify(usage)}', ${START + (9 + i) * 3_600_000})`,
    );
  });
  stmts.push(
    `INSERT INTO ai_usage (id, user_id, model, scan_type, latency_ms, usage_json, created_at) VALUES ('f1', 'u1', 'm', 'failed', 100, '{"reason":"timeout"}', ${START + 3_600_000})`,
    `INSERT INTO scan_feedback (id, user_id, photo_id, rating, note, source, created_at) VALUES ('fb1', 'u1', 'photo0', 'salah', 'ini rolade', 'web', ${START + 10 * 3_600_000})`,
  );
  await client.executeMultiple(stmts.join(";\n"));
});

type Analyze = typeof analyzeFoodPhoto;
const fakeAnalyze = (calls: { n: number }): Analyze =>
  (async () => {
    calls.n += 1;
    return { items: [{ name: "nasi goreng", grams: 200, kcal: 400 }] };
  }) as unknown as Analyze;

function labelledCases(bucket: FakeBucket, count: number, unlabelledEvery = 0) {
  for (let i = 0; i < count; i++) {
    const key = `dataset/owner/case${i}`;
    const labelled = !(unlabelledEvery && i % unlabelledEvery === 0);
    bucket.objects.set(`${key}/meta.json`, {
      body: JSON.stringify(labelled ? { final: { items: [{ name: "Nasi Goreng", grams: 200, kcal: 500 }] } } : {}),
    });
    bucket.objects.set(`${key}/photo.jpg`, { body: "jpeg", contentType: "image/jpeg" });
  }
}

const baseDeps = (r: FakeBucket, extra: Partial<JobDeps> = {}): JobDeps => ({
  db,
  bucket: r.bucket,
  ai: { run: async () => ({}) },
  email: { ADMIN_EMAILS: ADMIN },
  now: () => NOW,
  sendDigest: async () => ({ status: "sent" }),
  ...extra,
});

describe("dailyAccuracyDue", () => {
  test("starts at 07:00 WIB (00:00 UTC), not before", () => {
    expect(dailyAccuracyDue(Date.parse("2026-10-17T06:55:00+07:00"))).toBe(false);
    expect(dailyAccuracyDue(Date.parse("2026-10-17T07:00:00+07:00"))).toBe(true);
    expect(dailyAccuracyDue(Date.parse("2026-10-17T23:59:00+07:00"))).toBe(true);
  });
});

describe("runDailyAccuracy", () => {
  test("builds yesterday's report from D1 and stores it in R2", async () => {
    const r = fakeBucket();
    const result = await runDailyAccuracy(baseDeps(r));
    expect(result).toMatchObject({ date: DATE, status: "built" });
    const stored = JSON.parse(r.objects.get(reportKey(DATE))!.body) as AccuracyReport;
    expect(stored.scans.total).toBe(3);
    expect(stored.scans.outcomes).toMatchObject({ accurate: 1, corrected: 2 });
    expect(stored.dishes.renames).toEqual([{ from: "perkedel", to: "rolade", n: 2 }]);
    expect(stored.health.failed).toEqual({ total: 1, byReason: { timeout: 1 } });
    expect(stored.ratings).toMatchObject({ total: 1, salah: 1 });
    expect(stored.latency.aiMs.p50).toBe(5000);
    expect(stored.email).toMatchObject({ status: "sent", attempts: 1 });
    expect(JSON.stringify(stored)).not.toMatch(/u1@test|U One|photo0/);
    // The lock is gone.
    expect(r.objects.has(`reports/accuracy/${DATE}.lock`)).toBe(false);
  });

  test("idempotent: a finished day is neither rebuilt, re-run nor re-mailed", async () => {
    const r = fakeBucket();
    labelledCases(r, 10);
    const calls = { n: 0 };
    let sent = 0;
    const deps = baseDeps(r, {
      analyze: fakeAnalyze(calls),
      sendDigest: async () => {
        sent += 1;
        return { status: "sent" };
      },
    });
    expect((await runDailyAccuracy(deps)).status).toBe("built");
    const aiCalls = calls.n;
    const body = r.objects.get(reportKey(DATE))!.body;
    for (let tick = 0; tick < 5; tick++) {
      expect((await runDailyAccuracy(deps)).status).toBe("exists");
    }
    expect(calls.n).toBe(aiCalls);
    expect(sent).toBe(1);
    expect(r.objects.get(reportKey(DATE))!.body).toBe(body);
  });

  test("force rebuilds the day", async () => {
    const r = fakeBucket();
    const deps = baseDeps(r);
    await runDailyAccuracy(deps);
    expect((await runDailyAccuracy(deps, { force: true })).status).toBe("built");
  });

  test("cost cap: never more model calls than the cap, never more than 2x the cap in meta reads", async () => {
    const r = fakeBucket();
    // 300 cases, a third unlabelled: far more than one day may run.
    labelledCases(r, 300, 3);
    const calls = { n: 0 };
    const result = await runDailyAccuracy(baseDeps(r, { analyze: fakeAnalyze(calls), cap: 5 }));
    expect(calls.n).toBe(5);
    expect(result.report!.regression).toMatchObject({ cap: 5, candidates: 300 });
    expect(result.report!.regression!.summary.cases).toBe(5);
    const metaReads = r.reads.filter((key) => key.endsWith("/meta.json")).length;
    expect(metaReads).toBeLessThanOrEqual(10);
  });

  test("the default cap is 40", async () => {
    expect(REGRESSION_CAP).toBe(40);
    const r = fakeBucket();
    labelledCases(r, 200);
    const calls = { n: 0 };
    await runDailyAccuracy(baseDeps(r, { analyze: fakeAnalyze(calls) }));
    expect(calls.n).toBe(40);
  });

  test("a model failure on one photo is a failed case, not a failed report", async () => {
    const r = fakeBucket();
    labelledCases(r, 4);
    let n = 0;
    const analyze = (async () => {
      if (++n === 2) throw new Error("boom");
      return { items: [{ name: "nasi goreng", grams: 200, kcal: 500 }] };
    }) as unknown as Analyze;
    const result = await runDailyAccuracy(baseDeps(r, { analyze, cap: 4 }));
    expect(result.report!.regression!.summary).toMatchObject({ cases: 3, failed: 1 });
    expect(result.report!.regression!.error).toBeUndefined();
  });

  test("flags a regression against the previous day's run", async () => {
    const r = fakeBucket();
    labelledCases(r, 12);
    const good = (async () => ({ items: [{ name: "nasi goreng", grams: 200, kcal: 500 }] })) as unknown as Analyze;
    const bad = (async () => ({ items: [{ name: "mie ayam", grams: 200, kcal: 300 }] })) as unknown as Analyze;
    // Previous day.
    await runDailyAccuracy(baseDeps(r, { analyze: good, cap: 12, now: () => NOW - 24 * 3_600_000 }), { date: "2026-10-15" });
    const today = await runDailyAccuracy(baseDeps(r, { analyze: bad, cap: 12 }));
    const regression = today.report!.regression!;
    expect(regression.comparison).toMatchObject({ prevDate: "2026-10-15", common: 12 });
    expect(regression.flags.length).toBe(2);
    expect(regression.flags[0]).toContain("Akurasi nama turun");
    expect(regression.flags[1]).toContain("Kalori terlalu rendah naik");
  });

  test("no AI binding: the report still lands, with the reason", async () => {
    const r = fakeBucket();
    const result = await runDailyAccuracy(baseDeps(r, { ai: undefined }));
    expect(result.report!.regression!.error).toBe("binding AI tidak tersedia");
    expect(result.report!.scans.total).toBe(3);
  });

  test("a failed email is retried on later ticks, at most 3 times in all", async () => {
    const r = fakeBucket();
    let attempts = 0;
    const deps = baseDeps(r, {
      sendDigest: async () => {
        attempts += 1;
        return attempts < 3 ? { status: "failed", detail: "smtp down" } : { status: "sent" };
      },
    });
    expect((await runDailyAccuracy(deps)).report!.email).toMatchObject({ status: "failed", attempts: 1 });
    expect((await runDailyAccuracy(deps)).status).toBe("email_retried");
    const third = await runDailyAccuracy(deps);
    expect(third.report!.email).toMatchObject({ status: "sent", attempts: 3 });
    expect((await runDailyAccuracy(deps)).status).toBe("exists");
    expect(attempts).toBe(3);

    const stuck = fakeBucket();
    let tries = 0;
    const never = baseDeps(stuck, {
      sendDigest: async () => {
        tries += 1;
        return { status: "failed" };
      },
    });
    for (let tick = 0; tick < 6; tick++) await runDailyAccuracy(never);
    expect(tries).toBe(3);
  });

  test("a run in progress blocks another; a stale lock does not", async () => {
    const r = fakeBucket();
    r.objects.set(`reports/accuracy/${DATE}.lock`, { body: JSON.stringify({ at: NOW - 60_000, attempts: 1 }) });
    expect((await runDailyAccuracy(baseDeps(r))).status).toBe("busy");
    r.objects.set(`reports/accuracy/${DATE}.lock`, { body: JSON.stringify({ at: NOW - 3_600_000, attempts: 1 }) });
    expect((await runDailyAccuracy(baseDeps(r))).status).toBe("built");
  });

  test("gives up after three crashed attempts", async () => {
    const r = fakeBucket();
    r.objects.set(`reports/accuracy/${DATE}.lock`, { body: JSON.stringify({ at: NOW - 3_600_000, attempts: 3 }) });
    expect((await runDailyAccuracy(baseDeps(r))).status).toBe("gave_up");
  });
});

describe("sendAccuracyDigest", () => {
  const sentMail: Array<{ to: unknown; subject: string; text: string }> = [];
  const env = {
    ADMIN_EMAILS: ADMIN,
    EMAIL_FROM: "halo@mail.joyorogo.com",
    EMAIL: {
      send: async (message: { to: unknown; subject: string; text: string }) => {
        sentMail.push(message);
      },
    },
  } as unknown as Parameters<typeof sendAccuracyDigest>[0];

  let report: AccuracyReport;
  beforeEach(async () => {
    sentMail.length = 0;
    await client.execute(`DELETE FROM email_log`);
    const r = fakeBucket();
    report = (await runDailyAccuracy(baseDeps(r))).report!;
  });

  test("mails the admins once per day and logs it in email_log", async () => {
    expect(await sendAccuracyDigest(env, db, report)).toEqual({ status: "sent" });
    expect(sentMail).toHaveLength(1);
    expect(sentMail[0]!.to).toEqual([ADMIN]);
    const rows = await client.execute(`SELECT kind, ref, user_id FROM email_log`);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({ kind: "accuracy_digest", ref: DATE, user_id: "admin1" });
    expect(await sendAccuracyDigest(env, db, report)).toEqual({ status: "sent", detail: "already in email_log" });
    expect(sentMail).toHaveLength(1);
  });

  test("a day with no scans sends nothing and logs nothing", async () => {
    const quiet = { ...report, scans: { ...report.scans, total: 0 } };
    expect(await sendAccuracyDigest(env, db, quiet)).toEqual({ status: "skipped_no_scans" });
    expect(sentMail).toHaveLength(0);
    expect((await client.execute(`SELECT 1 FROM email_log`)).rows).toHaveLength(0);
  });

  test("a failed send frees the claim so a retry can send", async () => {
    const broken = {
      ...env,
      EMAIL: {
        send: async () => {
          throw new Error("nope");
        },
      },
    } as unknown as Parameters<typeof sendAccuracyDigest>[0];
    expect((await sendAccuracyDigest(broken, db, report)).status).toBe("failed");
    expect((await client.execute(`SELECT 1 FROM email_log`)).rows).toHaveLength(0);
    expect((await sendAccuracyDigest(env, db, report)).status).toBe("sent");
  });

  test("email off without an EMAIL binding", async () => {
    const off = { ADMIN_EMAILS: ADMIN } as Parameters<typeof sendAccuracyDigest>[0];
    expect((await sendAccuracyDigest(off, db, report)).status).toBe("off");
  });

  test("the digest is short Indonesian text with the top problems, regressions and a link, and no user data", () => {
    const draft = accuracyDigestDraft({
      ...report,
      regression: { ...report.regression!, flags: ["Akurasi nama turun: 80% → 70% (12 foto sama dengan 2026-10-15)"] },
    });
    expect(draft.subject).toBe("[Regresi] Akurasi scan 16 Oktober 2026: 33% tanpa koreksi, 3 scan");
    expect(draft.text).toContain("3 scan (3 berlabel). 1 tanpa koreksi (33%), 2 dikoreksi, 0 hitung ulang.");
    expect(draft.text).toContain("1. perkedel → rolade ×2");
    expect(draft.text).toContain("Akurasi nama turun: 80% → 70%");
    expect(draft.text).toContain("https://admin.joyorogo.com/#laporan?date=2026-10-16");
    expect(draft.text).not.toMatch(/u1@test|U One|photo0/);
    expect(draft.html).toContain("Buka laporan");
  });

  test("dish names are HTML-escaped in the mail", () => {
    const draft = accuracyDigestDraft({
      ...report,
      problems: [{ kind: "rename", n: 1, text: "<b>x</b> → y ×1" }],
    });
    expect(draft.html).toContain("&lt;b&gt;x&lt;/b&gt; → y ×1");
    expect(draft.html).not.toContain("<b>x</b>");
  });
});

describe("admin Laporan routes and the manual run route", () => {
  const stored = fakeBucket();
  const app = new Hono();
  registerAdminRoutes(app, {
    adminEmails: ADMIN,
    getDb: () => db,
    createAuth: async () =>
      ({ api: { getSession: async () => ({ user: { email: ADMIN, emailVerified: true } }) } }) as unknown as JoyoAuth,
    getBucket: () => stored.bucket,
    reconcileById: async () => "noop",
    sendTestEmail: async () => "sent",
  });
  registerAccuracyRoutes(app, {
    key: "secret",
    run: (opts) => runDailyAccuracy(baseDeps(stored), opts),
  });

  beforeAll(async () => {
    for (const date of ["2026-10-14", "2026-10-15", "2026-10-16"]) {
      await runDailyAccuracy(baseDeps(stored), { date });
    }
  });

  test("lists reports newest first, paged, with headline numbers", async () => {
    const res = await app.request("/api/admin/accuracy?page=2&pageSize=10");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ reports: [], total: 3, page: 2, pageSize: 10 });
    const first = (await (await app.request("/api/admin/accuracy")).json()) as {
      reports: Array<{ date: string; total: number; email: string }>;
    };
    expect(first.reports.map((r) => r.date)).toEqual(["2026-10-16", "2026-10-15", "2026-10-14"]);
    expect(first.reports[0]).toMatchObject({ total: 3, email: "sent" });
  });

  test("detail returns the stored report; bad or missing dates are 404", async () => {
    const res = await app.request("/api/admin/accuracy/2026-10-16");
    expect(((await res.json()) as AccuracyReport).dishes.renames[0]).toMatchObject({ from: "perkedel", to: "rolade" });
    expect((await app.request("/api/admin/accuracy/2020-01-01")).status).toBe(404);
    expect((await app.request("/api/admin/accuracy/..%2Fx")).status).toBe(404);
  });

  test("the manual run needs the key and a valid date", async () => {
    expect((await app.request("/ai/accuracy/run", { method: "POST" })).status).toBe(404);
    const wrong = await app.request("/ai/accuracy/run", { method: "POST", headers: { "X-Bench-Key": "nope" } });
    expect(wrong.status).toBe(404);
    const bad = await app.request("/ai/accuracy/run?date=tomorrow", { method: "POST", headers: { "X-Bench-Key": "secret" } });
    expect(bad.status).toBe(400);
  });
});

describe("a day of scans without session labels", () => {
  test("still gets a report and a mail, with the scan count but no accuracy rate", async () => {
    const r = fakeBucket();
    await client.execute(
      `INSERT INTO ai_usage (id, user_id, model, scan_type, latency_ms, usage_json, created_at) VALUES ('old1', 'u1', 'm', 'user', 100, '{"serverTiming":{"aiMs":7000,"totalMs":8000}}', ${Date.parse("2026-10-12T10:00:00+07:00")}), ('old2', 'u1', 'm', 'user', 100, '{"serverTiming":{"aiMs":9000,"totalMs":9500}}', ${Date.parse("2026-10-12T11:00:00+07:00")})`,
    );
    const result = await runDailyAccuracy(baseDeps(r), { date: "2026-10-12" });
    const report = result.report!;
    expect(report.scans).toMatchObject({ total: 2, labelled: 0, accurateRate: null });
    expect(report.latency.aiMs).toMatchObject({ n: 2, p50: 7000, p95: 9000 });
    expect(report.email?.status).toBe("sent");
    const draft = accuracyDigestDraft(report);
    expect(draft.subject).toBe("Laporan scan 12 Oktober 2026: 2 scan, belum berlabel");
    expect(draft.text).toContain("2 scan, tapi belum ada yang berlabel");
  });
});
