import { describe, expect, test } from "bun:test";

import { d1TestDb } from "@joyorogo/db/test-d1";
import { DEFAULT_DAY_ZONE } from "@joyorogo/i18n";

import { reserveCoachSlot } from "../coach-limit";
import { DEFAULT_JOYO_DAILY_CAP, joyoDailyCap, joyoUsedToday, reserveJoyoSlot, settleJoyoSlot } from "./server-limit";

const { client, db } = await d1TestDb();
await client.executeMultiple(`
  INSERT INTO "user" (id, name, email) VALUES ('a', 'a', 'a@test.id'), ('b', 'b', 'b@test.id'), ('c', 'c', 'c@test.id');
`);
const MODEL = "@cf/test/model";

describe("joyoDailyCap", () => {
  test("unset or garbage = 20, 0 = off, capped at 1000", () => {
    expect(joyoDailyCap({})).toBe(DEFAULT_JOYO_DAILY_CAP);
    expect(joyoDailyCap({ JOYO_AI_DAILY_CAP: "" })).toBe(20);
    expect(joyoDailyCap({ JOYO_AI_DAILY_CAP: "abc" })).toBe(20);
    expect(joyoDailyCap({ JOYO_AI_DAILY_CAP: "-3" })).toBe(20);
    expect(joyoDailyCap({ JOYO_AI_DAILY_CAP: "2.5" })).toBe(20);
    expect(joyoDailyCap({ JOYO_AI_DAILY_CAP: "0" })).toBe(0);
    expect(joyoDailyCap({ JOYO_AI_DAILY_CAP: " 7 " })).toBe(7);
    expect(joyoDailyCap({ JOYO_AI_DAILY_CAP: "5000" })).toBe(1000);
  });
});

describe("joyo slots", () => {
  test("20 concurrent reservations with a cap of 3: exactly 3 get a slot", async () => {
    const slots = await Promise.all(Array.from({ length: 20 }, () => reserveJoyoSlot(db, "a", 3, MODEL, DEFAULT_DAY_ZONE)));
    expect(slots.filter((s) => s !== null)).toHaveLength(3);
    expect(await joyoUsedToday(db, "a", DEFAULT_DAY_ZONE)).toBe(3);
  });

  test("a reserved slot counts at once and settling keeps counts only", async () => {
    const slot = await reserveJoyoSlot(db, "b", 5, MODEL, DEFAULT_DAY_ZONE);
    expect(slot).not.toBeNull();
    expect(await joyoUsedToday(db, "b", DEFAULT_DAY_ZONE)).toBe(1);
    await settleJoyoSlot(db, slot!, {
      latencyMs: 1234,
      outcome: "ok",
      turns: 3,
      calls: 2,
      usage: { inputTokens: 900, outputTokens: 120 },
    });
    const rows = await client.execute(`SELECT scan_type, model, latency_ms, usage_json FROM ai_usage WHERE id = '${slot}'`);
    const row = rows.rows[0]!;
    expect(row.scan_type).toBe("joyo");
    expect(row.model).toBe(MODEL);
    expect(Number(row.latency_ms)).toBe(1234);
    expect(JSON.parse(String(row.usage_json))).toEqual({
      kind: "joyo",
      outcome: "ok",
      turns: 3,
      calls: 2,
      usage: { inputTokens: 900, outputTokens: 120 },
    });
  });

  test("the cap is per account and per kind: coach rows do not count against Joyo AI", async () => {
    expect(await reserveCoachSlot(db, "c", 5, MODEL, DEFAULT_DAY_ZONE)).not.toBeNull();
    expect(await joyoUsedToday(db, "c", DEFAULT_DAY_ZONE)).toBe(0);
    expect(await reserveJoyoSlot(db, "c", 1, MODEL, DEFAULT_DAY_ZONE)).not.toBeNull();
    expect(await reserveJoyoSlot(db, "c", 1, MODEL, DEFAULT_DAY_ZONE)).toBeNull();
    // Another account has its own day.
    expect(await reserveJoyoSlot(db, "b", 100, MODEL, DEFAULT_DAY_ZONE)).not.toBeNull();
  });
});
