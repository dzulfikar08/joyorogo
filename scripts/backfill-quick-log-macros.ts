// One-off: gives the "Catat cepat" rows that were saved without P/K/L their macros.
//
// Before the fix a food logged by name and kcal alone (the recent-food chips, the manual form with its macro
// fields closed) was stored with protein/carbs/fat NULL and counted as 0 g in every day total. For each such
// row (source "manual", "copy" (a chip or story repeat of such a row) or "ai" (a story/scan item the model gave no
// macros for), kcal > 0, all three macros NULL; never "barcode"/"huawei", whose numbers come from the product or the
// export) this tries, in order:
//   1. the same person's own latest row with the same name that has macros, scaled to this row's kcal;
//   2. the TKPI 2019 table row the name names (lib/macro-estimate.ts macrosFromName), scaled to this row's kcal.
// Rows neither resolves are listed and left NULL: the diary marks them "Makro belum diisi" and a tap opens the
// editor. The text-parse model is not called from here. kcal is never touched.
//
// Usage: bun run scripts/backfill-quick-log-macros.ts            dry run: prints what would be written
//        bun run scripts/backfill-quick-log-macros.ts --apply    writes it (UPDATE ... WHERE macros still NULL)
//   --db <name>  default joyorogo-database-live-dzul-unqpixpckdt72ct3
// Reads and writes the REMOTE D1 through wrangler (CLOUDFLARE_ACCOUNT_ID is set below). Idempotent: an applied row
// no longer matches the candidate query, and every UPDATE re-checks that the macros are still NULL.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { macrosFromName } from "../packages/api/src/lib/macro-estimate";

const ROOT = join(import.meta.dir, "..");
const WRANGLER_CONFIG = join(ROOT, "apps", "server", "wrangler.jsonc");
const ACCOUNT_ID = "b7e6f8457bd39fa37a7eea5249799754";

const argv = process.argv.slice(2);
const apply = argv.includes("--apply");
const dbIndex = argv.indexOf("--db");
const DB = dbIndex >= 0 ? argv[dbIndex + 1]! : "joyorogo-database-live-dzul-unqpixpckdt72ct3";

type Candidate = { id: string; user_id: string; date: string; name: string; kcal: number };
type History = {
  user_id: string;
  name: string;
  kcal: number;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  fiber: number | null;
};

