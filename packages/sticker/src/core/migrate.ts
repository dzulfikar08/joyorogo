import { SCHEMA_VERSION } from "./schema";

/**
 * Template migrations. `MIGRATIONS[v]` upgrades a raw version-v document to v+1 and
 * must be pure. Version 1 is the first schema, so the table starts empty; the runner
 * takes the table as a parameter so tests (and the next schema bump) exercise it.
 */

export type RawTemplate = Record<string, unknown>;
export type Migration = (raw: RawTemplate) => RawTemplate;

/** Deep copy of plain JSON (structuredClone does not exist in Hermes). */
export function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export const MIGRATIONS: Record<number, Migration> = {};

export type MigrateResult =
  | { status: "ok"; raw: RawTemplate; from: number }
  | { status: "invalid" | "too-new" | "failed"; from: number | null; message: string };

export function migrate(
  input: unknown,
  table: Record<number, Migration> = MIGRATIONS,
  target: number = SCHEMA_VERSION,
): MigrateResult {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return { status: "invalid", from: null, message: "template is not an object" };
  }
  let raw = input as RawTemplate;
  const from = raw.schemaVersion;
  if (typeof from !== "number" || !Number.isInteger(from) || from < 1) {
    return { status: "invalid", from: null, message: "schemaVersion missing or invalid" };
  }
  if (from > target) {
    return { status: "too-new", from, message: `schemaVersion ${from} is newer than ${target}` };
  }
  for (let v = from; v < target; v++) {
    const step = table[v];
    if (!step) return { status: "failed", from, message: `no migration from ${v}` };
    try {
      raw = { ...step(cloneJson(raw)), schemaVersion: v + 1 };
    } catch (error) {
      return {
        status: "failed",
        from,
        message: `migration ${v} -> ${v + 1} threw: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
  return { status: "ok", raw, from };
}
