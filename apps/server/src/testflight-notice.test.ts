import { d1TestDb } from "@joyorogo/db/test-d1";
import { beforeEach, describe, expect, test } from "bun:test";
import type { StickersBucket } from "@joyorogo/api/lib/sticker";

import type { BroadcastDeps } from "./broadcast";
import {
  pendingTestflightBuyers,
  runTestflightNoticeSweep,
  sendTestflightNotice,
  testflightNoticeConfig,
} from "./testflight-notice";
import { recordOptOut } from "./unsubscribe";

const { client, db } = await d1TestDb();

function fakeBucket() {
  const objects = new Map<string, string>();
  const bucket: StickersBucket = {
    async put(key, value) {
      objects.set(key, typeof value === "string" ? value : "<binary>");
    },
    async get(key) {
      const found = objects.get(key);
      if (found === undefined) return null;
      const bytes = new TextEncoder().encode(found);
      return {
        body: new Blob([bytes]).stream(),
        size: bytes.length,
        arrayBuffer: async () => bytes.buffer.slice(0) as ArrayBuffer,
      };
    },
    async delete(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) objects.delete(key);
    },
    async list({ prefix }) {
      return { objects: [...objects.keys()].filter((k) => k.startsWith(prefix)).sort().map((key) => ({ key })), truncated: false };
    },
  };
  return bucket;
}

type Sent = { to: string; from: { email: string; name: string }; subject: string; html: string; text: string; headers: Record<string, string> };
let outbox: Sent[] = [];
let failSends = false;
const email = {
  send: async (message: Sent) => {
    if (failSends) throw new Error("boom");
    outbox.push(message);
    return { messageId: `m${outbox.length}` };
  },
} as unknown as NonNullable<BroadcastDeps["email"]>;

const makeDeps = (): BroadcastDeps => ({ db, bucket: fakeBucket(), email, secret: "s".repeat(40), baseUrl: "https://api.test" });
const config = testflightNoticeConfig({
  TESTFLIGHT_PURCHASE_EMAIL: "on",
  ADMIN_EMAILS: "owner@test.id",
  APPLE_SANDBOX_EMAILS: "Allowed@Test.id",
});

async function seed() {
  for (const table of ["email_log", "payment", "profile", "user"]) await client.execute(`DELETE FROM "${table}"`);
  const users: [string, string, string, number][] = [
    ["fajri", "Fajri Furqan", "fajri@test.id", 1],
    ["siti", "siti", "siti@test.id", 1],
    ["owner", "Owner", "owner@test.id", 1],
    ["allowed", "Allowed", "allowed@test.id", 1],
    ["review", "Review", "review@joyorogo.com", 1],
    ["unverified", "Una", "una@test.id", 0],
    ["buyer", "Real Buyer", "buyer@test.id", 1],
  ];
  for (const [id, name, mail, verified] of users) {
    await client.execute({
      sql: `INSERT INTO "user" (id, name, email, email_verified, created_at) VALUES (?, ?, ?, ?, 1)`,
      args: [id, name, mail, verified],
    });
  }
  const rows: [string, string, number, string][] = [
    ["apple:1", "fajri", 0, "paid"],
    ["apple:2", "fajri", 0, "paid"],
    ["apple:3", "siti", 0, "paid"],
    ["apple:4", "owner", 0, "paid"],
    ["apple:5", "allowed", 0, "paid"],
    ["apple:6", "review", 0, "paid"],
    ["apple:7", "unverified", 0, "paid"],
    ["apple:8", "buyer", 29000, "paid"],
    ["DOKU-1", "buyer", 0, "paid"],
  ];
  for (const [orderId, userId, amount, status] of rows) {
    await client.execute({
      sql: `INSERT INTO payment (order_id, user_id, amount_idr, status) VALUES (?, ?, ?, ?)`,
      args: [orderId, userId, amount, status],
    });
  }
  await client.execute(
    `INSERT INTO profile (user_id, birth_year, gender, height_cm, start_weight_kg, target_weight_kg, target_date, activity_level, locale) VALUES ('siti', 1990, 'female', 160, 60, 55, '2027-01-01', 'sedentary', 'en')`,
  );
}

const logged = async () =>
  (await client.execute(`SELECT ref FROM email_log WHERE kind = 'testflight_notice' ORDER BY ref`)).rows.map((r) => String(r.ref));

beforeEach(async () => {
  outbox = [];
  failSends = false;
  await seed();
});

describe("testflightNoticeConfig", () => {
  test("is on only for the exact value and skips ours, the admins and the allowlist", () => {
    expect(testflightNoticeConfig({}).enabled).toBe(false);
    expect(testflightNoticeConfig({ TESTFLIGHT_PURCHASE_EMAIL: "off" }).enabled).toBe(false);
    expect(testflightNoticeConfig({ TESTFLIGHT_PURCHASE_EMAIL: "" }).enabled).toBe(false);
    expect(config.enabled).toBe(true);
    expect(config.skipEmails).toEqual(
      expect.arrayContaining(["review@joyorogo.com", "qa@joyorogo.com", "owner@test.id", "allowed@test.id"]),
    );
  });
});

