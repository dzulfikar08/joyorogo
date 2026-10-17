/**
 * Reads the scan timing breakdown back out of the ai_usage ledger. The
 * analyzeFood handlers write `serverTiming` (and `stickerTiming`) into
 * usage_json and the clients add `clientTiming`; this folds a set of rows
 * into p50/p95 per stage. Pure, so scripts/scan-timing.ts only does the I/O.
 *
 * Stages, all in ms:
 *  - client: captureMs, resizeMs, encodeMs, payloadKb, and prev* (the previous
 *    scan of that session: round trip, render, crop, first name/item)
 *  - server: receiveMs (request start -> handler: session lookup + the body
 *    upload as the worker saw it), quotaMs, aiMs (the whole model call),
 *    ttftMs (streaming: wait for the first token, inside aiMs), postAiMs
 *    (after the model until the response was ready: R2 + markers + feedback
 *    gate), responseMs (handler start -> response ready)
 *  - derived: networkMs = the client's round trip of a scan minus the
 *    server's responseMs of the same scan (upload + download + routing; the
 *    client reports it with the user's NEXT scan, so rows are paired per user)
 *  - sticker: stickerLagMs = when the last quick cutout landed minus responseMs
 *    (how long after the answer the stickers appear, off the critical path)
 *
 * CPU-only steps (base64 decode, JSON parse, TKPI calibration) cannot be
 * timed with Date.now() inside a Worker: its clock only advances across I/O.
 */

export type LedgerRow = {
  userId: string | null;
  createdAt: number;
  scanType: string;
  latencyMs: number;
  usageJson: string | null;
};

export type StageStats = { n: number; mean: number; p50: number; p95: number; max: number };

export type TimingCohort = "all" | "streamed" | "plain";

export type TimingSummary = {
  scans: Record<TimingCohort, number>;
  stages: Record<TimingCohort, Record<string, StageStats>>;
};

type Json = Record<string, unknown>;

const num = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const obj = (value: unknown): Json | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Json)
    : undefined;

function parse(row: LedgerRow): Json | undefined {
  if (!row.usageJson) return undefined;
  try {
    return obj(JSON.parse(row.usageJson));
  } catch {
    return undefined;
  }
}

/** Nearest-rank percentile of a sorted list. */
function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
}

function stats(values: number[]): StageStats | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  return {
    n: sorted.length,
    mean: sorted.reduce((a, b) => a + b, 0) / sorted.length,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    max: sorted[sorted.length - 1]!,
  };
}

/** Stage name -> value for one successful user scan row. */
export function stagesOf(usage: Json): Record<string, number> {
  const out: Record<string, number> = {};
  const set = (name: string, value: unknown) => {
    const v = num(value);
    if (v !== undefined) out[name] = v;
  };
  const server = obj(usage.serverTiming);
  const client = obj(usage.clientTiming);
  const sticker = obj(usage.stickerTiming);
  if (server) {
    set("server.receiveMs", server.receiveMs);
    set("server.quotaMs", server.quotaMs);
    set("server.aiMs", server.aiMs);
    set("server.ttftMs", server.ttftMs);
    set("server.firstNameMs", server.firstNameMs);
    set("server.firstItemMs", server.firstItemMs);
    const responseMs = num(sticker?.responseMs) ?? num(server.responseMs) ?? num(server.totalMs);
    set("server.responseMs", responseMs);
    const quota = num(server.quotaMs);
    const ai = num(server.aiMs);
    if (responseMs !== undefined && quota !== undefined && ai !== undefined) {
      out["server.postAiMs"] = Math.max(0, responseMs - quota - ai);
    }
  }
  if (client) {
    for (const key of [
      "captureMs",
      "resizeMs",
      "encodeMs",
      "payloadKb",
      "prevRoundTripMs",
      "prevFirstNameMs",
      "prevFirstItemMs",
      "prevRenderMs",
      "prevCropMs",
    ]) {
      set(`client.${key}`, client[key]);
    }
  }
  if (sticker) {
    set("sticker.wholeMs", sticker.wholeMs);
    const quick = Array.isArray(sticker.quickMs) ? sticker.quickMs.flatMap((v) => num(v) ?? []) : [];
    const final = Array.isArray(sticker.finalMs) ? sticker.finalMs.flatMap((v) => num(v) ?? []) : [];
    if (quick.length) set("sticker.quickLastMs", Math.max(...quick));
    if (final.length) set("sticker.finalLastMs", Math.max(...final));
    const responseMs = out["server.responseMs"];
    if (quick.length && responseMs !== undefined) {
      out["sticker.lagAfterAnswerMs"] = Math.max(0, Math.max(...quick) - responseMs);
    }
  }
  set("model.completionTokens", usage.completion_tokens);
  set("model.promptTokens", usage.prompt_tokens);
  set("scan.itemCount", usage.itemCount);
  return out;
}

