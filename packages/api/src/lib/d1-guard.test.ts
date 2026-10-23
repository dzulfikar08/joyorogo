// Guards for the "passes on SQLite, 500s on D1" class of bug (D1 binds at most 100 parameters per statement; see lib/d1.ts):
//  - tests get their database from `d1TestDb()` (@joyorogo/db/test-d1), which refuses what D1 refuses; a test that builds
//    its own libsql client would silently allow 32766 parameters again;
//  - a multi-row insert goes through `insertChunked`, never a bare `.values(rows)`.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, test } from "bun:test";

const ROOT = join(import.meta.dir, "../../../..");
const BASES = ["packages/api/src", "apps/server/src", "packages/auth/src", "packages/db/src"];

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === "node_modules" || name === "dist" || name === "migrations") return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

const files = BASES.flatMap((base) => sources(join(ROOT, base))).map((path) => ({
  rel: relative(ROOT, path),
  text: readFileSync(path, "utf8"),
}));

describe("D1 limits are enforced everywhere tests touch a database", () => {
  // The helper is the one place a libsql client is created (this file names the patterns it looks for). email.test.ts runs a hand-made three-column table
  // through bun:sqlite to read back one aggregate; it binds nothing variable.
  const ALLOWED_SQLITE: Record<string, true> = {
    "packages/db/src/test-d1.ts": true,
    "packages/api/src/lib/d1-guard.test.ts": true,
    "apps/server/src/email.test.ts": true,
  };

  test("no code creates a libsql / bun:sqlite database except the test-d1 helper", () => {
    const offenders = files
      .filter(({ rel, text }) => !ALLOWED_SQLITE[rel] && /createClient\s*\(|@libsql\/client|drizzle-orm\/(?:libsql|bun-sqlite)|bun:sqlite|node:sqlite/.test(text))
      .map(({ rel }) => rel);
    expect(offenders).toEqual([]);
  });
});

describe("multi-row inserts", () => {
  // Files whose `.values(x)` takes something other than a literal row, with why it is safe.
  const ROWS_ARE_BOUNDED: Record<string, string> = {
    "packages/api/src/lib/d1.ts": "the chunking helper itself",
    "packages/api/src/routers/workout.ts": "`part` is a slice of rowsPerStatement(workoutSet) rows",
    "packages/api/src/routers/sleep-insights.ts": "one row per statement, built from a variable",
    "packages/api/src/lib/notify.ts": "one row (toRow) per statement",
  };

  test(".values(...) takes a literal row unless the file is listed above; many rows go through insertChunked", () => {
    const offenders: string[] = [];
    for (const { rel, text } of files) {
      if (/\.test\.tsx?$/.test(rel) || rel in ROWS_ARE_BOUNDED) continue;
      // Object.values(x) / map.values() are not inserts; a drizzle insert is `.values(` followed by an argument that is not `{`.
      for (const match of text.matchAll(/(?<![A-Za-z])\.values\(\s*(?![{)\s])/g)) {
        offenders.push(`${rel}:${text.slice(0, match.index).split("\n").length}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
