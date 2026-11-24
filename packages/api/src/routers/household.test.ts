import { call } from "@orpc/server";
import { beforeEach, describe, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";

import { d1TestDb } from "@joyorogo/db/test-d1";
import { user } from "@joyorogo/db/schema/auth";
import { householdEvent, householdMember } from "@joyorogo/db/schema/household";

import type { Context } from "../context";
import {
  HOUSEHOLD_CHURN_JOINS,
  HOUSEHOLD_MAX_SEATS,
  deleteUserHousehold,
  ensureOwnedHousehold,
  proUntil,
} from "../lib/household";
import { joyoProStatus, findJoyoUser } from "../lib/joyo-pro";
import { effectiveTier, paywallConfig } from "../lib/tiers";
import { householdRouter } from "./household";

const { client, db } = await d1TestDb();

const DAY = 24 * 60 * 60 * 1000;
const ON = { KELUARGA_ENABLED: "1", FREE_DAILY_SCANS: "3" };

const as = (userId: string | null, env: Record<string, string> = ON) => ({
  context: {
    db,
    env,
    locale: "id",
    clientIp: null,
    waitUntil: () => {},
    session: userId ? { user: { id: userId, name: `Name ${userId}` } } : null,
  } as unknown as Context,
});

async function paidHousehold(ownerId: string, until = Date.now() + 30 * DAY) {
  const home = await ensureOwnedHousehold(db, ownerId);
  await client.execute({ sql: `UPDATE household SET paid_until = ? WHERE id = ?`, args: [until, home.id] });
  return home.id;
}

async function tierOf(userId: string) {
  const [row] = await db.select({ tier: user.tier, founderUntil: proUntil }).from(user).where(eq(user.id, userId));
  return { tier: effectiveTier(row), until: row?.founderUntil ?? null };
}

async function invite(ownerId: string) {
  return call(householdRouter.createInvite, undefined, as(ownerId));
}

const errorOf = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (error: { code?: string; message?: string }) => error,
  );

beforeEach(async () => {
  await client.executeMultiple(`
    DELETE FROM household_event; DELETE FROM household_invite; DELETE FROM household_member; DELETE FROM household;
    DELETE FROM payment; DELETE FROM "user";
    INSERT INTO "user" (id, name, email, email_verified) VALUES
      ('owner', 'Siti Aminah', 'owner@test.id', 1), ('a', 'A', 'a@test.id', 1), ('b', 'B', 'b@test.id', 1),
      ('c', 'C', 'c@test.id', 1), ('d', 'D', 'd@test.id', 1), ('e', 'E', 'e@test.id', 1),
      ('owner2', 'Budi', 'owner2@test.id', 1);
  `);
});

describe("proUntil (household entitlement)", () => {
  test("a member of a paid household is Pro; leaving ends it at once", async () => {
    await paidHousehold("owner");
    const { code } = await invite("owner");
    expect((await tierOf("a")).tier).toBe("free");
    await call(householdRouter.accept, { code }, as("a"));
    expect((await tierOf("a")).tier).toBe("founder");
    expect((await tierOf("owner")).tier).toBe("founder");
    await call(householdRouter.leave, undefined, as("a"));
    expect((await tierOf("a")).tier).toBe("free");
  });

  test("the later of the own period and the household's wins; an expired household grants nothing", async () => {
    const own = Date.now() + 90 * DAY;
    await client.execute({ sql: `UPDATE "user" SET founder_until = ? WHERE id = 'a'`, args: [own] });
    await paidHousehold("owner");
    const { code } = await invite("owner");
    await call(householdRouter.accept, { code }, as("a"));
    expect((await tierOf("a")).until?.getTime()).toBe(own);
    await client.execute(`UPDATE household SET paid_until = ${Date.now() - DAY}`);
    expect((await tierOf("b")).tier).toBe("free");
    // Own period still runs after the household lapsed.
    expect((await tierOf("a")).tier).toBe("founder");
    await client.execute(`UPDATE "user" SET founder_until = NULL WHERE id = 'a'`);
    expect((await tierOf("a")).tier).toBe("free");
    expect((await tierOf("owner")).tier).toBe("free");
  });

  test("joyoProStatus answers source keluarga when the household date is the later one", async () => {
    const until = Date.now() + 30 * DAY;
    await paidHousehold("owner", until);
    const { code } = await invite("owner");
    await call(householdRouter.accept, { code }, as("a"));
    const config = paywallConfig({ FREE_DAILY_SCANS: "3" });
    const status = await joyoProStatus(db, config, await findJoyoUser(db, { email: "a@test.id" }));
    expect(status).toEqual({ pro: true, until: new Date(until).toISOString(), plan: "keluarga", source: "keluarga" });
    const outsider = await joyoProStatus(db, config, await findJoyoUser(db, { email: "b@test.id" }));
    expect(outsider.pro).toBe(false);
  });
});

