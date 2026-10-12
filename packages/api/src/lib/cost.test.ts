import { describe, expect, test } from "bun:test";

import { RP_PER_SCAN_ESTIMATE, estimateCostRp, summarize } from "./cost";

const row = (latencyMs: number) => ({ model: "@cf/zai-org/glm-5.3-flash", latencyMs });

describe("estimateCostRp", () => {
  test("scales linearly with scan count using the documented per-scan estimate", () => {
    expect(estimateCostRp([])).toBe(0);
    expect(estimateCostRp([row(500)])).toBe(RP_PER_SCAN_ESTIMATE);
    expect(estimateCostRp([row(500), row(900), row(1200)])).toBe(estimateCostRp([row(500)]) * 3);
  });
});

describe("summarize", () => {
  test("empty ledger reports zeros", () => {
    expect(summarize([])).toEqual({ scans: 0, estCostRp: 0, avgLatencyMs: 0 });
  });

  test("counts scans and averages latency", () => {
    const result = summarize([row(1000), row(2000), row(3005)]);
    expect(result.scans).toBe(3);
    expect(result.avgLatencyMs).toBe(2002);
    expect(result.estCostRp).toBe(estimateCostRp([row(1), row(2), row(3)]));
  });
});
