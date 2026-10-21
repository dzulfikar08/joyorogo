import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Same transitive-dep import as privacy.test.ts: the D1-shaped libsql driver.
import { createClient } from "../../../db/node_modules/@libsql/client";
import { describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";

import type { Database } from "@joyorogo/db";
import { DEFAULT_DAY_ZONE } from "@joyorogo/i18n";
import { aiUsage } from "@joyorogo/db/schema/fitness";

import { assertCorrectionAllowed, correctionsLeft, correctionsUsed } from "./correct-limit";
import { MAX_CORRECTIONS_PER_DAY, MAX_CORRECTIONS_PER_SCAN } from "./scan-correct";

const client = createClient({ url: ":memory:" });
const migrationsDir = join(import.meta.dir, "../../../db/src/migrations");
for (const file of readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort()) {
  await client.executeMultiple(readFileSync(join(migrationsDir, file), "utf8"));
}
const db = drizzle(client) as unknown as Database;

await client.executeMultiple(
  `INSERT INTO "user" (id, name, email) VALUES ('u1', 'a', 'a@test.id'), ('u2', 'b', 'b@test.id');`,
);

const PHOTO_A = "a".repeat(32);
const PHOTO_B = "b".repeat(32);

async function log(userId: string, photoId: string | null, scanType: "correction" | "user" = "correction") {
  await db.insert(aiUsage).values({
    id: crypto.randomUUID(),
    userId,
    model: "m",
    scanType,
    latencyMs: 1,
    usageJson: JSON.stringify({ kind: "correction", ...(photoId ? { photoId } : {}) }),
  });
}

describe("correction caps", () => {
  test("counts per scan session and per day, only for this user's correction rows", async () => {
    await log("u1", PHOTO_A);
    await log("u1", PHOTO_A);
    await log("u1", PHOTO_B);
    await log("u1", null);
    await log("u1", PHOTO_A, "user");
    await log("u2", PHOTO_A);
    expect(await correctionsUsed(db, "u1", PHOTO_A, DEFAULT_DAY_ZONE)).toEqual({ today: 4, scan: 2 });
    expect(await correctionsUsed(db, "u1", PHOTO_B, DEFAULT_DAY_ZONE)).toEqual({ today: 4, scan: 1 });
    expect(await correctionsUsed(db, "u1", undefined, DEFAULT_DAY_ZONE)).toEqual({ today: 4, scan: 0 });
  });

  test("the per-scan cap blocks with a scan marker, the day cap with a day marker", () => {
    expect(() => assertCorrectionAllowed({ today: 3, scan: MAX_CORRECTIONS_PER_SCAN - 1 }, "id")).not.toThrow();
    expect(() => assertCorrectionAllowed({ today: 3, scan: MAX_CORRECTIONS_PER_SCAN }, "id")).toThrow(
      expect.objectContaining({ code: "TOO_MANY_REQUESTS", data: { correctionsExhausted: "scan" } }),
    );
    expect(() => assertCorrectionAllowed({ today: MAX_CORRECTIONS_PER_DAY, scan: 0 }, "id")).toThrow(
      expect.objectContaining({ code: "TOO_MANY_REQUESTS", data: { correctionsExhausted: "day" } }),
    );
  });

  test("the limit message is in the caller's language", () => {
    expect(() => assertCorrectionAllowed({ today: 0, scan: MAX_CORRECTIONS_PER_SCAN }, "en")).toThrow(
      /limit for this photo/,
    );
    expect(() => assertCorrectionAllowed({ today: 0, scan: MAX_CORRECTIONS_PER_SCAN }, "id")).toThrow(
      /mentok/,
    );
  });

  test("corrections left counts the call that was just allowed", () => {
    expect(correctionsLeft({ today: 0, scan: 0 })).toBe(MAX_CORRECTIONS_PER_SCAN - 1);
    expect(correctionsLeft({ today: 0, scan: MAX_CORRECTIONS_PER_SCAN - 1 })).toBe(0);
  });
});
