import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";

import { founderEmailsDue } from "./email";

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
