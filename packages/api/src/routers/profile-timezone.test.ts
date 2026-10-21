import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { call } from "@orpc/server";
import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";

// @libsql/client is a transitive dep of @joyorogo/db (see privacy.test.ts).
import { createClient } from "../../../db/node_modules/@libsql/client";
import { profile } from "@joyorogo/db/schema/fitness";
import type { Database } from "@joyorogo/db";
import type { Region } from "@joyorogo/i18n";

import type { Context } from "../context";
import { jakartaToday, shiftDate } from "../lib/engine";
import { userZone, zoneOfUser, zonesOfUsers } from "../lib/user-zone";
import { profileRouter } from "./profile";

const client = createClient({ url: ":memory:" });
const migrationsDir = join(import.meta.dir, "../../../db/src/migrations");
for (const file of readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort()) {
  await client.executeMultiple(readFileSync(join(migrationsDir, file), "utf8"));
}
await client.executeMultiple(`
  INSERT INTO "user" (id, name, email) VALUES ('legacy', 'l', 'l@test.id'), ('my', 'm', 'm@test.my'), ('sg', 's', 's@test.sg'), ('fresh', 'f', 'f@test.my'), ('sea', 'x', 'x@test.id');
  INSERT INTO profile (user_id, birth_year, gender, height_cm, start_weight_kg, target_weight_kg, target_date, activity_level)
    VALUES ('legacy', 1990, 'male', 170, 80, 70, '2027-06-01', 'light');
`);

const db = drizzle(client) as unknown as Database;
const as = (userId: string, region?: Region) => ({
  context: { db, env: {}, region, waitUntil: () => {}, session: { user: { id: userId } } } as unknown as Context,
});
const onboarding = (timezone?: string) => ({
  birthYear: 1992,
  gender: "female" as const,
  heightCm: 160,
  weightKg: 70,
  targetWeightKg: 60,
  targetDate: shiftDate(jakartaToday(), 200),
  activityLevel: "light" as const,
  ...(timezone ? { timezone } : {}),
});
const stored = async (id: string) => (await db.select({ tz: profile.timezone }).from(profile).where(eq(profile.userId, id)))[0]?.tz;

describe("profile.timezone", () => {
  test("a profile from before zones keeps WIB, whatever region the request comes from", async () => {
    expect(await stored("legacy")).toBeNull();
    expect(await zoneOfUser(db, "legacy", "MY")).toBe("Asia/Jakarta");
    expect(await userZone(as("legacy", "MY").context as Parameters<typeof userZone>[0])).toBe("Asia/Jakarta");
  });

  test("someone not onboarded yet gets the zone of their region", async () => {
    expect(await zoneOfUser(db, "fresh", "MY")).toBe("Asia/Kuala_Lumpur");
    expect(await zoneOfUser(db, "fresh", "SG")).toBe("Asia/Singapore");
    expect(await zoneOfUser(db, "fresh")).toBe("Asia/Jakarta");
  });

  test("onboarding stores the device zone when we serve it, else the region's zone", async () => {
    await call(profileRouter.upsert, onboarding("Asia/Kuala_Lumpur"), as("my", "MY"));
    expect(await stored("my")).toBe("Asia/Kuala_Lumpur");
    await call(profileRouter.upsert, onboarding("Asia/Singapore"), as("sg", "SG"));
    expect(await stored("sg")).toBe("Asia/Singapore");
    await call(profileRouter.upsert, onboarding("Asia/Makassar"), as("sea", "ID"));
    expect(await stored("sea")).toBe("Asia/Jakarta");
    // The device wins over the region: a Malaysian-region request from a Singapore phone.
    await client.execute(`INSERT INTO "user" (id, name, email) VALUES ('trip', 't', 't@test.sg')`);
    await call(profileRouter.upsert, onboarding("Asia/Singapore"), as("trip", "MY"));
    expect(await stored("trip")).toBe("Asia/Singapore");
    await call(profileRouter.upsert, onboarding(), as("fresh", "MY"));
    expect(await stored("fresh")).toBe("Asia/Kuala_Lumpur");
  });

  test("setTimezone moves the days of a profile and ignores a zone we do not serve", async () => {
    expect(await call(profileRouter.setTimezone, { timezone: "Asia/Singapore" }, as("legacy"))).toEqual({ timezone: "Asia/Singapore" });
    expect(await stored("legacy")).toBe("Asia/Singapore");
    expect(await call(profileRouter.setTimezone, { timezone: "Europe/Paris" }, as("legacy"))).toEqual({ timezone: "Asia/Singapore" });
    expect(await stored("legacy")).toBe("Asia/Singapore");
    await call(profileRouter.setTimezone, { timezone: "Asia/Jakarta" }, as("legacy"));
    expect(await stored("legacy")).toBe("Asia/Jakarta");
  });

  test("zonesOfUsers reads many profiles at once; a user without a profile row is absent", async () => {
    const zones = await zonesOfUsers(db, ["legacy", "my", "sg", "nobody"]);
    expect(zones.get("my")).toBe("Asia/Kuala_Lumpur");
    expect(zones.get("sg")).toBe("Asia/Singapore");
    expect(zones.get("legacy")).toBe("Asia/Jakarta");
    expect(zones.has("nobody")).toBe(false);
  });
});