describe("pendingTestflightBuyers", () => {
  test("lists each verified Rp0 Apple buyer once, without ours, paid orders or other gateways", async () => {
    const buyers = await pendingTestflightBuyers(db, config);
    expect(buyers.map((b) => b.id)).toEqual(["fajri", "siti"]);
  });
});

describe("a long skip list", () => {
  test("150 sandbox allowlist emails (D1 binds 100 values per statement) still skip exactly the listed buyers", async () => {
    const big = testflightNoticeConfig({
      TESTFLIGHT_PURCHASE_EMAIL: "on",
      ADMIN_EMAILS: "owner@test.id",
      APPLE_SANDBOX_EMAILS: [...Array.from({ length: 150 }, (_, i) => `tester${i}@test.id`), "siti@test.id", "allowed@test.id"].join(","),
    });
    expect((await pendingTestflightBuyers(db, big)).map((b) => b.id)).toEqual(["fajri"]);
    expect(await sendTestflightNotice(makeDeps(), big, "siti")).toBe("skipped");
    expect(await sendTestflightNotice(makeDeps(), big, "fajri")).toBe("sent");
  });
});

describe("sendTestflightNotice", () => {
  test("mails once per user from the broadcast sender with the unsubscribe footer", async () => {
    const deps = makeDeps();
    expect(await sendTestflightNotice(deps, config, "fajri")).toBe("sent");
    expect(await sendTestflightNotice(deps, config, "fajri")).toBe("already");
    expect(outbox).toHaveLength(1);
    const [mail] = outbox;
    expect(mail?.to).toBe("fajri@test.id");
    expect(mail?.from.email).toBe("dzulfikar@joyorogo.com");
    expect(mail?.headers["List-Unsubscribe"]).toContain("https://api.test/unsubscribe?t=");
    expect(mail?.text).toContain("Halo Fajri,");
    expect(mail?.text).toContain("tidak ditagih dan Pro aktif 24 jam");
    expect(mail?.text).toContain("https://joyorogo.com/harga");
    expect(mail?.text).toContain("Berhenti berlangganan:");
    expect(await logged()).toEqual(["fajri"]);
  });

  test("English for an English profile, with the English footer", async () => {
    await sendTestflightNotice(makeDeps(), config, "siti");
    const [mail] = outbox;
    expect(mail?.subject).toBe("About your Pro purchase in TestFlight");
    expect(mail?.text).toContain("Hi Siti,");
    expect(mail?.text).toContain("you were not charged and Pro stays active for 24 hours");
    expect(mail?.text).toContain("Unsubscribe:");
    expect(mail?.html).toContain('<html lang="en">');
  });

  test("off, skip-listed, unverified and opted-out users get nothing", async () => {
    const deps = makeDeps();
    expect(await sendTestflightNotice(deps, { ...config, enabled: false }, "fajri")).toBe("off");
    for (const id of ["owner", "allowed", "review", "unverified"]) {
      expect(await sendTestflightNotice(deps, config, id)).toBe("skipped");
    }
    await recordOptOut(deps.bucket, "fajri");
    expect(await sendTestflightNotice(deps, config, "fajri")).toBe("opted-out");
    expect(outbox).toHaveLength(0);
    expect(await logged()).toEqual([]);
  });

  test("a failed send releases the claim so the sweep can retry", async () => {
    const deps = makeDeps();
    failSends = true;
    expect(await sendTestflightNotice(deps, config, "fajri")).toBe("failed");
    expect(await logged()).toEqual([]);
    failSends = false;
    expect(await sendTestflightNotice(deps, config, "fajri")).toBe("sent");
  });
});

describe("runTestflightNoticeSweep", () => {
  test("backfills earlier buyers once, then has nothing left", async () => {
    const deps = makeDeps();
    const first = await runTestflightNoticeSweep(deps, config);
    expect(first).toMatchObject({ pending: 2, sent: 2, failed: 0 });
    expect(outbox.map((m) => m.to).sort()).toEqual(["fajri@test.id", "siti@test.id"]);
    expect(await runTestflightNoticeSweep(deps, config)).toMatchObject({ pending: 0, sent: 0 });
    expect(outbox).toHaveLength(2);
  });

  test("skips someone the grant hook already mailed", async () => {
    const deps = makeDeps();
    await sendTestflightNotice(deps, config, "fajri");
    expect(await runTestflightNoticeSweep(deps, config)).toMatchObject({ pending: 1, sent: 1 });
    expect(outbox.filter((m) => m.to === "fajri@test.id")).toHaveLength(1);
  });

  test("does nothing when off, and stops at the first failure", async () => {
    const deps = makeDeps();
    expect(await runTestflightNoticeSweep(deps, { ...config, enabled: false })).toMatchObject({ sent: 0 });
    failSends = true;
    expect(await runTestflightNoticeSweep(deps, config)).toMatchObject({ failed: 1, sent: 0 });
    expect(await logged()).toEqual([]);
  });

  test("leaves opted-out buyers alone without logging them as mailed", async () => {
    const deps = makeDeps();
    await recordOptOut(deps.bucket, "fajri");
    expect(await runTestflightNoticeSweep(deps, config)).toMatchObject({ sent: 1, optedOut: 1 });
    expect(outbox.map((m) => m.to)).toEqual(["siti@test.id"]);
    expect(await logged()).toEqual(["siti"]);
  });
});
