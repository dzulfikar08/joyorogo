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
    const rows: [string, string, number | null][] = [
      ["ending", "free", NOW + DAY],
      ["edge-3d", "free", NOW + 3 * DAY],
      ["too-far", "free", NOW + 3 * DAY + 1],
      ["expired", "free", NOW - 1],
      ["too-old", "free", NOW - DAY],
      ["no-period", "free", null],
      ["comp-ending", "founder", NOW + DAY],
      ["comp-expired", "founder", NOW - 1],
    ];
    for (const r of rows) db.run('insert into "user" values (?, ?, ?)', r);

    const due = db
      .query(`select id from "user" where ${sql} order by id`)
      .all(...(params as (string | number)[])) as { id: string }[];
    expect(due.map((r) => r.id)).toEqual(["edge-3d", "ending", "expired"]);
  });
});
