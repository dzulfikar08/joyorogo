import { d1TestDb } from "@joyorogo/db/test-d1";
import { beforeEach, describe, expect, test } from "bun:test";
import type { StickersBucket } from "@joyorogo/api/lib/sticker";

import type { BroadcastDeps } from "./broadcast";
import { lifecycleConfig, lifecycleDue, lifecycleSendHour, runLifecycleEmails } from "./lifecycle-email";
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
      return { body: new Blob([bytes]).stream(), size: bytes.length, arrayBuffer: async () => bytes.buffer.slice(0) as ArrayBuffer };
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

type Sent = { to: string; subject: string; text: string; headers: Record<string, string> };
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
const config = lifecycleConfig({ LIFECYCLE_EMAIL: "on", ADMIN_EMAILS: "owner@test.id" });

const DAY = 86_400_000;
/** 2026-10-31 10:00 WIB. */
const NOW = Date.UTC(2026, 9, 31, 3);

async function addUser(id: string, ageDays: number, opts: { verified?: boolean; mail?: string } = {}) {
  await client.execute({
    sql: `INSERT INTO "user" (id, name, email, email_verified, created_at) VALUES (?, ?, ?, ?, ?)`,
    args: [id, id[0]!.toUpperCase() + id.slice(1), opts.mail ?? `${id}@test.id`, opts.verified === false ? 0 : 1, NOW - ageDays * DAY],
  });
}
const scan = (userId: string, daysAgo: number, type = "user") =>
  client.execute({
    sql: `INSERT INTO ai_usage (id, user_id, model, scan_type, latency_ms, created_at) VALUES (?, ?, 'm', ?, 1, ?)`,
    args: [crypto.randomUUID(), userId, type, NOW - daysAgo * DAY],
  });
const meal = (userId: string, daysAgo: number, source = "manual") =>
  client.execute({
    sql: `INSERT INTO food_log (id, user_id, date, meal, name, kcal, source, created_at) VALUES (?, ?, '2026-10-01', 'snack', 'x', 1, ?, ?)`,
    args: [crypto.randomUUID(), userId, source, NOW - daysAgo * DAY],
  });

const due = async (now = NOW) => (await lifecycleDue(db, config, now)).map((m) => `${m.kind}:${m.id}`).sort();

beforeEach(async () => {
  outbox = [];
  failSends = false;
  for (const table of ["email_log", "ai_usage", "food_log", "profile", "user"]) await client.execute(`DELETE FROM "${table}"`);
});

describe("lifecycleDue", () => {
  test("activation: never-active accounts aged 1 to 13 days; not brand-new, old, unverified, ours or admins", async () => {
    await addUser("fresh", 0.5);
    await addUser("day1", 1.2);
    await addUser("day13", 13.5);
    await addUser("old", 20);
    await addUser("unverified", 2, { verified: false });
    await addUser("owner", 2, { mail: "Owner@test.id" });
    await addUser("review", 2, { mail: "review@joyorogo.com" });
    expect(await due()).toEqual(["lifecycle_activate_1:day1", "lifecycle_activate_1:day13"]);
  });

  test("any scan or manual meal counts as active, but other AI calls and Huawei imports do not", async () => {
    for (const id of ["scanned", "logged", "coached", "imported"]) await addUser(id, 3);
    await scan("scanned", 1);
    await meal("logged", 1);
    await scan("coached", 1, "coach");
    await meal("imported", 1, "huawei");
    expect(await due()).toEqual(["lifecycle_activate_1:coached", "lifecycle_activate_1:imported"]);
  });

  test("second nudge only from day 4 and at least 2 days after the first", async () => {
    await addUser("siti", 3);
    const deps = makeDeps();
    expect((await runLifecycleEmails(deps, config, NOW)).sent).toBe(1);
    expect(await due(NOW + 1.5 * DAY)).toEqual([]);
    expect(await due(NOW + 2 * DAY)).toEqual(["lifecycle_activate_2:siti"]);
    await runLifecycleEmails(deps, config, NOW + 2 * DAY);
    expect(await due(NOW + 5 * DAY)).toEqual([]);
    expect(outbox.map((m) => m.subject)).toEqual(["Foto makanan berikutnya, Joyo yang hitung", "Satu foto saja dulu"]);
  });

  test("win-back: last active 14 to 44 days ago, once per lapse, again only after a new lapse and 30 days", async () => {
    for (const id of ["recent", "lapsed", "gone"]) await addUser(id, 100);
    await scan("recent", 13);
    expect(await due()).toEqual([]);
    await scan("recent", 5);
    await meal("lapsed", 20);
    await scan("lapsed", 15);
    await scan("gone", 50);
    expect(await due()).toEqual(["lifecycle_winback:lapsed"]);

    const deps = makeDeps();
    await runLifecycleEmails(deps, config, NOW);
    await client.execute(`DELETE FROM "user" WHERE id IN ('recent', 'gone')`);
    expect(await due(NOW + DAY)).toEqual([]);
    // Back for one scan, then gone again: a new lapse, but within 30 days of the last win-back.
    await scan("lapsed", -2);
    expect(await due(NOW + 20 * DAY)).toEqual([]);
    expect(await due(NOW + 31 * DAY)).toEqual(["lifecycle_winback:lapsed"]);
  });
});