export function summarizeScanTiming(rows: LedgerRow[]): TimingSummary {
  const ordered = rows
    .filter((row) => row.scanType === "user")
    .sort((a, b) => a.createdAt - b.createdAt);
  const lastByUser = new Map<string, Record<string, number>>();
  const buckets: Record<TimingCohort, Record<string, number[]>> = { all: {}, streamed: {}, plain: {} };
  const scans: Record<TimingCohort, number> = { all: 0, streamed: 0, plain: 0 };
  const add = (cohort: TimingCohort, name: string, value: number) => {
    (buckets[cohort][name] ??= []).push(value);
  };
  for (const row of ordered) {
    const usage = parse(row);
    if (!usage) continue;
    const stages = stagesOf(usage);
    const streamed = obj(usage.serverTiming)?.streamed === true;
    const cohort: TimingCohort = streamed ? "streamed" : "plain";
    const previous = row.userId ? lastByUser.get(row.userId) : undefined;
    const roundTrip = stages["client.prevRoundTripMs"];
    const previousResponse = previous?.["server.responseMs"];
    if (roundTrip !== undefined && previousResponse !== undefined && roundTrip >= previousResponse) {
      stages["derived.networkMs"] = roundTrip - previousResponse;
    }
    if (row.userId) lastByUser.set(row.userId, stages);
    scans.all += 1;
    scans[cohort] += 1;
    for (const [name, value] of Object.entries(stages)) {
      add("all", name, value);
      add(cohort, name, value);
    }
    add("all", "ledger.latencyMs", row.latencyMs);
    add(cohort, "ledger.latencyMs", row.latencyMs);
  }
  const fold = (cohort: TimingCohort) =>
    Object.fromEntries(
      Object.entries(buckets[cohort]).flatMap(([name, values]) => {
        const s = stats(values);
        return s ? [[name, s] as const] : [];
      }),
    );
  return { scans, stages: { all: fold("all"), streamed: fold("streamed"), plain: fold("plain") } };
}

/** A fixed-width table per cohort that has scans. */
export function formatTimingSummary(summary: TimingSummary): string {
  const lines: string[] = [];
  for (const cohort of ["all", "streamed", "plain"] as const) {
    if (summary.scans[cohort] === 0) continue;
    lines.push(`\n== ${cohort} (${summary.scans[cohort]} scans) ==`);
    lines.push(`${"stage".padEnd(30)} ${"n".padStart(4)} ${"p50".padStart(7)} ${"p95".padStart(7)} ${"mean".padStart(7)} ${"max".padStart(7)}`);
    for (const [name, s] of Object.entries(summary.stages[cohort]).sort(([a], [b]) => a.localeCompare(b))) {
      lines.push(
        `${name.padEnd(30)} ${String(s.n).padStart(4)} ${Math.round(s.p50).toString().padStart(7)} ${Math.round(s.p95).toString().padStart(7)} ${Math.round(s.mean).toString().padStart(7)} ${Math.round(s.max).toString().padStart(7)}`,
      );
    }
  }
  return lines.join("\n");
}
