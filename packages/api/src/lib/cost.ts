/**
 * Rough Workers AI cost model for planning dashboards. Cloudflare bills these
 * models per M tokens in USD (the old Neuron scheme is gone from the catalog);
 * everything here is an approximation, not an invoice.
 */

// Active model: @cf/google/gemma-4-26b-a4b-it (AI_VISION_MODEL in
// wrangler.jsonc). Catalog price: $0.10/M input, $0.30/M output. Thinking is
// off; measured 2026-10-28 (scripts/eval-scans.ts, 132 scans) a scan is ~2.4k
// input tokens (prompt + image) + ~210 output tokens:
// 2400 * 0.10e-6 + 210 * 0.30e-6 = $0.0003 ≈ Rp5 at Rp16,000/USD.
export const RP_PER_SCAN_ESTIMATE = 5;

export type UsageRow = {
  model: string;
  latencyMs: number;
};

export function estimateCostRp(rows: readonly UsageRow[]): number {
  return rows.length * RP_PER_SCAN_ESTIMATE;
}

export function summarize(rows: readonly UsageRow[]): {
  scans: number;
  estCostRp: number;
  avgLatencyMs: number;
} {
  const totalLatency = rows.reduce((sum, row) => sum + row.latencyMs, 0);
  return {
    scans: rows.length,
    estCostRp: estimateCostRp(rows),
    avgLatencyMs: rows.length === 0 ? 0 : Math.round(totalLatency / rows.length),
  };
}
