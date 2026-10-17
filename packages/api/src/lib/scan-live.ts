import type { StreamedItem, VisionEvent } from "./vision";

/**
 * Client side of the streaming scan (ai.analyzeFoodStream), shared by web and
 * native: folds the server's events into the rows shown while the model is
 * still writing, and falls back to the plain call when streaming is not
 * available. The final result always comes from the closing `done` event (or
 * the plain call), never from the rows.
 */

/** One row of the live list: the name first, the item once its numbers are in. */
export type LiveRow = { index: number; name: string; item?: StreamedItem };

/** The stream: progress events, then exactly one `done` with the final result. */
export type ScanStreamEvent<R> = VisionEvent | { type: "done"; result: R };

/** Fold one progress event into the live rows (returns a new array). */
export function applyScanEvent(rows: LiveRow[], event: VisionEvent): LiveRow[] {
  if (event.type === "reset") return [];
  const row: LiveRow =
    event.type === "name"
      ? { index: event.index, name: event.name }
      : { index: event.index, name: event.item.name, item: event.item };
  const next = rows.filter((existing) => existing.index !== row.index);
  next.push(row);
  return next.sort((a, b) => a.index - b.index);
}

/** ms since the request started, for dev logs and the ledger's clientTiming. */
export type ScanStreamTiming = { firstNameMs?: number; firstItemMs?: number; doneMs: number };

/**
 * No event arrived yet and the failure is a transport one (or an unknown
 * procedure on an older server): the scan did not run to completion on the
 * server, so the plain call is safe to try. A verdict from the server
 * (ORPCError with any other code, e.g. "not food" or a paywall) or a user
 * abort is final.
 */
export function streamUnavailable(error: unknown, eventsSeen: boolean): boolean {
  if (eventsSeen) return false;
  if (typeof error !== "object" || error === null) return true;
  if ("name" in error && error.name === "AbortError") return false;
  if ("code" in error && typeof error.code === "string") return error.code === "NOT_FOUND";
  return true;
}

export type StreamedScan<R> = { result: R; timing: ScanStreamTiming; streamed: boolean };

/**
 * Runs the streaming call, reporting live rows, and resolves with the final
 * result. When the stream cannot be used (see streamUnavailable) the plain
 * `fallback` runs instead and `streamed` is false.
 */
export async function analyzeStreaming<R>(opts: {
  open: () => Promise<AsyncIterable<ScanStreamEvent<R>>>;
  fallback: () => Promise<R>;
  onRows: (rows: LiveRow[]) => void;
  now?: () => number;
}): Promise<StreamedScan<R>> {
  const now = opts.now ?? (() => performance.now());
  const startedAt = now();
  const timing: ScanStreamTiming = { doneMs: 0 };
  let rows: LiveRow[] = [];
  let eventsSeen = false;
  try {
    for await (const event of await opts.open()) {
      eventsSeen = true;
      if (event.type === "done") {
        timing.doneMs = Math.round(now() - startedAt);
        return { result: event.result, timing, streamed: true };
      }
      if (event.type === "name") timing.firstNameMs ??= Math.round(now() - startedAt);
      if (event.type === "item") timing.firstItemMs ??= Math.round(now() - startedAt);
      rows = applyScanEvent(rows, event);
      opts.onRows(rows);
    }
    throw new Error("scan stream ended without a result");
  } catch (error) {
    if (!streamUnavailable(error, eventsSeen)) throw error;
    opts.onRows([]);
    const result = await opts.fallback();
    timing.doneMs = Math.round(now() - startedAt);
    return { result, timing, streamed: false };
  }
}
