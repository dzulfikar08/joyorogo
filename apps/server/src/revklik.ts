import { backfillLedger, enqueueLedger, flushOutbox, revklikConfig, sweepRecentLedger } from "@joyorogo/api/lib/revklik";
import type { BackfillResult, FlushResult, LedgerKind, RevklikEnv } from "@joyorogo/api/lib/revklik";
import type { Database } from "@joyorogo/db";

/**
 * RevKlik revenue forwarding for this Worker (docs/revklik-forwarding.md). Off (every call a no-op) until REVKLIK_TOKEN
 * and REVKLIK_SITE_ID are set, so self-hosts are unaffected.
 */
export function createRevklik(deps: { env: RevklikEnv; getDb: () => Database }) {
  const config = revklikConfig(deps.env);
  return {
    enabled: config !== null,
    /** Queue one ledger event; the billing paths call it after the paid flip / refund. `rail` names DOKU vs Pakasir. */
    onLedger: async (orderId: string, kind: LedgerKind, rail?: string): Promise<void> => {
      if (config) await enqueueLedger(deps.getDb(), orderId, kind, { rail });
    },
    flush: (): Promise<FlushResult> => flushOutbox(deps.getDb(), config),
    /** Cron: catch ledger rows whose enqueue was lost, then deliver. */
    cron: async (): Promise<void> => {
      if (!config) return;
      const db = deps.getDb();
      await sweepRecentLedger(db, new Date());
      await flushOutbox(db, config);
    },
    /** Admin: queue every historical real order and refund, then deliver the first batch. */
    backfill: async (): Promise<BackfillResult & { flush: FlushResult; enabled: boolean }> => {
      const db = deps.getDb();
      const queued = await backfillLedger(db);
      const flush: FlushResult = { sent: 0, failed: 0, parked: 0 };
      // A few rounds of one batch each (D1/subrequest budget); the cron delivers the rest.
      for (let round = 0; round < 5; round++) {
        const step = await flushOutbox(db, config);
        flush.sent += step.sent;
        flush.failed += step.failed;
        flush.parked += step.parked;
        if (step.sent === 0) break;
      }
      return { ...queued, enabled: config !== null, flush };
    },
  };
}

export type Revklik = ReturnType<typeof createRevklik>;
