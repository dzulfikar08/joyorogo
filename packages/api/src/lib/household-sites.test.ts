import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// Joyo Keluarga members are Pro through their household, never through user.founder_until (docs/pricing/joyo-keluarga.md
// section 3). So every Pro gate selects `proUntil` (lib/household.ts). This test fails when new code reads the raw
// column outside the places that must: billing credit/refund paths, admin edits, receipts and the person's own dates.
// A new read site either uses proUntil / PRO_UNTIL_RAW_SQL, or gets a line here saying why the raw column is right.

const ROOT = join(import.meta.dirname, "../../../..");
const SCANNED = ["packages/api/src", "apps/server/src"];
const RAW_READ = /user\.founderUntil|\bfounder_until\b/;

/** File -> raw reads allowed (code lines, comments excluded), with the reason. */
const ALLOWED: Record<string, { count: number; why: string }> = {
  "packages/api/src/lib/polar-billing.ts": { count: 1, why: "the account-exists check before a credit" },
  "apps/server/src/billing.ts": { count: 2, why: "activateOrder: rupiah credit with its optimistic guard" },
  "packages/api/src/lib/household.ts": {
    count: 5,
    why: "proUntil itself, and periodTarget: the credit/refund target every store rail writes through",
  },
  "packages/api/src/routers/household.ts": { count: 1, why: "the invite screen shows the person's own Pro apart" },
  "packages/api/src/lib/joyo-pro.ts": { count: 1, why: "joyoProStatus reads own and household dates apart" },
  "apps/server/src/joyo-pro.ts": { count: 1, why: "same, after a JoyoArto purchase" },
  "packages/api/src/routers/profile.ts": { count: 1, why: "myProfile.founderUntil is the person's own period" },
  "apps/server/src/email.ts": { count: 5, why: "expiry mails are about the own period (household-covered people excluded)" },
  "apps/server/src/admin.ts": { count: 3, why: "admin shows and edits the own period; the founders count is buyers" },
  "apps/server/src/broadcast.ts": { count: 1, why: "the {date} merge field is the own paid period" },
  "apps/server/src/broadcast-routes.ts": { count: 1, why: "same, test send" },
};

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

function rawReads(path: string): number {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .filter((line) => RAW_READ.test(line)).length;
}

describe("Pro read sites go through proUntil", () => {
  const found = new Map<string, number>();
  for (const dir of SCANNED) {
    for (const path of sourceFiles(join(ROOT, dir))) {
      const count = rawReads(path);
      if (count > 0) found.set(relative(ROOT, path), count);
    }
  }

  test("no file reads user.founder_until beyond its allowance", () => {
    const over = [...found]
      .filter(([file, count]) => count > (ALLOWED[file]?.count ?? 0))
      .map(([file, count]) => `${file}: ${count} raw reads, allowed ${ALLOWED[file]?.count ?? 0}`);
    expect(over).toEqual([]);
  });

  test("the allowlist has no stale entries", () => {
    const stale = Object.entries(ALLOWED)
      .filter(([file, { count }]) => (found.get(file) ?? 0) !== count)
      .map(([file, { count }]) => `${file}: allowed ${count}, found ${found.get(file) ?? 0}`);
    expect(stale).toEqual([]);
  });
});
