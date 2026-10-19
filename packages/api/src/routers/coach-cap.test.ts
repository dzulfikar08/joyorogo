import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { call } from "@orpc/server";
import { describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";

// @libsql/client is a transitive dep of @joyorogo/db (see privacy.test.ts).
import { createClient } from "../../../db/node_modules/@libsql/client";
import type { Database } from "@joyorogo/db";

import type { Context } from "../context";
import type { CoachSnapshot } from "../lib/coach-chat";
import { coachUsedToday } from "../lib/coach-limit";
import { coachRouter } from "./coach";

// The daily cap is taken BEFORE the model runs, in one conditional INSERT: concurrent chat calls cannot all pass a read-then-write check.

const client = createClient({ url: ":memory:" });
const migrationsDir = join(import.meta.dir, "../../../db/src/migrations");
for (const file of readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort()) {
  await client.executeMultiple(readFileSync(join(migrationsDir, file), "utf8"));
}
await client.executeMultiple(`
  INSERT INTO "user" (id, name, email, tier) VALUES ('a', 'a', 'a@test.id', 'founder'), ('b', 'b', 'b@test.id', 'founder'), ('c', 'c', 'c@test.id', 'founder');
`);
const db = drizzle(client) as unknown as Database;

const snapshot: CoachSnapshot = {
  generatedAt: 1,
  today: "2026-10-18",
  readiness: null,
  load: null,
  hrv: null,
  sleep: null,
  strain: null,
  restingHr: null,
  vo2max: null,
  suggestion: null,
  plan: null,
  workouts: [],
};
const input = {
  messages: [{ role: "user" as const, content: "Latihan apa yang pas besok?" }],
  snapshot,
  locale: "id" as const,
};

function setup(
  userId: string,
  cap: number,
  ai: { run(model: string, body: unknown): Promise<unknown> } | undefined,
) {
  const pending: Promise<unknown>[] = [];
  const context = {
    db,
    env: { COACH_DAILY_CAP: String(cap), FREE_DAILY_SCANS: "3", AI: ai },
    locale: "id",
    waitUntil: (p: Promise<unknown>) => void pending.push(p),
    session: { user: { id: userId, createdAt: new Date(0) } },
  } as unknown as Context;
  return { context, settled: () => Promise.all(pending) };
}

const slowAi = (counter: { calls: number }, outcome: "ok" | "fail" = "ok") => ({
  run: async () => {
    counter.calls++;
    // Long enough that every concurrent request is past its cap check before the first model call returns.
    await new Promise((resolve) => setTimeout(resolve, 40));
    if (outcome === "fail") throw new Error("model down");
    return { response: "Jalan santai 30 menit ya." };
  },
});

describe("coach.chat daily cap", () => {
  test("20 concurrent calls with a cap of 3: exactly 3 reach the model, the rest are refused with the cap error", async () => {
    const counter = { calls: 0 };
    const { context, settled } = setup("a", 3, slowAi(counter));
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () => call(coachRouter.chat, input, { context })),
    );
    await settled();
    expect(counter.calls).toBe(3);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
    const refused = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(refused).toHaveLength(17);
    for (const r of refused)
      expect(r.reason).toMatchObject({
        code: "TOO_MANY_REQUESTS",
        data: { coachCapReached: true, cap: 3 },
      });
    expect(await coachUsedToday(db, "a")).toBe(3);
  });

  test("a call that fails in the model still counts (the cap counts every call that reached it), and the row records the outcome", async () => {
    const counter = { calls: 0 };
    const { context, settled } = setup("b", 2, slowAi(counter, "fail"));
    const first = await call(coachRouter.chat, input, { context }).catch((e) => e);
    await settled();
    expect(first).toMatchObject({ code: "UNPROCESSABLE_CONTENT" });
    expect(await coachUsedToday(db, "b")).toBe(1);
    const rows = await client.execute(
      `SELECT usage_json, latency_ms FROM ai_usage WHERE user_id = 'b' AND scan_type = 'coach'`,
    );
    expect(JSON.parse(String(rows.rows[0]?.usage_json))).toMatchObject({
      kind: "coach",
      outcome: "failed",
      turns: 1,
    });
    expect(Number(rows.rows[0]?.latency_ms)).toBeGreaterThanOrEqual(30);
  });

  test("a successful call answers with the used count, and the cap is per account", async () => {
    const counter = { calls: 0 };
    const a = setup("c", 1, slowAi(counter));
    const reply = await call(coachRouter.chat, input, { context: a.context });
    await a.settled();
    expect(reply).toMatchObject({
      reply: "Jalan santai 30 menit ya.",
      used: 1,
      cap: 1,
      flagged: null,
    });
    await expect(call(coachRouter.chat, input, { context: a.context })).rejects.toMatchObject({
      code: "TOO_MANY_REQUESTS",
    });
    // Another account has its own day.
    const other = setup("a", 100, slowAi(counter));
    await expect(call(coachRouter.chat, input, { context: other.context })).resolves.toMatchObject({
      cap: 100,
    });
  });

  test("no model binding means nothing is reserved", async () => {
    const { context } = setup("c", 50, undefined);
    const before = await coachUsedToday(db, "c");
    await expect(call(coachRouter.chat, input, { context })).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
    });
    expect(await coachUsedToday(db, "c")).toBe(before);
  });

  test("a flagged (safety) message never reaches the model and takes no slot", async () => {
    const counter = { calls: 0 };
    const { context } = setup("b", 5, slowAi(counter));
    const before = await coachUsedToday(db, "b");
    const reply = await call(
      coachRouter.chat,
      { ...input, messages: [{ role: "user" as const, content: "nyeri dada waktu lari" }] },
      { context },
    );
    expect(reply.flagged).toBe("medical");
    expect(counter.calls).toBe(0);
    expect(await coachUsedToday(db, "b")).toBe(before);
  });
});