describe("runLifecycleEmails", () => {
  test("mails in the person's language with the unsubscribe header, once", async () => {
    await addUser("siti", 2);
    await client.execute(
      `INSERT INTO profile (user_id, birth_year, gender, height_cm, start_weight_kg, target_weight_kg, target_date, activity_level, locale) VALUES ('siti', 1990, 'female', 160, 60, 55, '2027-01-01', 'sedentary', 'en')`,
    );
    const deps = makeDeps();
    expect(await runLifecycleEmails(deps, config, NOW)).toMatchObject({ due: 1, sent: 1 });
    expect(await runLifecycleEmails(deps, config, NOW)).toMatchObject({ due: 0, sent: 0 });
    const [mail] = outbox;
    expect(mail?.to).toBe("siti@test.id");
    expect(mail?.subject).toBe("Snap your next meal, Joyo does the math");
    expect(mail?.text).toContain("Hi Siti,");
    expect(mail?.headers["List-Unsubscribe"]).toContain("https://api.test/unsubscribe?t=");
  });

  test("off, outside 09:00-19:59 WIB, or opted out: nothing is sent or logged", async () => {
    await addUser("siti", 2);
    const deps = makeDeps();
    expect(await runLifecycleEmails(deps, { ...config, enabled: false }, NOW)).toMatchObject({ sent: 0 });
    expect(lifecycleSendHour(Date.UTC(2026, 9, 31, 1, 59))).toBe(false);
    expect(lifecycleSendHour(Date.UTC(2026, 9, 31, 2))).toBe(true);
    expect(lifecycleSendHour(Date.UTC(2026, 9, 31, 13))).toBe(false);
    expect(await runLifecycleEmails(deps, config, Date.UTC(2026, 9, 31, 14))).toMatchObject({ due: 0, sent: 0 });
    await recordOptOut(deps.bucket, "siti");
    expect(await runLifecycleEmails(deps, config, NOW)).toMatchObject({ due: 1, sent: 0, optedOut: 1 });
    expect(outbox).toHaveLength(0);
    expect((await client.execute(`SELECT count(*) n FROM email_log`)).rows[0]?.n).toBe(0);
  });

  test("a failed send releases the claim and stops the tick; the next tick retries", async () => {
    await addUser("siti", 2);
    await addUser("budi", 3);
    const deps = makeDeps();
    failSends = true;
    expect(await runLifecycleEmails(deps, config, NOW)).toMatchObject({ sent: 0, failed: 1 });
    expect((await client.execute(`SELECT count(*) n FROM email_log`)).rows[0]?.n).toBe(0);
    failSends = false;
    expect(await runLifecycleEmails(deps, config, NOW)).toMatchObject({ sent: 2 });
  });
});
