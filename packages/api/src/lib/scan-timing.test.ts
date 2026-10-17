import { describe, expect, test } from "bun:test";

import { formatTimingSummary, summarizeScanTiming } from "./scan-timing";
import type { LedgerRow } from "./scan-timing";

function row(
  userId: string,
  createdAt: number,
  usage: Record<string, unknown>,
  scanType = "user",
): LedgerRow {
  return { userId, createdAt, scanType, latencyMs: 1000, usageJson: JSON.stringify(usage) };
}

describe("summarizeScanTiming", () => {
  test("percentiles per stage, post-AI time derived from the response time", () => {
    const rows = [1000, 2000, 3000, 4000].map((aiMs, i) =>
      row("u", i, {
        serverTiming: { quotaMs: 10, aiMs, totalMs: aiMs + 10 },
        stickerTiming: { responseMs: aiMs + 110, wholeMs: 2000, quickMs: [aiMs + 500], finalMs: [aiMs + 900] },
      }),
    );
    const { stages, scans } = summarizeScanTiming(rows);
    expect(scans).toEqual({ all: 4, streamed: 0, plain: 4 });
    expect(stages.all["server.aiMs"]).toMatchObject({ n: 4, p50: 2000, p95: 4000, max: 4000 });
    expect(stages.all["server.postAiMs"]).toMatchObject({ p50: 100, max: 100 });
    expect(stages.all["sticker.lagAfterAnswerMs"]).toMatchObject({ p50: 390 });
  });

  test("network time pairs a session's reported round trip with the previous scan's response time", () => {
    const rows = [
      row("u", 1, { serverTiming: { quotaMs: 5, aiMs: 2000, totalMs: 2005 } }),
      row("u", 2, {
        serverTiming: { quotaMs: 5, aiMs: 1000, totalMs: 1005 },
        clientTiming: { prevRoundTripMs: 2705 },
      }),
      // another user's scan in between must not be paired
      row("v", 3, { serverTiming: { quotaMs: 5, aiMs: 9000, totalMs: 9005 } }),
    ];
    expect(summarizeScanTiming(rows).stages.all["derived.networkMs"]).toMatchObject({ n: 1, p50: 700 });
  });

  test("streamed scans form their own cohort; failed and retry rows and bad json are ignored", () => {
    const rows = [
      row("u", 1, { serverTiming: { quotaMs: 5, aiMs: 3000, totalMs: 3005, streamed: true, ttftMs: 700 } }),
      row("u", 2, { serverTiming: { quotaMs: 5, aiMs: 3000, totalMs: 3005 } }),
      row("u", 3, { serverTiming: { aiMs: 1 } }, "retry"),
      { userId: "u", createdAt: 4, scanType: "user", latencyMs: 1, usageJson: "{oops" },
    ];
    const summary = summarizeScanTiming(rows);
    expect(summary.scans).toEqual({ all: 2, streamed: 1, plain: 1 });
    expect(summary.stages.streamed["server.ttftMs"]).toMatchObject({ n: 1, p50: 700 });
    expect(formatTimingSummary(summary)).toContain("== streamed (1 scans) ==");
  });
});
