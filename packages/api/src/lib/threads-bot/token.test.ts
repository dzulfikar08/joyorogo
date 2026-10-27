import { d1TestDb } from "@joyorogo/db/test-d1";
import { afterAll, beforeEach, describe, expect, test } from "bun:test";

import { threadsAccount } from "@joyorogo/db/schema/threads";

import { FakeGraph, OWN } from "./fixtures";
import {
  REFRESH_RETRY_MS,
  REFRESH_WINDOW_MS,
  ensureAccount,
  readAccount,
  saveConnectedToken,
  statusFor,
} from "./token";

const { client, db } = await d1TestDb();
const graph = new FakeGraph();
graph.install();
afterAll(() => graph.uninstall());

const NOW = Date.parse("2026-10-27T05:00:00Z");
const DAY = 86_400_000;

beforeEach(async () => {
  graph.reset();
  await client.execute(`DELETE FROM threads_account`);
});

describe("statusFor", () => {
  test("ok beyond 7 days, expiring inside, expired past", () => {
    expect(statusFor(NOW + 30 * DAY, NOW)).toBe("ok");
    expect(statusFor(NOW + REFRESH_WINDOW_MS - 1, NOW)).toBe("expiring");
    expect(statusFor(NOW, NOW)).toBe("expired");
    expect(statusFor(NOW - 1, NOW)).toBe("expired");
  });
});

describe("ensureAccount", () => {
  test("no row and no seed: null, no Graph call", async () => {
    expect(await ensureAccount(db, undefined, NOW)).toBeNull();
    expect(graph.calls).toHaveLength(0);
  });

  test("the seed secret becomes a D1 row, is refreshed at once (its real expiry is unknown) and the own user is read", async () => {
    const account = await ensureAccount(db, "seed-token", NOW);
    expect(account).toEqual({ token: "tok-refreshed", userId: OWN.id, username: OWN.username });
    const row = (await readAccount(db))!;
    expect(row).toMatchObject({
      source: "seed",
      status: "ok",
      accessToken: "tok-refreshed",
      threadsUserId: "100",
      username: "joyorogo",
    });
    expect(row.expiresAt.getTime()).toBe(NOW + 5_184_000_000);
    expect(graph.callsTo("refresh_access_token")).toHaveLength(1);
  });

  test("a healthy token is used as is: no refresh, no /me after the first time", async () => {
    await ensureAccount(db, "seed-token", NOW);
    graph.calls = [];
    expect(await ensureAccount(db, "seed-token", NOW + DAY)).toMatchObject({
      token: "tok-refreshed",
    });
    expect(graph.calls).toHaveLength(0);
  });

  test("inside the 7-day window it refreshes and stores the new 60 days", async () => {
    await ensureAccount(db, "seed-token", NOW);
    const later = NOW + 55 * DAY;
    graph.calls = [];
    await ensureAccount(db, undefined, later);
    expect(graph.callsTo("refresh_access_token")).toHaveLength(1);
    const row = (await readAccount(db))!;
    expect(row.expiresAt.getTime()).toBe(later + 5_184_000_000);
    expect(row.refreshedAt!.getTime()).toBe(later);
  });

  test("a refresh Meta refuses keeps the old token, marks it expiring, records the error, and is not retried for 6 hours", async () => {
    await ensureAccount(db, "seed-token", NOW);
    graph.failRefresh = true;
    const later = NOW + 55 * DAY;
    expect(await ensureAccount(db, undefined, later)).toMatchObject({ token: "tok-refreshed" });
    let row = (await readAccount(db))!;
    expect(row.status).toBe("expiring");
    expect(row.lastError).toContain("refresh:");
    expect(graph.callsTo("refresh_access_token")).toHaveLength(2);

    await ensureAccount(db, undefined, later + REFRESH_RETRY_MS - 1000);
    expect(graph.callsTo("refresh_access_token")).toHaveLength(2);
    graph.failRefresh = false;
    await ensureAccount(db, undefined, later + REFRESH_RETRY_MS + 1000);
    expect(graph.callsTo("refresh_access_token")).toHaveLength(3);
    row = (await readAccount(db))!;
    expect(row).toMatchObject({ status: "ok", lastError: null });
  });

  test("a lapsed token is reported expired but still tried", async () => {
    await ensureAccount(db, "seed-token", NOW);
    graph.failRefresh = true;
    const account = await ensureAccount(db, undefined, NOW + 70 * DAY);
    expect(account?.token).toBe("tok-refreshed");
    expect((await readAccount(db))!.status).toBe("expired");
  });

  test("the D1 row wins over a changed seed secret", async () => {
    await ensureAccount(db, "seed-token", NOW);
    expect((await ensureAccount(db, "another-seed", NOW))!.token).toBe("tok-refreshed");
  });
});

describe("saveConnectedToken (admin Connect)", () => {
  test("stores the long-lived token with its expiry and the own user, replacing any row but keeping the cursor", async () => {
    await ensureAccount(db, "seed-token", NOW);
    await client.execute(`UPDATE threads_account SET mentions_since = 12345`);
    const row = await saveConnectedToken(
      db,
      { accessToken: "long-token", expiresIn: 5_184_000 },
      NOW,
    );
    expect(row).toMatchObject({
      source: "oauth",
      accessToken: "long-token",
      threadsUserId: "100",
      username: "joyorogo",
      status: "ok",
      mentionsSince: 12345,
    });
    expect(row.expiresAt.getTime()).toBe(NOW + 5_184_000_000);
    expect(await db.select().from(threadsAccount)).toHaveLength(1);
  });
});
