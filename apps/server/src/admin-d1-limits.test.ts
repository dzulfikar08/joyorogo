import { d1TestDb } from "@joyorogo/db/test-d1";
import { beforeAll, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import type { JoyoAuth } from "@joyorogo/auth";

import { registerAdminRoutes } from "./admin";

// D1 binds at most 100 values per statement; the test client throws like D1 does.
const { client, db } = await d1TestDb();

const ADMIN = "admin@test.id";
const app = new Hono();
registerAdminRoutes(app, {
  adminEmails: ADMIN,
  getDb: () => db,
  createAuth: async () =>
    ({ api: { getSession: async () => ({ user: { email: ADMIN, emailVerified: true } }) } }) as unknown as JoyoAuth,
  getBucket: () => undefined,
  reconcileById: async () => "noop",
  revklikBackfill: async () => ({}),
  sendTestEmail: async () => "sent",
});
const call = async (path: string) => {
  const res = await app.request(path);
  return { status: res.status, body: (await res.json()) as Record<string, any> };
};

const T0 = Date.UTC(2026, 0, 1);

beforeAll(async () => {
  const stmts: string[] = [];
  // 100 negatives, each from its own user with its own photo: a pageSize=100 page binds 100 user ids + 100 photo ids.
  for (let i = 0; i < 100; i++) {
    const n = String(i).padStart(3, "0");
    stmts.push(
      `INSERT INTO "user" (id, name, email, created_at) VALUES ('nu${n}', 'Neg ${n}', 'neg${n}@test.id', ${T0})`,
      `INSERT INTO scan_feedback (id, user_id, photo_id, rating, source, created_at) VALUES ('nf${n}', 'nu${n}', 'ph${n}', 'salah', 'web', ${T0 + i})`,
      `INSERT INTO ai_usage (id, user_id, model, scan_type, latency_ms, usage_json, created_at) VALUES ('na${n}', 'nu${n}', 'm', 'user', 100, '{"photoId":"ph${n}","aiItems":[{"n":"Nasi","g":${100 + i},"k":200}]}', ${T0})`,
    );
  }
  await client.executeMultiple(stmts.join(";\n"));
});

describe("admin negatives page of 100", () => {
  test("every row of a full page finds its session", async () => {
    const res = await call("/api/admin/feedback/negatives?pageSize=100");
    expect(res.status).toBe(200);
    expect(res.body.negatives).toHaveLength(100);
    for (const row of res.body.negatives) {
      const i = Number(row.id.slice(2));
      expect(row.aiItems).toEqual([{ n: "Nasi", g: 100 + i, k: 200 }]);
    }
  });
});

describe("admin search term", () => {
  test("a 100-character term (a LIKE pattern over D1's 50 bytes) still matches substrings, case-insensitively", async () => {
    const long = "x".repeat(60);
    await client.execute(`INSERT INTO "user" (id, name, email, created_at) VALUES ('longname', 'Pre ${long.toUpperCase()}${"y".repeat(40)} Post', 'long@test.id', ${T0})`);
    const hit = await call(`/api/admin/users?q=${long}${"y".repeat(40)}`);
    expect(hit.status).toBe(200);
    expect(hit.body.users.map((u: any) => u.id)).toEqual(["longname"]);
    const miss = await call(`/api/admin/users?q=${long}z${"y".repeat(39)}`);
    expect(miss.body.total).toBe(0);
  });
});
