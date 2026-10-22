import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { sql as dsql } from "drizzle-orm";
import { payment } from "@joyorogo/db/schema/billing";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";

import { adminDraft, amountLabel, founderEmailsDue, TEST_MARKER } from "./email";
import { realPayment } from "./real-payment";

const NOW = Date.UTC(2026, 9, 15, 8, 0, 0);
const DAY = 24 * 60 * 60 * 1000;

describe("founderEmailsDue", () => {
  const { sql, params } = new SQLiteSyncDialect().sqlToQuery(founderEmailsDue(NOW)!);

  test("binds only D1-safe primitives (a Date param makes D1 reject the query)", () => {
    for (const p of params) expect(["string", "number"]).toContain(typeof p);
    expect(params).toEqual(["free", NOW, NOW + 3 * DAY, NOW, NOW - DAY]);
  });

  test("selects the ending-soon and just-expired windows, only for tier=free", () => {
    const db = new Database(":memory:");
    db.run('create table "user" (id text primary key, tier text not null, founder_until integer)');
    db.run("create table google_purchase (purchase_token text primary key, user_id text not null, state text not null)");
    const rows: [string, string, number | null][] = [
      ["ending", "free", NOW + DAY],
      ["edge-3d", "free", NOW + 3 * DAY],
      ["too-far", "free", NOW + 3 * DAY + 1],
      ["expired", "free", NOW - 1],
      ["too-old", "free", NOW - DAY],
      ["no-period", "free", null],
      ["comp-ending", "founder", NOW + DAY],
      ["comp-expired", "founder", NOW - 1],
      ["play-active", "free", NOW + DAY],
      ["play-grace", "free", NOW + DAY],
      ["play-canceled", "free", NOW + DAY],
      ["play-expired", "free", NOW - 1],
    ];
    for (const r of rows) db.run('insert into "user" values (?, ?, ?)', r);
    // An auto-renewing Play subscription renews the period itself: no reminder.
    // A canceled or lapsed one will not, so those still get the mails.
    for (const [id, state] of [
      ["play-active", "active"],
      ["play-grace", "grace"],
      ["play-canceled", "canceled"],
      ["play-expired", "expired"],
    ] as const) {
      db.run("insert into google_purchase values (?, ?, ?)", [`tok-${id}`, id, state]);
    }

    const due = db
      .query(`select id from "user" where ${sql} order by id`)
      .all(...(params as (string | number)[])) as { id: string }[];
    expect(due.map((r) => r.id)).toEqual([
      "edge-3d",
      "ending",
      "expired",
      "play-canceled",
      "play-expired",
    ]);
  });
});

describe("amountLabel (admin order notice)", () => {
  test("Rupiah only on an IDR gateway; the charged currency first, with its ledger equivalent, on Polar", () => {
    expect(amountLabel({ amountIdr: 29_000, charged: null })).toBe("Rp29.000");
    expect(amountLabel({ amountIdr: 193_556, charged: { currency: "MYR", minor: 4399 } })).toBe("RM43.99 (setara Rp193.556 di ledger)");
    expect(amountLabel({ amountIdr: 195_720, charged: { currency: "SGD", minor: 1398 } })).toBe("S$13.98 (setara Rp195.720 di ledger)");
    expect(amountLabel({ amountIdr: 29_000, charged: { currency: "USD", minor: 999 } })).toBe("US$9.99 (setara Rp29.000 di ledger)");
  });
});

describe("adminDraft test marker", () => {
  const base = {
    orderId: "google:GPA.1",
    gateway: "google",
    name: "Budi",
    email: "budi@example.com",
    months: 1,
    amountIdr: 29_000,
    charged: null,
    founderUntil: null,
  };

  test("a test purchase is flagged in subject, html and text", () => {
    const d = adminDraft({ ...base, isTest: true });
    expect(d.subject).toContain(TEST_MARKER);
    expect(d.html).toContain(TEST_MARKER);
    expect(d.text).toContain(TEST_MARKER);
  });

  test("a real purchase carries no marker", () => {
    const d = adminDraft({ ...base, isTest: false });
    expect(d.subject).toBe("Pro baru: Rp29.000 — Budi");
    expect(d.html).not.toContain(TEST_MARKER);
    expect(d.text).not.toContain(TEST_MARKER);
  });
});

describe("realPayment (revenue exclusion)", () => {
  test("sums real and unknown rows, skips tests", () => {
    const sqlite = new Database(":memory:");
    sqlite.run("create table payment (order_id text, amount_idr integer, is_test integer)");
    sqlite.run("insert into payment values ('a', 29000, 0), ('b', 29000, null), ('c', 29000, 1), ('d', 100000, 1)");
    const [row] = drizzle(sqlite)
      .select({ total: dsql<number>`sum(${payment.amountIdr})` })
      .from(payment)
      .where(realPayment)
      .all();
    expect(row?.total).toBe(58_000);
  });
});