describe("household router", () => {
  test("everything is NOT_FOUND while KELUARGA_ENABLED is off, and get says so", async () => {
    await paidHousehold("owner");
    const off = { FREE_DAILY_SCANS: "3" };
    expect((await errorOf(call(householdRouter.createInvite, undefined, as("owner", off))))?.code).toBe("NOT_FOUND");
    const got = await call(householdRouter.get, undefined, as("owner", off));
    expect(got).toEqual({ enabled: false, seats: HOUSEHOLD_MAX_SEATS, household: null });
  });

  test("invites are single use and stored only as a hash", async () => {
    await paidHousehold("owner");
    const { code } = await invite("owner");
    const stored = await client.execute(`SELECT code_hash FROM household_invite`);
    expect(stored.rows[0]?.code_hash).not.toBe(code);
    expect(String(stored.rows[0]?.code_hash)).toHaveLength(64);
    await call(householdRouter.accept, { code: code.toLowerCase() }, as("a"));
    const second = await errorOf(call(householdRouter.accept, { code }, as("b")));
    expect(second?.code).toBe("BAD_REQUEST");
    expect(second?.message).toBe("Undangan ini sudah dipakai.");
  });

  test("an expired or canceled invite does not work", async () => {
    await paidHousehold("owner");
    const { code } = await invite("owner");
    await client.execute(`UPDATE household_invite SET expires_at = ${Date.now() - 1000}`);
    expect((await errorOf(call(householdRouter.accept, { code }, as("a"))))?.message).toContain("kedaluwarsa");
    const again = await invite("owner");
    const owner = await call(householdRouter.get, undefined, as("owner"));
    await call(householdRouter.cancelInvite, { id: owner.household!.invites[0]!.id }, as("owner"));
    expect((await errorOf(call(householdRouter.accept, { code: again.code }, as("a"))))?.message).toContain("dibatalkan");
  });

  test("seats: members plus pending invites stay within 5, the owner included", async () => {
    await paidHousehold("owner");
    for (let i = 0; i < HOUSEHOLD_MAX_SEATS - 1; i++) await invite("owner");
    expect((await errorOf(invite("owner")))?.message).toContain("kursi");
  });

  test("one household per account: accepting while in another answers 409", async () => {
    await paidHousehold("owner");
    await paidHousehold("owner2");
    const first = await invite("owner");
    const second = await invite("owner2");
    await call(householdRouter.accept, { code: first.code }, as("a"));
    const error = await errorOf(call(householdRouter.accept, { code: second.code }, as("a")));
    expect(error?.code).toBe("CONFLICT");
    expect(error?.message).toBe("Kamu sudah di keluarga lain; keluar dulu.");
    // The other owner's code was not used up by the refused attempt.
    await call(householdRouter.accept, { code: second.code }, as("b"));
  });

  test("no invites while unpaid; an invite to a lapsed household is refused", async () => {
    const id = await paidHousehold("owner");
    const { code } = await invite("owner");
    await client.execute({ sql: `UPDATE household SET paid_until = ? WHERE id = ?`, args: [Date.now() - DAY, id] });
    expect((await errorOf(invite("owner")))?.code).toBe("BAD_REQUEST");
    expect((await errorOf(call(householdRouter.accept, { code }, as("a"))))?.message).toContain("berakhir");
  });

  test("the owner cannot leave; only the owner removes; a removed member loses Pro", async () => {
    await paidHousehold("owner");
    const { code } = await invite("owner");
    await call(householdRouter.accept, { code }, as("a"));
    expect((await errorOf(call(householdRouter.leave, undefined, as("owner"))))?.code).toBe("BAD_REQUEST");
    expect((await errorOf(call(householdRouter.removeMember, { userId: "owner" }, as("a"))))?.code).toBe("FORBIDDEN");
    await call(householdRouter.removeMember, { userId: "a" }, as("owner"));
    expect((await tierOf("a")).tier).toBe("free");
    const events = await db.select({ kind: householdEvent.kind }).from(householdEvent);
    expect(events.map((e) => e.kind).sort()).toEqual(["join", "removed"]);
  });

  test("get: the owner sees members and invites, a member only the owner's name", async () => {
    await paidHousehold("owner");
    const { code } = await invite("owner");
    await call(householdRouter.accept, { code }, as("a"));
    await invite("owner");
    const owner = await call(householdRouter.get, undefined, as("owner"));
    expect(owner.household?.role).toBe("owner");
    expect(owner.household?.members.map((m) => m.userId)).toEqual(["owner", "a"]);
    expect(owner.household?.invites).toHaveLength(1);
    expect(JSON.stringify(owner)).not.toContain("@test.id");
    const member = await call(householdRouter.get, undefined, as("a"));
    expect(member.household).toMatchObject({ role: "member", ownerName: "Siti Aminah", members: [], invites: [] });
  });

  test("preview is public: owner's first name and seats; a signed-in viewer sees their own Pro", async () => {
    await paidHousehold("owner");
    const { code } = await invite("owner");
    const anonymous = await call(householdRouter.preview, { code }, as(null));
    expect(anonymous).toMatchObject({ ownerFirstName: "Siti", seatsUsed: 1, seats: 5, state: "ok", viewer: null });
    await client.execute(`UPDATE "user" SET founder_until = ${Date.now() + 10 * DAY} WHERE id = 'b'`);
    const viewer = await call(householdRouter.preview, { code }, as("b"));
    expect(viewer.viewer?.membership).toBeNull();
    expect(viewer.viewer?.ownPro?.renews).toBeNull();
    expect(viewer.viewer?.ownPro?.until).toBeInstanceOf(Date);
  });

  test("churn limit: at most 8 joins in 12 months beyond the first fill", async () => {
    const id = await paidHousehold("owner");
    const old = Date.now() - 400 * DAY;
    // Joins older than 12 months do not count.
    await db.insert(householdEvent).values({ householdId: id, userId: null, kind: "join", at: new Date(old) });
    const recent = HOUSEHOLD_MAX_SEATS - 1 + HOUSEHOLD_CHURN_JOINS;
    for (let i = 0; i < recent; i++) {
      await db.insert(householdEvent).values({ householdId: id, userId: null, kind: "join", at: new Date(Date.now() - DAY) });
    }
    expect((await errorOf(invite("owner")))?.message).toContain("pergantian");
    await client.execute(`DELETE FROM household_event WHERE id IN (SELECT id FROM household_event WHERE at > ${old} LIMIT 1)`);
    expect((await invite("owner")).code).toHaveLength(8);
  });

  test("account deletion: the owner's household goes, members lose household Pro", async () => {
    await paidHousehold("owner");
    const { code } = await invite("owner");
    await call(householdRouter.accept, { code }, as("a"));
    expect(await deleteUserHousehold(db, "owner")).toEqual(["a"]);
    expect((await tierOf("a")).tier).toBe("free");
    expect(await db.select().from(householdMember)).toEqual([]);
  });

  test("account deletion of a member logs the leave and keeps the household", async () => {
    await paidHousehold("owner");
    const { code } = await invite("owner");
    await call(householdRouter.accept, { code }, as("a"));
    expect(await deleteUserHousehold(db, "a")).toEqual([]);
    await client.execute(`DELETE FROM "user" WHERE id = 'a'`);
    const [left] = await db
      .select({ total: sql<number>`count(*)` })
      .from(householdEvent)
      .where(eq(householdEvent.kind, "leave"));
    expect(left?.total).toBe(1);
    expect((await tierOf("owner")).tier).toBe("founder");
  });
});
