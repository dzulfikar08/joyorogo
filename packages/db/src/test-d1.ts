// The one way a test gets a database: an in-memory libsql/SQLite with every migration applied, behind a guard that
// refuses what Cloudflare D1 refuses. Local SQLite allows 32766 bound parameters, so a query that binds 102 passes every
// test and then fails in production (food.addScan, a 6-item scan: "too many SQL variables"). packages/api's
// d1-test-guard.test.ts fails when a test creates a libsql client any other way.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { createClient, type Client, type InStatement } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

import type { Database } from "./index";

/** https://developers.cloudflare.com/d1/platform/limits/ — each limit applies to every statement inside a batch. */
export const D1_LIMITS = {
  boundParameters: 100,
  statementBytes: 100_000,
  /** A bound string or BLOB; a table row is capped at the same size. */
  valueBytes: 2_000_000,
  /** A LIKE or GLOB pattern ("LIKE or GLOB pattern too complex" beyond it). */
  patternBytes: 50,
} as const;

const MIGRATIONS_DIR = join(import.meta.dirname, "migrations");

/** Migration file names in apply order. */
export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort();
}

export function migrationSql(file: string): string {
  return readFileSync(join(MIGRATIONS_DIR, file), "utf8");
}

function valueBytes(value: unknown): number {
  if (typeof value === "string") return Buffer.byteLength(value);
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return value.byteLength;
  return 0;
}

/** The patterns of `x LIKE ?` / `x GLOB ?` (the bound value at that position) and of `x LIKE '...'` literals. */
function likePatterns(sql: string, args: readonly unknown[]): string[] {
  const out: string[] = [];
  for (const match of sql.matchAll(/\b(?:like|glob)\s+(?:\?|'((?:[^']|'')*)')/gi)) {
    if (match[1] !== undefined) {
      out.push(match[1]);
      continue;
    }
    const position = sql.slice(0, match.index + match[0].length).split("?").length - 2;
    const bound = args[position];
    if (typeof bound === "string") out.push(bound);
  }
  return out;
}

/** Throws what D1 would throw for one statement. */
export function assertD1Statement(statement: InStatement): void {
  const sql = typeof statement === "string" ? statement : statement.sql;
  const named = typeof statement !== "string" && statement.args !== undefined && !Array.isArray(statement.args);
  const args: unknown[] = typeof statement === "string" ? [] : Array.isArray(statement.args) ? statement.args : Object.values(statement.args ?? {});
  const head = sql.slice(0, 120);
  if (args.length > D1_LIMITS.boundParameters) {
    throw new Error(`D1: too many SQL variables (${args.length} bound, the limit is ${D1_LIMITS.boundParameters}): ${head}`);
  }
  if (Buffer.byteLength(sql) > D1_LIMITS.statementBytes) throw new Error(`D1: statement too long (${sql.length} chars): ${head}`);
  for (const pattern of likePatterns(sql, named ? [] : args)) {
    if (Buffer.byteLength(pattern) > D1_LIMITS.patternBytes) {
      throw new Error(`D1: LIKE or GLOB pattern too complex (${Buffer.byteLength(pattern)} bytes, the limit is ${D1_LIMITS.patternBytes}): ${head}`);
    }
  }
  for (const arg of args) {
    if (valueBytes(arg) > D1_LIMITS.valueBytes) throw new Error(`D1: a bound value is over ${D1_LIMITS.valueBytes} bytes: ${head}`);
  }
}

/** The client with D1's limits enforced on execute and batch; D1 has no interactive transactions, so they throw. */
export function enforceD1Limits(client: Client): Client {
  return new Proxy(client, {
    get(target, key) {
      if (key === "execute") {
        return async (statement: InStatement) => {
          assertD1Statement(statement);
          return target.execute(statement);
        };
      }
      if (key === "batch") {
        return async (statements: InStatement[], mode?: Parameters<Client["batch"]>[1]) => {
          statements.forEach(assertD1Statement);
          return target.batch(statements, mode);
        };
      }
      if (key === "transaction") {
        return async () => {
          throw new Error("D1: no interactive transactions; use db.batch");
        };
      }
      const value: unknown = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

export interface D1TestOptions {
  /** Which migrations to apply, by file name (default all); a migration test applies the ones before the one under test. */
  migrations?: (file: string) => boolean;
}

/** Fresh in-memory database with the migrations applied and D1's limits enforced. */
export async function d1TestClient(options: D1TestOptions = {}): Promise<Client> {
  const client = createClient({ url: ":memory:" });
  for (const file of migrationFiles().filter(options.migrations ?? (() => true))) {
    await client.executeMultiple(migrationSql(file));
  }
  return enforceD1Limits(client);
}

/** `d1TestClient` plus the drizzle `Database` the routers and stores take. */
export async function d1TestDb(options: D1TestOptions = {}): Promise<{ client: Client; db: Database }> {
  const client = await d1TestClient(options);
  return { client, db: drizzle(client) as unknown as Database };
}
