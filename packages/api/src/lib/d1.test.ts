import { describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";

import { D1_LIMITS, d1TestDb } from "@joyorogo/db/test-d1";
import { foodLog, waterLog } from "@joyorogo/db/schema/fitness";

import { D1_MAX_PARAMS, chunk, insertChunked, readChunked, rowsPerStatement } from "./d1";

const { client, db } = await d1TestDb();
await client.executeMultiple(`INSERT INTO "user" (id, name, email) VALUES ('u', 'u', 'u@test.id');`);

const args = (n: number) => Array.from({ length: n }, (_, i) => i);
const placeholders = (n: number) => Array.from({ length: n }, () => "?").join(", ");

describe("the test database refuses what D1 refuses", () => {
  test("100 bound parameters pass, 101 throw (execute)", async () => {
    await client.execute({ sql: `SELECT ${placeholders(100)}`, args: args(100) });
    await expect(client.execute({ sql: `SELECT ${placeholders(101)}`, args: args(101) })).rejects.toThrow(/too many SQL variables/);
  });

  test("named parameters count too", async () => {
    const named = Object.fromEntries(args(101).map((i) => [`p${i}`, i]));
    const text = `SELECT ${args(101).map((i) => `:p${i}`).join(", ")}`;
    await expect(client.execute({ sql: text, args: named })).rejects.toThrow(/too many SQL variables/);
  });

  test("every statement of a batch is checked on its own", async () => {
    const ok = { sql: `SELECT ${placeholders(100)}`, args: args(100) };
    await client.batch([ok, ok], "read");
    await expect(client.batch([ok, { sql: `SELECT ${placeholders(101)}`, args: args(101) }], "read")).rejects.toThrow(/too many SQL variables/);
  });

  test("through drizzle: an IN list of 101 throws, of 100 does not", async () => {
    await db.all(sql`SELECT 1 WHERE 1 IN (${sql.join(args(100).map((i) => sql`${i}`), sql`, `)})`);
    // drizzle wraps the driver's error: "Failed query: ..." with the refusal as its cause.
    const refused = await Promise.resolve(db.all(sql`SELECT 1 WHERE 1 IN (${sql.join(args(101).map((i) => sql`${i}`), sql`, `)})`)).catch((e: Error) => e);
    expect((refused as Error & { cause?: Error }).cause?.message).toMatch(/too many SQL variables/);
  });

  test("a LIKE / GLOB pattern over 50 bytes is refused, bound or literal; a long value elsewhere is not", async () => {
    await client.execute({ sql: `SELECT 'x' LIKE ?`, args: ["%" + "a".repeat(48) + "%"] });
    await expect(client.execute({ sql: `SELECT 'x' LIKE ?`, args: ["%" + "a".repeat(49) + "%"] })).rejects.toThrow(/pattern too complex/);
    await expect(client.execute({ sql: `SELECT ? = 1 AND 'x' GLOB ?`, args: ["y".repeat(80), "z".repeat(51)] })).rejects.toThrow(/pattern too complex/);
    await client.execute({ sql: `SELECT ? = 1 AND 'x' GLOB ?`, args: ["y".repeat(80), "z"] });
    await expect(client.execute(`SELECT 'x' LIKE '%${"a".repeat(60)}%'`)).rejects.toThrow(/pattern too complex/);
  });

  test("a statement over 100 KB, a value over 2 MB and an interactive transaction are refused", async () => {
    await expect(client.execute(`SELECT '${"x".repeat(D1_LIMITS.statementBytes)}'`)).rejects.toThrow(/statement too long/);
    await expect(client.execute({ sql: "SELECT ?", args: ["x".repeat(D1_LIMITS.valueBytes + 1)] })).rejects.toThrow(/over 2000000 bytes/);
    await expect(client.transaction("write")).rejects.toThrow(/no interactive transactions/);
  });
});

describe("chunk", () => {
  test("slices in order, the last one short", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 3)).toEqual([]);
  });

  test("a size that is not a positive integer is a bug, not an endless loop", () => {
    expect(() => chunk([1], 0)).toThrow();
    expect(() => chunk([1], 1.5)).toThrow();
  });
});

describe("rowsPerStatement", () => {
  test("is 100 divided by the table's columns", () => {
    expect(rowsPerStatement(foodLog)).toBe(5);
    expect(rowsPerStatement(waterLog)).toBe(33);
  });
});

describe("insertChunked", () => {
  const food = (n: number, prefix: string) =>
    Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, userId: "u", date: "2026-10-23", meal: "sarapan", name: `item ${i}`, kcal: 100, source: "manual" }));

  test("stores every row of a list that does not fit one statement and answers each statement's rows", async () => {
    const answered = await insertChunked(db, foodLog, food(23, "a"), (insert) => insert.returning({ id: foodLog.id }));
    expect(answered.map((part) => part.length)).toEqual([5, 5, 5, 5, 3]);
    expect(answered.flat().map((r) => r.id)).toEqual(food(23, "a").map((r) => r.id));
    expect((await client.execute(`SELECT count(*) AS n FROM food_log WHERE id LIKE 'a%'`)).rows[0]?.n).toBe(23);
  });

  test("without a finish it just inserts", async () => {
    await insertChunked(db, foodLog, food(11, "b"));
    expect((await client.execute(`SELECT count(*) AS n FROM food_log WHERE id LIKE 'b%'`)).rows[0]?.n).toBe(11);
  });

  test("a list that fits runs as one statement; an empty one runs none", async () => {
    expect(await insertChunked(db, foodLog, [], (insert) => insert.returning())).toEqual([]);
    const one = await insertChunked(db, foodLog, food(5, "c"), (insert) => insert.returning({ id: foodLog.id }));
    expect(one).toHaveLength(1);
    expect(one[0]).toHaveLength(5);
  });

  test("all or nothing: a clash in the last statement leaves no row of the earlier ones", async () => {
    await insertChunked(db, foodLog, food(1, "clash"));
    const list = [...food(10, "d"), ...food(1, "clash")];
    await expect(insertChunked(db, foodLog, list)).rejects.toThrow();
    expect((await client.execute(`SELECT count(*) AS n FROM food_log WHERE id LIKE 'd%'`)).rows[0]?.n).toBe(0);
  });

  test("onConflictDoNothing in finish skips a clash and still stores the rest", async () => {
    await insertChunked(db, foodLog, [food(12, "e")[3]!]);
    const answered = await insertChunked(db, foodLog, food(12, "e"), (insert) =>
      insert.onConflictDoNothing({ target: foodLog.id }).returning({ id: foodLog.id }),
    );
    expect(answered.flat()).toHaveLength(11);
    expect(answered.flat().map((r) => r.id)).not.toContain("e3");
  });
});

describe("readChunked", () => {
  test("every slice stays under the cap with the other bound values counted, and the answers join in order", async () => {
    const seen: number[] = [];
    const keys = args(250);
    const out = await readChunked(
      keys,
      async (slice) => {
        seen.push(slice.length);
        await client.execute({ sql: `SELECT ${placeholders(slice.length + 3)}`, args: [...slice, 1, 2, 3] });
        return slice;
      },
      { reserved: 3 },
    );
    expect(out).toEqual(keys);
    expect(Math.max(...seen)).toBe(D1_MAX_PARAMS - 3);
  });

  test("a key bound twice (a tuple) counts twice", async () => {
    const seen: number[] = [];
    await readChunked(args(100), async (slice) => (seen.push(slice.length), []), { reserved: 2, perKey: 2 });
    expect(seen).toEqual([49, 49, 2]);
  });
});
