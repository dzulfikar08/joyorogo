import { describe, expect, test } from "bun:test";

import { d1TestClient, migrationSql } from "@joyorogo/db/test-d1";

const MIGRATION = "0035_barcode_community.sql";

describe("0035_barcode_community", () => {
  test("rows cached before it keep their meaning: source off, misses were Open Food Facts misses", async () => {
    const client = await d1TestClient({ migrations: (file) => file < MIGRATION });
    await client.executeMultiple(`
      INSERT INTO barcode_product (code, status, name, kcal_100) VALUES ('8996001600146', 'found', 'Teh Pucuk', 29);
      INSERT INTO barcode_product (code, status) VALUES ('8997219010406', 'not_found');
    `);
    await client.executeMultiple(migrationSql(MIGRATION));

    const rows = await client.execute(
      `SELECT code, source, contributors, sources_checked, sugar_100 FROM barcode_product ORDER BY code`,
    );
    expect(rows.rows.map((r: Record<string, unknown>) => ({ ...r }))).toEqual([
      { code: "8996001600146", source: "off", contributors: 0, sources_checked: null, sugar_100: null },
      { code: "8997219010406", source: "off", contributors: 0, sources_checked: "off", sugar_100: null },
    ]);
  });

  test("one submission per user per product; a deleted account keeps the values", async () => {
    const client = await d1TestClient();
    await client.executeMultiple(`INSERT INTO "user" (id, name, email) VALUES ('u1','u1','u1@t.id');`);
    const insert = (id: string) =>
      client.execute({
        sql: `INSERT INTO barcode_contribution (id, code, user_id, name, unit, kcal_100) VALUES (?, '8996001600146', 'u1', 'Teh', 'ml', 29)`,
        args: [id],
      });
    await insert("c1");
    await expect(insert("c2")).rejects.toThrow();
    await client.execute(`PRAGMA foreign_keys = ON`);
    await client.execute(`DELETE FROM "user" WHERE id = 'u1'`);
    const left = await client.execute(`SELECT user_id, kcal_100 FROM barcode_contribution`);
    expect(left.rows.map((r: Record<string, unknown>) => ({ ...r }))).toEqual([{ user_id: null, kcal_100: 29 }]);
  });
});
