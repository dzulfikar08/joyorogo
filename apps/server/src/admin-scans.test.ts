import { join } from "node:path";

import { d1TestDb } from "@joyorogo/db/test-d1";
import { beforeAll, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import type { JoyoAuth } from "@joyorogo/auth";

import { registerAdminRoutes } from "./admin";

const { client, db } = await d1TestDb();

const ADMIN = "admin@test.id";
const DAY = 24 * 60 * 60 * 1000;
// Jakarta (UTC+7) day starts: today is 2026-03-10.
const TODAY = Date.parse("2026-03-10T00:00:00+07:00");
let now = Date.parse("2026-03-10T10:00:00+07:00");

const app = new Hono();
registerAdminRoutes(app, {
  adminEmails: ADMIN,
  getDb: () => db,
  createAuth: async () =>
    ({
      api: { getSession: async () => ({ user: { email: ADMIN, emailVerified: true } }) },
    }) as unknown as JoyoAuth,
  getBucket: () => undefined,
  reconcileById: async () => "noop",
  revklikBackfill: async () => ({}),
  sendTestEmail: async () => "sent",
  now: () => now,
});

const call = async (path: string) => {
  const res = await app.request(path);
  return { status: res.status, body: (await res.json()) as Record<string, any> };
};
const byId = (users: { id: string }[]) => Object.fromEntries(users.map((u) => [u.id, u]));
const ids = (users: { id: string }[]) => users.map((u) => u.id);

let seq = 0;
const scan = (userId: string, at: number, type = "user") =>
  `INSERT INTO ai_usage (id, user_id, model, scan_type, latency_ms, created_at) VALUES ('s${seq++}', '${userId}', 'm', '${type}', 1, ${at})`;
/** One scan at noon of the Jakarta day `daysAgo` days before today. */
const scanOn = (userId: string, daysAgo: number) => scan(userId, TODAY - daysAgo * DAY + 12 * 3_600_000);

beforeAll(async () => {
  const stmts: string[] = [];
  const addUser = (id: string, extra: Record<string, string | number> = {}) => {
    const columns = { id: `'${id}'`, name: `'${id}'`, email: `'${id}@test.id'`, created_at: TODAY - 90 * DAY, ...extra };
    stmts.push(
      `INSERT INTO "user" (${Object.keys(columns).join(", ")}) VALUES (${Object.values(columns).join(", ")})`,
    );
  };

  // a: today + yesterday + 2 days ago, each on the very edge of its Jakarta day.
  addUser("a");
  stmts.push(
    scan("a", TODAY), // 00:00:00.000 WIB = 17:00:00Z the evening before: still today
    scan("a", TODAY - 1), // 23:59:59.999 WIB yesterday
    scan("a", TODAY - DAY), // 00:00:00.000 WIB yesterday
    scan("a", TODAY - 2 * DAY + 1),
  );
  // b: yesterday and the day before, nothing today yet: the streak still counts.
  addUser("b");
  stmts.push(scanOn("b", 1), scanOn("b", 2), scanOn("b", 4));
  // c: last scan two days ago.
  addUser("c");
  stmts.push(scanOn("c", 2));
  // d: never scanned.
  addUser("d");
  // e: today only.
  addUser("e");
  stmts.push(scanOn("e", 0), scanOn("e", 0), scanOn("e", 0));
  // f: a scan every day for 65 days: the streak window caps at 60.
  addUser("f");
  for (let i = 0; i <= 65; i++) stmts.push(scanOn("f", i));
  // g: only rows that are not scans.
  addUser("g");
  stmts.push(
    scanOn("g", 0).replace("'user'", "'retry'"),
    scanOn("g", 1).replace("'user'", "'failed'"),
    scanOn("g", 0).replace("'user'", "'correction'"),
    scanOn("g", 1).replace("'user'", "'coach'"),
  );
  // h: today, a gap yesterday, then a run: the streak is 1.
  addUser("h");
  stmts.push(scanOn("h", 0), scanOn("h", 2), scanOn("h", 3), scanOn("h", 4));
  // i: last scan five days ago.
  addUser("i");
  stmts.push(scanOn("i", 5));
  // Plans: paid period (active), lapsed paid, manual comp, comp + paid.
  addUser("paid", { founder_until: now + 5 * DAY });
  stmts.push(scanOn("paid", 1));
  addUser("lapsed", { founder_until: now - DAY });
  addUser("comp", { tier: "'founder'" });
  stmts.push(scanOn("comp", 0), scanOn("comp", 1));
  addUser("paidcomp", { tier: "'founder'", founder_until: now + 5 * DAY });
  // Internal accounts never count in the overview.
  stmts.push(
    `INSERT INTO "user" (id, name, email, created_at) VALUES ('qa', 'qa', 'qa@joyorogo.com', ${TODAY - DAY})`,
  );
  await client.executeMultiple(stmts.join(";\n"));
});

describe("scan activity per user", () => {
  test("today, yesterday and last scan follow Jakarta day edges, not UTC", async () => {
    const { body } = await call("/api/admin/users?pageSize=100");
    const u = byId(body.users);
    // a: 17:00:00Z the evening before and 23:59:59.999 WIB land on different days.
    expect(u.a.scansToday).toBe(1);
    expect(u.a.scansYesterday).toBe(2);
    expect(u.a.lastScanAt).toBe(TODAY);
    expect(u.b).toMatchObject({ scansToday: 0, scansYesterday: 1 });
    expect(u.c).toMatchObject({ scansToday: 0, scansYesterday: 0, lastScanAt: TODAY - 2 * DAY + 12 * 3_600_000 });
    expect(u.d).toMatchObject({ scansToday: 0, scansYesterday: 0, lastScanAt: null, streak: 0 });
    expect(u.e.scansToday).toBe(3);
  });

  test("only user scans count: retry, failed, correction and coach rows do not", async () => {
    const u = byId((await call("/api/admin/users?pageSize=100")).body.users);
    expect(u.g).toMatchObject({ scansToday: 0, scansYesterday: 0, scansTotal: 0, streak: 0, lastScanAt: null });
  });

  test("streak: consecutive days ending today, or yesterday while today is empty", async () => {
    const u = byId((await call("/api/admin/users?pageSize=100")).body.users);
    // 2 days ago 00:00:00.001 is a scan too: today, yesterday, 2 days ago.
    expect(u.a.streak).toBe(3);
    // Yesterday + 2 days ago, then a gap at 3 days ago.
    expect(u.b.streak).toBe(2);
    expect(u.c.streak).toBe(0);
    expect(u.e.streak).toBe(1);
    expect(u.h.streak).toBe(1);
  });

  test("streak is capped at the 60-day window", async () => {
    const u = byId((await call("/api/admin/users?pageSize=100")).body.users);
    expect(u.f.streak).toBe(60);
  });

  test("just after Jakarta midnight yesterday's streak stays alive and 'today' resets", async () => {
    const was = now;
    // 00:00:00.000 WIB tomorrow = 17:00:00Z today: everything shifts one day.
    now = TODAY + DAY;
    try {
      const u = byId((await call("/api/admin/users?pageSize=100")).body.users);
      expect(u.a).toMatchObject({ scansToday: 0, scansYesterday: 1, streak: 3 });
      expect(u.e).toMatchObject({ scansToday: 0, scansYesterday: 3, streak: 1 });
      // One ms earlier it is still the same Jakarta day.
      now = TODAY + DAY - 1;
      const before = byId((await call("/api/admin/users?pageSize=100")).body.users);
      expect(before.a).toMatchObject({ scansToday: 1, scansYesterday: 2, streak: 3 });
      // Two days on, the streak has lapsed (nothing yesterday or today).
      now = TODAY + 2 * DAY + 3_600_000;
      const lapsed = byId((await call("/api/admin/users?pageSize=100")).body.users);
      expect(lapsed.a.streak).toBe(0);
      expect(lapsed.e.streak).toBe(0);
    } finally {
      now = was;
    }
  });

  test("plan: active paid period beats comp beats free", async () => {
    const u = byId((await call("/api/admin/users?pageSize=100")).body.users);
    expect(u.paid.plan).toBe("paid");
    expect(u.paid.tier).toBe("founder");
    expect(u.lapsed.plan).toBe("free");
    expect(u.comp).toMatchObject({ plan: "founder", tier: "founder", manualTier: "founder" });
    expect(u.paidcomp).toMatchObject({ plan: "paid", manualTier: "founder" });
    expect(u.d.plan).toBe("free");
  });
});

describe("filters and sorts", () => {
  test("idle=1: nothing yesterday or today; never-scanned users count", async () => {
    const res = await call("/api/admin/users?idle=1&pageSize=100");
    const got = ids(res.body.users);
    expect(got).toContain("c");
    expect(got).toContain("d");
    expect(got).toContain("g");
    expect(got).toContain("lapsed");
    for (const active of ["a", "b", "e", "f", "h", "paid", "comp"]) expect(got).not.toContain(active);
  });

  test("idle=3 and idle=7 widen the quiet window", async () => {
    // c scanned two days ago: idle for 1 day, not for 3.
    const three = ids((await call("/api/admin/users?idle=3&pageSize=100")).body.users);
    expect(three).toContain("d");
    expect(three).not.toContain("c");
    expect(three).toContain("i");
    // i scanned five days ago: idle for 3 days, not for 7.
    const seven = ids((await call("/api/admin/users?idle=7&pageSize=100")).body.users);
    expect(seven).toContain("d");
    expect(seven).not.toContain("i");
    expect(seven).not.toContain("b");
  });

  test("paid / free + idle isolates the quiet segment", async () => {
    // paid scanned yesterday, paidcomp never: only the latter is idle.
    expect(ids((await call("/api/admin/users?plan=paid&idle=1")).body.users)).toEqual(["paidcomp"]);
    const free = ids((await call("/api/admin/users?plan=free&idle=1&pageSize=100")).body.users);
    expect(free).toContain("d");
    expect(free).not.toContain("a");
    expect((await call("/api/admin/users?plan=paid")).body.total).toBe(2);
    expect((await call("/api/admin/users?plan=founder")).body.total).toBe(1);
  });

  test("sorts by streak, yesterday and last scan in both directions", async () => {
    const top = await call("/api/admin/users?sort=streak&pageSize=10");
    expect(ids(top.body.users).slice(0, 2)).toEqual(["f", "a"]);
    const yest = await call("/api/admin/users?sort=scansYesterday&pageSize=10");
    expect(ids(yest.body.users)[0]).toBe("a");
    // Oldest / never first when ascending.
    const asc = await call("/api/admin/users?sort=lastScan&dir=asc&pageSize=100");
    const order = ids(asc.body.users);
    expect(order.indexOf("d")).toBeLessThan(order.indexOf("c"));
    expect(order.indexOf("c")).toBeLessThan(order.indexOf("b"));
    expect(order.at(-1)).toBeOneOf(["a", "e", "f", "h", "comp"]);
    const desc = await call("/api/admin/users?sort=lastScan&pageSize=100");
    expect(ids(desc.body.users).at(-1)).not.toBe("a");
  });
});

describe("overview and detail", () => {
  test("overview counts accounts that scanned yesterday / today per plan, internal accounts excluded", async () => {
    const { body } = await call("/api/admin/overview");
    expect(body.plans.paid).toEqual({ users: 2, activeYesterday: 1, activeToday: 0 });
    expect(body.plans.founder).toEqual({ users: 1, activeYesterday: 1, activeToday: 1 });
    // free: a b c d e f g h i lapsed (qa excluded); yesterday: a b f; today: a e f h.
    expect(body.plans.free).toEqual({ users: 10, activeYesterday: 3, activeToday: 4 });
  });

  test("detail carries the same fields and 30 zero-filled Jakarta days, user scans only", async () => {
    const { status, body } = await call("/api/admin/users/a");
    expect(status).toBe(200);
    expect(body.user).toMatchObject({ scansToday: 1, scansYesterday: 2, streak: 3, plan: "free" });
    expect(body.perDay).toHaveLength(30);
    expect(body.perDay.at(-1)).toEqual({ day: "2026-03-10", scans: 1 });
    expect(body.perDay.at(-2)).toEqual({ day: "2026-03-09", scans: 2 });
    expect(body.perDay.at(-3)).toEqual({ day: "2026-03-08", scans: 1 });
    expect(body.perDay[0]).toEqual({ day: "2026-02-09", scans: 0 });

    const g = await call("/api/admin/users/g");
    expect(g.body.perDay.every((d: { scans: number }) => d.scans === 0)).toBe(true);
    expect((await call("/api/admin/users/nobody")).status).toBe(404);
  });
});
