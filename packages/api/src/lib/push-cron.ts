import { DEFAULT_DAY_ZONE } from "@joyorogo/i18n";

import { wibMinutes } from "./fasting";
import { checkReceipts, flushOutbox, pruneOutbox, runDigest } from "./notify";
import { runReminders } from "./reminders";
import type { ReminderDeps } from "./reminders";

export type PushCronReport = { reminders: number; delivered: number; digests: number; receipts: number };

/**
 * One five-minute tick of the push pipeline, in this order: store the reminders that are due, deliver everything due
 * (reminders, retries, rows that waited out quiet hours, new-post fan-outs), send the evening digest, read Expo
 * receipts. The first tick after midnight WIB also prunes old rows. Each step is isolated: one failing never skips
 * the others.
 */
export async function runPushCron(deps: ReminderDeps): Promise<PushCronReport> {
  const report: PushCronReport = { reminders: 0, delivered: 0, digests: 0, receipts: 0 };
  const step = async (name: string, work: () => Promise<void>) => {
    try {
      await work();
    } catch (error) {
      console.error(`[push] ${name} failed`, error);
    }
  };
  await step("reminders", async () => {
    report.reminders = await runReminders(deps);
  });
  await step("flush", async () => {
    report.delivered = await flushOutbox(deps);
  });
  await step("digest", async () => {
    report.digests = await runDigest(deps);
  });
  await step("receipts", async () => {
    report.receipts = await checkReceipts(deps);
  });
  const now = (deps.now ?? (() => new Date()))();
  // WIB on purpose: housekeeping of the shared outbox, once a day, not a person's day.
  if (wibMinutes(now, DEFAULT_DAY_ZONE) < 5) await step("prune", () => pruneOutbox(deps));
  return report;
}