async function wrangler(args: string[]): Promise<string> {
  const proc = Bun.spawn(["bunx", "wrangler", "d1", "execute", DB, "--remote", "--config", WRANGLER_CONFIG, ...args], {
    cwd: ROOT,
    env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  if ((await proc.exited) !== 0) throw new Error(`wrangler failed: ${err || out}`);
  return out;
}

async function select<T>(sql: string): Promise<T[]> {
  const parsed = JSON.parse(await wrangler(["--json", "--command", sql])) as Array<{ results: T[] }>;
  return parsed[0]?.results ?? [];
}

const NO_MACROS = "protein IS NULL AND carbs IS NULL AND fat IS NULL";
const candidates = await select<Candidate>(
  `SELECT id, user_id, date, name, kcal FROM food_log WHERE source IN ('manual', 'copy', 'ai') AND kcal > 0 AND ${NO_MACROS} ORDER BY date, created_at`,
);
console.log(`${candidates.length} rows (manual/copy/ai) without macros`);

// The latest own row with macros, per user and name.
const history = await select<History>(
  `SELECT f.user_id, f.name, f.kcal, f.protein, f.carbs, f.fat, f.fiber FROM food_log f
   WHERE (f.protein IS NOT NULL OR f.carbs IS NOT NULL OR f.fat IS NOT NULL)
     AND f.user_id IN (SELECT user_id FROM food_log WHERE source IN ('manual', 'copy', 'ai') AND kcal > 0 AND ${NO_MACROS})
   ORDER BY f.date, f.created_at`,
);
const latest = new Map<string, History>();
for (const row of history) latest.set(`${row.user_id}\u0000${row.name}`, row);

const round1 = (n: number) => Math.round(Math.min(500, n) * 10) / 10;
const updates: string[] = [];
const unresolved: Candidate[] = [];
let fromHistory = 0;
let fromTable = 0;
for (const row of candidates) {
  const own = latest.get(`${row.user_id}\u0000${row.name}`);
  let macros: { protein: number | null; carbs: number | null; fat: number | null; fiber: number | null } | null = null;
  if (own && own.kcal > 0) {
    const ratio = row.kcal / own.kcal;
    macros = {
      protein: own.protein === null ? null : round1(own.protein * ratio),
      carbs: own.carbs === null ? null : round1(own.carbs * ratio),
      fat: own.fat === null ? null : round1(own.fat * ratio),
      fiber: own.fiber === null ? null : round1(own.fiber * ratio),
    };
    fromHistory += 1;
  } else {
    const found = macrosFromName(row.name, row.kcal);
    if (found) {
      macros = { protein: found.protein, carbs: found.carbs, fat: found.fat, fiber: found.fiber ?? null };
      fromTable += 1;
    }
  }
  if (!macros) {
    unresolved.push(row);
    continue;
  }
  const num = (n: number | null) => (n === null ? "NULL" : String(n));
  const id = row.id.replaceAll("'", "''");
  updates.push(
    `UPDATE food_log SET protein = ${num(macros.protein)}, carbs = ${num(macros.carbs)}, fat = ${num(macros.fat)}, fiber = coalesce(fiber, ${num(macros.fiber)}) WHERE id = '${id}' AND ${NO_MACROS};`,
  );
  console.log(`  ${row.date}  ${row.name} (${row.kcal} kcal) -> P ${macros.protein} K ${macros.carbs} L ${macros.fat} F ${macros.fiber}`);
}
console.log(`resolved ${updates.length} (own history ${fromHistory}, TKPI table ${fromTable}); left NULL ${unresolved.length}`);
for (const row of unresolved) console.log(`  left: ${row.date}  ${row.name} (${row.kcal} kcal)`);

// Fiber only: manual/copy rows that carry macros but no fibre (the manual form has no fibre field). The row's own
// latest fibre (same user and name, scaled to kcal), else the TKPI 2019 row. AI rows are left: their fibre comes from the scan.
const fiberRows = await select<Candidate & { fiber: number | null }>(
  `SELECT id, user_id, date, name, kcal, fiber FROM food_log WHERE source IN ('manual', 'copy') AND kcal > 0 AND fiber IS NULL AND (protein IS NOT NULL OR carbs IS NOT NULL OR fat IS NOT NULL) ORDER BY date, created_at`,
);
const fiberHistory = await select<History>(
  `SELECT user_id, name, kcal, protein, carbs, fat, fiber FROM food_log WHERE fiber IS NOT NULL AND kcal > 0 AND user_id IN (SELECT user_id FROM food_log WHERE source IN ('manual', 'copy') AND fiber IS NULL) ORDER BY date, created_at`,
);
const latestFiber = new Map<string, History>();
for (const row of fiberHistory) latestFiber.set(`${row.user_id}\u0000${row.name}`, row);
let fiberResolved = 0;
for (const row of fiberRows) {
  const own = latestFiber.get(`${row.user_id}\u0000${row.name}`);
  const fiber = own && own.fiber !== null && own.kcal > 0 ? round1(own.fiber * (row.kcal / own.kcal)) : (macrosFromName(row.name, row.kcal)?.fiber ?? null);
  if (fiber === null) continue;
  updates.push(`UPDATE food_log SET fiber = ${fiber} WHERE id = '${row.id.replaceAll("'", "''")}' AND fiber IS NULL;`);
  fiberResolved += 1;
  console.log(`  ${row.date}  ${row.name} (${row.kcal} kcal) -> fiber ${fiber}`);
}
console.log(`fibre-only: ${fiberResolved} of ${fiberRows.length} rows with macros but no fibre resolved`);

if (!apply) {
  console.log("dry run: nothing written (pass --apply)");
} else if (updates.length > 0) {
  const dir = await mkdtemp(join(tmpdir(), "backfill-macros-"));
  try {
    const file = join(dir, "backfill.sql");
    await writeFile(file, `${updates.join("\n")}\n`);
    await wrangler(["--file", file]);
    console.log(`applied ${updates.length} updates`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
