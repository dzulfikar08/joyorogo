import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

// @libsql/client is a transitive dep of @joyorogo/db (see privacy.test.ts).
import { createClient } from "../../../db/node_modules/@libsql/client";

const migrationsDir = join(import.meta.dir, "../../../db/src/migrations");
const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort();
const MIGRATION = "0057_dishware.sql";

describe("0057_dishware", () => {
  test("is the next migration after 0056 and is mirrored for deploy", () => {
    expect(files[files.indexOf("0056_manual_tdee.sql") + 1]).toBe(MIGRATION);
    const deployed = readdirSync(join(import.meta.dir, "../../../db/migrations-deploy"));
    expect(deployed).toContain(MIGRATION);
    expect(readFileSync(join(import.meta.dir, "../../../db/migrations-deploy", MIGRATION), "utf8")).toBe(
      readFileSync(join(migrationsDir, MIGRATION), "utf8"),
    );
  });

  test("applies on top of a database that already holds users, and adds only the dishware table", async () => {
    const client = createClient({ url: ":memory:" });
    for (const file of files.filter((f) => f < MIGRATION)) {
      await client.executeMultiple(readFileSync(join(migrationsDir, file), "utf8"));
    }
    await client.executeMultiple(`INSERT INTO "user" (id, name, email) VALUES ('u1','u1','u1@t.id');`);
    const before = await client.execute(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`);
    await client.executeMultiple(readFileSync(join(migrationsDir, MIGRATION), "utf8"));
    const after = await client.execute(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`);
    const names = (rows: Array<Record<string, unknown>>) => rows.map((r) => r.name);
    const known = names(before.rows);
    const added = names(after.rows).filter((n) => !known.includes(n));
    expect(added).toEqual(["dishware"]);
    expect((await client.execute(`SELECT count(*) AS n FROM "user"`)).rows[0]?.n).toBe(1);
  });

  test("a plate defaults to a typed diameter and an empty description, and goes with its account", async () => {
    const client = createClient({ url: ":memory:" });
    for (const file of files) await client.executeMultiple(readFileSync(join(migrationsDir, file), "utf8"));
    await client.executeMultiple(`
      PRAGMA foreign_keys = ON;
      INSERT INTO "user" (id, name, email) VALUES ('u1','u1','u1@t.id');
      INSERT INTO dishware (id, user_id, name, kind, diameter_cm, photo_id) VALUES ('d1','u1','Piring makan putih','flat',24,'p1');
    `);
    const row = (await client.execute(`SELECT diameter_source, description, width_cm, created_at FROM dishware`)).rows[0]!;
    expect(row.diameter_source).toBe("manual");
    expect(row.description).toBe("");
    expect(row.width_cm).toBeNull();
    expect(Number(row.created_at)).toBeGreaterThan(1_700_000_000_000);
    await client.executeMultiple(`PRAGMA foreign_keys = ON; DELETE FROM "user" WHERE id = 'u1';`);
    expect((await client.execute(`SELECT count(*) AS n FROM dishware`)).rows[0]?.n).toBe(0);
  });
});
