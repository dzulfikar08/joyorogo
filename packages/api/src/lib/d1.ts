// Cloudflare D1 binds at most 100 parameters per statement (local SQLite allows 32766, so only a test on
// @joyorogo/db/test-d1 notices). Anything whose size comes from the caller goes through these helpers:
//   - a multi-row insert: `insertChunked` (one statement per slice of rows, one atomic db.batch),
//   - `IN (...)` / `VALUES (...)` over caller-sized lists: `readChunked` (one query per slice).
// d1-guard.test.ts fails when code outside this file builds such a statement without them.
import { getTableColumns, getTableName } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { SQLiteInsertBase, SQLiteTable } from "drizzle-orm/sqlite-core";

import type { Database } from "@joyorogo/db";

/** D1's cap on bound parameters in one statement. */
export const D1_MAX_PARAMS = 100;

/** `items` in slices of at most `size`, in order. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (!Number.isInteger(size) || size < 1) throw new Error(`chunk size must be a positive integer, got ${size}`);
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** The most rows one INSERT into `table` can carry: drizzle may bind every column of every row. */
export function rowsPerStatement(table: SQLiteTable): number {
  const columns = Object.keys(getTableColumns(table)).length;
  if (columns > D1_MAX_PARAMS) throw new Error(`${getTableName(table)} has ${columns} columns, more than D1 binds in one statement`);
  return Math.floor(D1_MAX_PARAMS / columns);
}

/**
 * Inserts `rows` into `table` as one statement per slice that fits D1's parameter cap, in a single `db.batch` (D1 runs a
 * batch as one transaction, so all of the rows land or none). `finish` shapes each statement, e.g. `.onConflictDoNothing()`
 * or `.returning()`; the answer holds one result per statement, in row order.
 */
export async function insertChunked<
  T extends SQLiteTable,
  Q extends BatchItem<"sqlite"> = SQLiteInsertBase<T, "async", D1Result, undefined, false, never>,
>(
  db: Database,
  table: T,
  rows: readonly T["$inferInsert"][],
  finish?: (insert: SQLiteInsertBase<T, "async", D1Result, undefined, false, never>) => Q,
): Promise<Array<Awaited<Q>>> {
  if (rows.length === 0) return [];
  const statements = chunk(rows, rowsPerStatement(table)).map((part) => {
    const insert = db.insert(table).values(part) as SQLiteInsertBase<T, "async", D1Result, undefined, false, never>;
    return finish ? finish(insert) : (insert as unknown as Q);
  });
  if (statements.length === 1) return [(await statements[0]!) as Awaited<Q>];
  const [first, ...rest] = statements;
  return (await db.batch([first!, ...rest])) as Array<Awaited<Q>>;
}

/**
 * Runs `read` once per slice of `keys` and joins the answers. `reserved` is how many other values the query binds, so
 * a slice never carries more than `D1_MAX_PARAMS - reserved` of the keys (a key bound twice, or a tuple, counts per bind:
 * pass `perKey`).
 */
export async function readChunked<K, R>(
  keys: readonly K[],
  read: (slice: K[]) => PromiseLike<R[]>,
  options: { reserved?: number; perKey?: number } = {},
): Promise<R[]> {
  const size = Math.floor((D1_MAX_PARAMS - (options.reserved ?? 0)) / (options.perKey ?? 1));
  const out: R[] = [];
  for (const slice of chunk(keys, size)) out.push(...(await read(slice)));
  return out;
}
