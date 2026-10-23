// Same transitive-dep import as privacy.test.ts: the D1-shaped libsql driver.
import { d1TestDb } from "@joyorogo/db/test-d1";
import { afterAll, describe, expect, setSystemTime, test } from "bun:test";

import { aiUsage } from "@joyorogo/db/schema/fitness";

import type { AiBinding } from "../context";
import { requireAiQuota } from "./quota";
import { scansUsedToday } from "./tiers";

const { client, db } = await d1TestDb();

await client.executeMultiple(
  `INSERT INTO "user" (id, name, email) VALUES ('my', 'a', 'a@test.id'), ('id', 'b', 'b@test.id');`,
);

const env = { FREE_DAILY_SCANS: "1", AI: {} as AiBinding };

async function scan(userId: string, at: string) {
  await db.insert(aiUsage).values({
    id: crypto.randomUUID(),
    userId,
    model: "m",
    scanType: "user",
    latencyMs: 1,
    usageJson: "{}",
    createdAt: new Date(at),
  });
}

// 2026-10-21T15:30Z = 23:30 MYT / 22:30 WIB; 16:30Z = 00:30 MYT on the 22nd / 23:30 WIB on the 21st.
await scan("my", "2026-10-21T15:30:00Z");
await scan("id", "2026-10-21T15:30:00Z");
await scan("my", "2026-10-21T16:10:00Z");

const KL = "Asia/Kuala_Lumpur" as const;
const JKT = "Asia/Jakarta" as const;
const allowed = (userId: string, zone: typeof KL | typeof JKT) =>
  requireAiQuota(db, env, userId, "id", zone).then(
    () => true,
    () => false,
  );

afterAll(() => setSystemTime());

describe("daily scan quota follows the user's zone", () => {
  test("a MY user's scan at 23:30 MYT is yesterday after MYT midnight; one made after it still counts", async () => {
    setSystemTime(new Date("2026-10-21T16:30:00Z"));
    expect(await scansUsedToday(db, "my", "2026-10-22", KL)).toBe(1);
    expect(await allowed("my", KL)).toBe(false);
  });

  test("the pre-midnight scan alone does not block a MY user after MYT midnight", async () => {
    setSystemTime(new Date("2026-10-21T16:30:00Z"));
    expect(await scansUsedToday(db, "id", "2026-10-22", KL)).toBe(0);
    expect(await allowed("id", KL)).toBe(true);
  });

  test("still counted on the MYT day before midnight", async () => {
    setSystemTime(new Date("2026-10-21T15:45:00Z"));
    expect(await scansUsedToday(db, "my", "2026-10-21", KL)).toBe(1);
    expect(await allowed("my", KL)).toBe(false);
  });

  test("an ID user's quota resets at WIB midnight, not before", async () => {
    setSystemTime(new Date("2026-10-21T16:30:00Z")); // 23:30 WIB
    expect(await allowed("id", JKT)).toBe(false);
    setSystemTime(new Date("2026-10-21T17:30:00Z")); // 00:30 WIB
    expect(await allowed("id", JKT)).toBe(true);
  });
});
