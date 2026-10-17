import type { Hono } from "hono";

import type { JobResult } from "./accuracy-job";

type Deps = {
  /** The ACCURACY_RUN_KEY secret; unset = the route answers 404. */
  key: string | undefined;
  run: (opts: { date?: string; force?: boolean }) => Promise<JobResult>;
};

// POST /ai/accuracy/run?date=YYYY-MM-DD&force=1 with X-Bench-Key: builds (or, with
// force, rebuilds) that day's accuracy report exactly like the daily cron does.
// Default date: yesterday (WIB). Same key-gate style as /ai/bench; the key is its
// own secret so rotating it touches nothing else. Answers with the job status and
// the report's headline; the full report is in R2 and the admin "Laporan" tab.
export function registerAccuracyRoutes(app: Hono, deps: Deps) {
  app.post("/ai/accuracy/run", async (c) => {
    if (!deps.key || c.req.header("X-Bench-Key") !== deps.key) return c.text("Not Found", 404);
    const date = c.req.query("date");
    if (date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return c.json({ error: "date must be YYYY-MM-DD" }, 400);
    }
    const run = deps.run({ date, force: c.req.query("force") === "1" });
    // The run outlives a dropped connection: it spends the AI budget either way.
    c.executionCtx.waitUntil(run.catch(() => undefined));
    const result = await run;
    return c.json({
      date: result.date,
      status: result.status,
      email: result.report?.email ?? null,
      scans: result.report?.scans.total ?? null,
      regression: result.report?.regression
        ? {
            ran: result.report.regression.summary.cases,
            failed: result.report.regression.summary.failed,
            flags: result.report.regression.flags,
            error: result.report.regression.error ?? null,
          }
        : null,
    });
  });
}
