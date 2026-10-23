import { call } from "@orpc/server";
import { describe, expect, test } from "bun:test";

import { d1TestDb } from "@joyorogo/db/test-d1";

import type { Context } from "../context";
import { weightRouter } from "./weight";

const { client, db } = await d1TestDb();
await client.executeMultiple(`INSERT INTO "user" (id, name, email) VALUES ('a', 'a', 'a@test.id');`);

const as = () => ({
  context: { db, env: {}, waitUntil: () => {}, session: { user: { id: "a" } } } as unknown as Context,
});

async function row(date: string) {
  const r = await client.execute({ sql: "SELECT * FROM weight_log WHERE user_id = 'a' AND date = ?", args: [date] });
  return r.rows[0] as unknown as Record<string, unknown>;
}

describe("weight.checkIn body composition", () => {
  test("manual entry has no body fields and source manual", async () => {
    await call(weightRouter.checkIn, { weightKg: 70, date: "2026-10-18" }, as());
    expect(await row("2026-10-18")).toMatchObject({ weight_kg: 70, body_fat_pct: null, source: "manual" });
  });

  test("scale entry sets body fields on the same day", async () => {
    await call(weightRouter.checkIn, { weightKg: 70.4, date: "2026-10-18", bodyFatPct: 22.5, musclePct: 40, source: "scale" }, as());
    expect(await row("2026-10-18")).toMatchObject({ weight_kg: 70.4, body_fat_pct: 22.5, muscle_pct: 40, source: "scale" });
  });

  test("a later manual entry updates weight and keeps body fields", async () => {
    await call(weightRouter.checkIn, { weightKg: 71, date: "2026-10-18" }, as());
    expect(await row("2026-10-18")).toMatchObject({ weight_kg: 71, body_fat_pct: 22.5, muscle_pct: 40, source: "scale" });
  });

  test("out-of-range body values are rejected", async () => {
    await expect(call(weightRouter.checkIn, { weightKg: 70, bodyFatPct: 90, source: "scale" }, as())).rejects.toThrow();
    await expect(call(weightRouter.checkIn, { weightKg: 70, visceralFat: 0, source: "scale" }, as())).rejects.toThrow();
  });

  test("history returns the body fields", async () => {
    const h = await call(weightRouter.history, { limit: 10 }, as());
    expect(h.entries.at(-1)).toMatchObject({ bodyFatPct: 22.5, source: "scale" });
  });
});
