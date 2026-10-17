// p50/p95 per stage of the AI food scan, read from the prod ai_usage ledger.
// Usage: bun run scripts/scan-timing.ts [--days 14] [--since 2026-10-18T00:00:00Z] [--local]
//   --since  only rows after this instant (e.g. the deploy time, to compare after vs before)
//   --local  query the local D1 instead of prod
// Needs the wrangler login; the Cloudflare account comes from CLOUDFLARE_ACCOUNT_ID.
// Stages are documented in packages/api/src/lib/scan-timing.ts.

import { formatTimingSummary, summarizeScanTiming } from "../packages/api/src/lib/scan-timing";
import type { LedgerRow } from "../packages/api/src/lib/scan-timing";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
};

const days = Number(flag("--days") ?? 14);
const since = flag("--since") ? Date.parse(flag("--since")!) : Date.now() - days * 86_400_000;
if (!Number.isFinite(since)) throw new Error("--since must be an ISO date");
const where = args.includes("--local") ? "--local" : "--remote";

const sql = `select user_id, created_at, scan_type, latency_ms, usage_json from ai_usage where scan_type = 'user' and created_at >= ${Math.floor(since)} order by created_at`;
const proc = Bun.spawn(
  [
    "bunx",
    "wrangler",
    "d1",
    "execute",
    "joyorogo-database-live-dzul-unqpixpckdt72ct3",
    where,
    "--json",
    "--command",
    sql,
  ],
  {
    cwd: new URL("../apps/server", import.meta.url).pathname,
    env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID ?? "3268f27664d77716b648b00c8850469e" },
    stdout: "pipe",
    stderr: "pipe",
  },
);
const out = await new Response(proc.stdout).text();
if ((await proc.exited) !== 0) {
  console.error(await new Response(proc.stderr).text(), out);
  process.exit(1);
}
const parsed = JSON.parse(out.slice(out.indexOf("["))) as Array<{
  results: Array<{
    user_id: string | null;
    created_at: number;
    scan_type: string;
    latency_ms: number;
    usage_json: string | null;
  }>;
}>;
const rows: LedgerRow[] = (parsed[0]?.results ?? []).map((r) => ({
  userId: r.user_id,
  createdAt: r.created_at,
  scanType: r.scan_type,
  latencyMs: r.latency_ms,
  usageJson: r.usage_json,
}));

console.log(`since ${new Date(since).toISOString()}: ${rows.length} user scans`);
console.log(formatTimingSummary(summarizeScanTiming(rows)));
